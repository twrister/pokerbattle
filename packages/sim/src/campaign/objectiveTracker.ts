import { HAND_CATEGORY_NAMES } from '../config/handCategories.js';
import { isArcherTowerId, isBuildingConfig } from '../config/units.js';
import { TICK_RATE } from '../config/tuning.js';
import { Faction } from '../entity/unit.js';
import type { MatchState } from '../match/matchState.js';
import type { StageDef, StageObjective, StageStatus } from './stageDef.js';

/** 通关后的结算信息。 */
/** 失败原因，供结算与 HUD 说明「为什么输了」。 */
export type StageFailReason =
  | 'timeout'
  | 'match_over'
  | 'out_of_troops'
  | 'too_many_plays'
  | 'forbidden_category'
  | 'base_hp_low';

/** 失败原因的中文说明。 */
export const STAGE_FAIL_REASON_TEXT: Readonly<Record<StageFailReason, string>> = {
  timeout: '时间到了，目标还没完成',
  match_over: '对局已经结束',
  out_of_troops: '手牌用完，场上也没兵了',
  too_many_plays: '出牌次数超过限制',
  forbidden_category: '打出了被禁止的牌型',
  base_hp_low: '主堡血量跌破了下限',
};

export interface StageOutcome {
  status: Exclude<StageStatus, 'pending'>;
  /** 失败时的原因；成功时为 undefined。 */
  reason?: StageFailReason;
  /** 判定落定时的局内秒数。 */
  seconds: number;
}

/** 单个目标的展示进度，供 HUD 渲染。 */
export interface ObjectiveProgress {
  text: string;
  done: boolean;
}

/**
 * 每 tick 读取对局状态，判定关卡成败。
 * 判定一旦落定就锁住结果，之后 update 不再改变。
 */
export class ObjectiveTracker {
  private outcome: StageOutcome | null = null;
  /** destroy_unit 用：已经在场上出现过的敌方兵种。 */
  private readonly seenTypes = new Set<string>();

  constructor(
    private readonly def: StageDef,
    private readonly playerSlot: number = Faction.Blue,
    /**
     * 判定失败的硬性时限（tick），缺省不限。
     * 无基地关卡拿不到对局结算，必须靠这里兜住超时。
     */
    private readonly timeLimitTicks: number | null = null,
  ) {}

  /** 已落定的结果；未落定为 null。 */
  getOutcome(): StageOutcome | null {
    return this.outcome;
  }

  /** 当前状态：未落定为 pending。 */
  getStatus(): StageStatus {
    return this.outcome?.status ?? 'pending';
  }

  /** 逐目标进度，用于目标面板。 */
  getProgress(match: MatchState): ObjectiveProgress[] {
    return this.def.objectives.map((objective) => ({
      text: describeObjective(objective) + this.progressSuffix(objective, match),
      done: this.isDone(objective, match),
    }));
  }

  /** 出牌次数类目标附带「已出 x/N」，让玩家知道还剩几手。 */
  private progressSuffix(objective: StageObjective, match: MatchState): string {
    if (objective.kind !== 'max_plays') return '';
    return `（已出 ${match.getPlayedFormationCount(this.playerSlot)}/${objective.count}）`;
  }

  /** 在 match.step 之后调用；返回当前状态。 */
  update(match: MatchState): StageStatus {
    if (this.outcome) return this.outcome.status;
    this.markSeenUnits(match);
    // 限制条件先判：违规的那一手哪怕顺带清了场，也不能算通关
    const violation = this.findViolation(match);
    if (violation) {
      this.settle(match, 'fail', violation);
      return this.getStatus();
    }
    const allDone = this.def.objectives.every((objective) => this.isDone(objective, match));
    if (allDone) {
      this.settle(match, 'success');
    } else if (match.result) {
      // 对局已结束但目标没达成：超时、被拆家、平局都算失败
      this.settle(match, 'fail', 'match_over');
    } else if (this.timeLimitTicks != null && match.world.tick >= this.timeLimitTicks) {
      // 无基地关卡不会产出 match.result，只能靠关卡时限判失败
      this.settle(match, 'fail', 'timeout');
    } else if (this.isStuckOutOfTroops(match)) {
      // 没牌也没兵，目标还差着，再拖下去只是空等
      this.settle(match, 'fail', 'out_of_troops');
    }
    return this.getStatus();
  }

  /** 记下开局以来出现过的敌方兵种，destroy_unit 只认「出现过且全灭」。 */
  private markSeenUnits(match: MatchState): void {
    for (const objective of this.def.objectives) {
      if (objective.kind !== 'destroy_unit' || this.seenTypes.has(objective.typeId)) continue;
      if (countLivingEnemyType(match, objective.typeId) > 0) this.seenTypes.add(objective.typeId);
    }
  }

  /** 逐条检查限制类目标，返回第一条被违反的原因；都守住返回 null。 */
  private findViolation(match: MatchState): StageFailReason | null {
    for (const objective of this.def.objectives) {
      if (objective.kind === 'max_plays') {
        if (match.getPlayedFormationCount(this.playerSlot) > objective.count) return 'too_many_plays';
      } else if (objective.kind === 'forbid_category') {
        if (match.getPlayedCategoryCount(this.playerSlot, objective.category) > 0) return 'forbidden_category';
      } else if (objective.kind === 'base_hp_above') {
        if (castleHpRatio(match, Faction.Blue) < objective.ratio) return 'base_hp_low';
      }
    }
    return null;
  }

  /**
   * 玩家是否已经打不动了：手牌出完且场上再无己方单位。
   * 必须在目标全达成之后判定——清场目标常在最后一只兵倒下那一帧达成。
   */
  private isStuckOutOfTroops(match: MatchState): boolean {
    // 守家关只要撑到时间就赢，牌打光、兵死光也不算提前出局
    if (this.def.objectives.some((objective) => objective.kind === 'survive_seconds')) return false;
    if (!isOutOfCards(match, this.playerSlot)) return false;
    if (hasLivingMobileUnit(match, Faction.Blue)) return false;
    // 己方弹道还在飞：落地可能刚好补上清场目标，先等它结算
    return !hasFlyingProjectile(match, Faction.Blue);
  }

  /** 锁定结果。 */
  private settle(match: MatchState, status: 'success' | 'fail', reason?: StageFailReason): void {
    this.outcome = { status, seconds: match.world.tick / TICK_RATE, ...(reason ? { reason } : {}) };
  }

  /** 单个目标当前是否达成。 */
  private isDone(objective: StageObjective, match: MatchState): boolean {
    switch (objective.kind) {
      case 'destroy_base':
        return match.getCastleHp(Faction.Red) <= 0 && match.getCastleMaxHp(Faction.Red) > 0;
      case 'win_match':
        return match.result?.winner === Faction.Blue;
      case 'destroy_towers':
        return countEnemyTowers(match) === 0;
      case 'survive_seconds':
        return (
          match.world.tick >= objective.seconds * TICK_RATE && match.getCastleHp(Faction.Blue) > 0
        );
      case 'play_category':
        return match.getPlayedCategoryCount(this.playerSlot, objective.category) >= objective.count;
      case 'play_any':
        return match.getPlayedFormationCount(this.playerSlot) > 0;
      case 'clear_enemy_units':
        return !hasLivingMobileUnit(match, Faction.Red);
      case 'claim_castle_pack':
        // 半血保护卡包只在该席主堡跌破半血后掉落，领取即达成
        return match.getCastlePackState(this.playerSlot) === 'claimed';
      case 'destroy_unit':
        return this.seenTypes.has(objective.typeId) && countLivingEnemyType(match, objective.typeId) === 0;
      // 限制类目标：没被违反就算满足（违反时 update 已经先判失败）
      case 'max_plays':
      case 'forbid_category':
      case 'base_hp_above':
        return true;
    }
  }
}

/** 敌方某兵种的存活数量。 */
function countLivingEnemyType(match: MatchState, typeId: string): number {
  let count = 0;
  for (const unit of match.world.units) {
    if (!unit.dead && unit.faction === Faction.Red && unit.typeId === typeId) count += 1;
  }
  return count;
}

/** 主堡血量比例；没有主堡时视为满血，不触发血量限制。 */
function castleHpRatio(match: MatchState, faction: Faction): number {
  const max = match.getCastleMaxHp(faction);
  return max > 0 ? match.getCastleHp(faction) / max : 1;
}

/** 该阵营是否还有存活的可移动单位；建筑不参与清场判定。 */
function hasLivingMobileUnit(match: MatchState, faction: Faction): boolean {
  for (const unit of match.world.units) {
    if (unit.dead || unit.faction !== faction) continue;
    if (isBuildingConfig(unit.config)) continue;
    return true;
  }
  return false;
}

/**
 * 玩家是否已经彻底没牌可打：手上空，且之后不会再补到牌。
 * 关掉周期补牌时唯一来源是手上的牌；开着则还要看牌堆是否已被抽空。
 * 半血保护卡包还没领且主堡仍活着，也算还有牌在路上（卡包关靠它翻盘）。
 */
function isOutOfCards(match: MatchState, slot: number): boolean {
  const deck = match.decks[slot];
  if (!deck) return true;
  if (deck.hand.length > 0) return false;
  // 卡包还没领、主堡还活着、牌堆里也还有牌：之后领包就能补到，不能提前判「没牌打」
  const packStillPayable =
    match.getCastlePackState(slot) !== 'claimed' && match.getSlotCastleHp(slot) > 0 && deck.availableCount > 0;
  if (packStillPayable) return false;
  return !match.isPeriodicDrawEnabled() || deck.availableCount === 0;
}

/** 该阵营还有未落地的弹道；炸弹在飞时不能判死，否则会漏掉这一下伤害。 */
function hasFlyingProjectile(match: MatchState, faction: Faction): boolean {
  return match.world.projectiles.some((projectile) => !projectile.dead && projectile.faction === faction);
}

/** 敌方存活的箭塔数量。 */
function countEnemyTowers(match: MatchState): number {
  let count = 0;
  for (const unit of match.world.units) {
    if (unit.dead || unit.faction !== Faction.Red) continue;
    if (isArcherTowerId(unit.typeId)) count += 1;
  }
  return count;
}

/** 目标面板文案：只列通关条件本身，不带进度数字。 */
function describeObjective(objective: StageObjective): string {
  switch (objective.kind) {
    case 'destroy_base':
      return '摧毁敌方基地';
    case 'win_match':
      return '赢下这一局';
    case 'destroy_towers':
      return '摧毁敌方箭塔';
    case 'survive_seconds':
      return `守住基地 ${objective.seconds} 秒`;
    case 'play_category': {
      const name = HAND_CATEGORY_NAMES[objective.category];
      return objective.count > 1 ? `打出${name} ${objective.count} 次` : `打出任意${name}`;
    }
    case 'play_any':
      return '打出任意兵种';
    case 'clear_enemy_units':
      return '清光敌方部队';
    case 'destroy_unit':
      return `击毁${objective.label}`;
    case 'max_plays':
      return `最多出 ${objective.count} 手牌`;
    case 'base_hp_above':
      return `主堡血量保持 ${Math.round(objective.ratio * 100)}% 以上`;
    case 'forbid_category':
      return `不能使用${HAND_CATEGORY_NAMES[objective.category]}`;
    case 'claim_castle_pack':
      return '主堡跌破半血后领取卡包';
  }
}
