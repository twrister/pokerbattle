import { HAND_CATEGORY_NAMES } from '../config/handCategories.js';
import { isArcherTowerId, isBuildingConfig } from '../config/units.js';
import { TICK_RATE } from '../config/tuning.js';
import { Faction } from '../entity/unit.js';
import type { MatchState } from '../match/matchState.js';
import type { StageDef, StageObjective, StageStatus } from './stageDef.js';

/** 通关后的结算信息。 */
export interface StageOutcome {
  status: Exclude<StageStatus, 'pending'>;
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
      text: describeObjective(objective),
      done: this.isDone(objective, match),
    }));
  }

  /** 在 match.step 之后调用；返回当前状态。 */
  update(match: MatchState): StageStatus {
    if (this.outcome) return this.outcome.status;
    const allDone = this.def.objectives.every((objective) => this.isDone(objective, match));
    if (allDone) {
      this.settle(match, 'success');
    } else if (match.result) {
      // 对局已结束但目标没达成：超时、被拆家、平局都算失败
      this.settle(match, 'fail');
    } else if (this.timeLimitTicks != null && match.world.tick >= this.timeLimitTicks) {
      // 无基地关卡不会产出 match.result，只能靠关卡时限判失败
      this.settle(match, 'fail');
    } else if (this.isStuckOutOfTroops(match)) {
      // 没牌也没兵，目标还差着，再拖下去只是空等
      this.settle(match, 'fail');
    }
    return this.getStatus();
  }

  /**
   * 玩家是否已经打不动了：手牌出完且场上再无己方单位。
   * 必须在目标全达成之后判定——清场目标常在最后一只兵倒下那一帧达成。
   */
  private isStuckOutOfTroops(match: MatchState): boolean {
    if (!isOutOfCards(match, this.playerSlot)) return false;
    if (hasLivingMobileUnit(match, Faction.Blue)) return false;
    // 己方弹道还在飞：落地可能刚好补上清场目标，先等它结算
    return !hasFlyingProjectile(match, Faction.Blue);
  }

  /** 锁定结果。 */
  private settle(match: MatchState, status: 'success' | 'fail'): void {
    this.outcome = { status, seconds: match.world.tick / TICK_RATE };
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
    }
  }
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
 */
function isOutOfCards(match: MatchState, slot: number): boolean {
  const deck = match.decks[slot];
  if (!deck) return true;
  if (deck.hand.length > 0) return false;
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
  }
}
