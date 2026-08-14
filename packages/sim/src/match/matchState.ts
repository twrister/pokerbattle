import {
  clampHandSize,
  createPokerCards,
  HAND_LIMIT_DOUBLE_SPEED,
  HAND_LIMIT_FINAL,
  HAND_LIMIT_NORMAL,
  INITIAL_HAND_SIZE,
  PokerDeck,
} from '../cards/deck.js';
import { detectHandCategories } from '../cards/handCategory.js';
import {
  type Command,
  CommandKind,
  type PlayFormationCommand,
} from '../commands.js';
import {
  findFormationById,
  getFormationBuildingTypeId,
  isFuseBombFormation,
  isBuildingOnlyFormation,
  resolveCardFormation,
} from '../config/cardFormations.js';
import { applyArenaTerrain } from '../config/arenaTerrain.js';
import { isBuildingInsideHalfCourt, isDeployAnchorInsideHalfCourt } from '../config/halfCourt.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/arena.js';
import { TICK_RATE } from '../config/tuning.js';
import { UNIT_CONFIGS } from '../config/units.js';
import { Faction } from '../entity/unit.js';
import { fromFloat, toFloat } from '../math/fixed.js';
import { World } from '../world.js';

/** 对局的三个可发牌阶段。 */
export type MatchPhase = 'normal' | 'double_speed' | 'final' | 'ended';
/** 结算原因由 sim 产出，UI 和联机协议只负责展示与转发。 */
export type MatchEndReason = 'base_destroyed' | 'time_limit' | 'simultaneous_destroyed';
export interface MatchResult {
  winner: Faction | null;
  reason: MatchEndReason;
  endTick: number;
}

/** 每个阶段默认 2 分钟。 */
export const DEFAULT_PHASE_DURATION_SECONDS = 120;
export const DEFAULT_PHASE_DURATION_TICKS = TICK_RATE * DEFAULT_PHASE_DURATION_SECONDS;
/** 默认 2:00 进入倍速阶段。 */
export const DOUBLE_SPEED_START_TICKS = DEFAULT_PHASE_DURATION_TICKS;
/** 默认 4:00 进入决胜阶段。 */
export const FINAL_START_TICKS = DEFAULT_PHASE_DURATION_TICKS * 2;
/** 默认 6:00 决胜结束。 */
export const MATCH_END_TICKS = DEFAULT_PHASE_DURATION_TICKS * 3;
export const NORMAL_DRAW_INTERVAL_TICKS = TICK_RATE * 5;
export const DOUBLE_SPEED_DRAW_INTERVAL_TICKS = TICK_RATE * 3;
export const FINAL_DRAW_INTERVAL_TICKS = TICK_RATE * 2;

/** 三阶段补牌周期。 */
export interface MatchDrawIntervals {
  normalTicks: number;
  doubleSpeedTicks: number;
  finalTicks: number;
}

/** 三阶段持续时长。 */
export interface MatchPhaseDurations {
  normalTicks: number;
  doubleSpeedTicks: number;
  finalTicks: number;
}

/** 三阶段手牌上限。 */
export interface MatchHandLimits {
  normal: number;
  doubleSpeed: number;
  final: number;
}

/** 单机与联机共用的对局节奏；构造时落到 MatchState。 */
export interface MatchRules {
  initialHandSize: number;
  phaseDurations: MatchPhaseDurations;
  drawIntervals: MatchDrawIntervals;
  handLimits: MatchHandLimits;
}

/** 内置默认节奏，单机/联机/服务端都从这里起步。 */
export function defaultMatchRules(): MatchRules {
  return {
    initialHandSize: INITIAL_HAND_SIZE,
    phaseDurations: {
      normalTicks: DEFAULT_PHASE_DURATION_TICKS,
      doubleSpeedTicks: DEFAULT_PHASE_DURATION_TICKS,
      finalTicks: DEFAULT_PHASE_DURATION_TICKS,
    },
    drawIntervals: {
      normalTicks: NORMAL_DRAW_INTERVAL_TICKS,
      doubleSpeedTicks: DOUBLE_SPEED_DRAW_INTERVAL_TICKS,
      finalTicks: FINAL_DRAW_INTERVAL_TICKS,
    },
    handLimits: {
      normal: HAND_LIMIT_NORMAL,
      doubleSpeed: HAND_LIMIT_DOUBLE_SPEED,
      final: HAND_LIMIT_FINAL,
    },
  };
}

/**
 * 联机/单机对局的唯一步进入口：World + 双方牌堆。
 * 刻意不改 World 本身，抽牌与出牌校验都在这一层完成。
 */
export class MatchState {
  readonly world: World;
  readonly decks: Record<Faction, PokerDeck>;
  phase: MatchPhase = 'normal';
  result: MatchResult | null = null;
  private blueCastleId: number | null = null;
  private redCastleId: number | null = null;
  private initialHandSize = INITIAL_HAND_SIZE;
  private normalPhaseTicks = DEFAULT_PHASE_DURATION_TICKS;
  private doubleSpeedPhaseTicks = DEFAULT_PHASE_DURATION_TICKS;
  private finalPhaseTicks = DEFAULT_PHASE_DURATION_TICKS;
  private normalDrawIntervalTicks = NORMAL_DRAW_INTERVAL_TICKS;
  private doubleSpeedDrawIntervalTicks = DOUBLE_SPEED_DRAW_INTERVAL_TICKS;
  private finalDrawIntervalTicks = FINAL_DRAW_INTERVAL_TICKS;
  private normalHandLimit = HAND_LIMIT_NORMAL;
  private doubleSpeedHandLimit = HAND_LIMIT_DOUBLE_SPEED;
  private finalHandLimit = HAND_LIMIT_FINAL;
  private nextDrawTick = NORMAL_DRAW_INTERVAL_TICKS;

  constructor(seed = 1) {
    this.world = new World(seed);
    applyArenaTerrain(this.world.nav);
    // 双方牌堆共用 world.rng，抽牌顺序固定为蓝→红，保证确定性
    this.decks = {
      [Faction.Blue]: new PokerDeck(createPokerCards(), this.world.rng),
      [Faction.Red]: new PokerDeck(createPokerCards(), this.world.rng),
    };
    this.dealStartingHands();
  }

  /**
   * 推进一帧：先过滤并扣牌，再 world.step，最后按 tick 给未满手方补牌。
   */
  step(commands: readonly Command[] = []): void {
    if (this.result) return;

    const accepted: Command[] = [];
    for (const command of commands) {
      if (command.kind === CommandKind.PlayFormation) {
        if (!this.validate(command)) continue;
        this.decks[command.faction].play(command.cardIds);
        accepted.push(command);
        continue;
      }
      accepted.push(command);
    }

    this.world.step(accepted);
    this.updateMatchState();
    if (this.result) return;

    if (this.world.tick >= this.nextDrawTick) {
      this.decks[Faction.Blue].draw();
      this.decks[Faction.Red].draw();
      this.nextDrawTick = this.world.tick + this.drawIntervalTicks();
    }
  }

  /**
   * 校验出牌：阵营手牌齐全、牌型匹配阵型、落点在己方半场。
   * Spawn/PlaceBuilding 在对局路径上一般不走这里（沙盒仍可直接喂 World）。
   */
  validate(cmd: Command): boolean {
    if (this.result) return false;
    if (cmd.kind !== CommandKind.PlayFormation) return true;
    return this.validatePlayFormation(cmd);
  }

  /** 世界 + 双方牌堆指纹，供联机 hash 对账。 */
  hash(): number {
    let h = this.world.hash();
    h = mix(h, this.decks[Faction.Blue].hash());
    h = mix(h, this.decks[Faction.Red].hash());
    h = mix(h, this.phaseCode());
    h = mix(h, this.result?.winner ?? -1);
    h = mix(h, this.result ? resultReasonCode(this.result.reason) : 0);
    h = mix(h, this.result?.endTick ?? 0);
    h = mix(h, this.blueCastleId ?? 0);
    h = mix(h, this.redCastleId ?? 0);
    h = mix(h, this.nextDrawTick);
    h = mix(h, this.initialHandSize);
    h = mix(h, this.normalPhaseTicks);
    h = mix(h, this.doubleSpeedPhaseTicks);
    h = mix(h, this.finalPhaseTicks);
    h = mix(h, this.normalDrawIntervalTicks);
    h = mix(h, this.doubleSpeedDrawIntervalTicks);
    h = mix(h, this.finalDrawIntervalTicks);
    h = mix(h, this.normalHandLimit);
    h = mix(h, this.doubleSpeedHandLimit);
    h = mix(h, this.finalHandLimit);
    return h >>> 0;
  }

  /** 清空战场与牌堆，回到开局发牌状态。 */
  clear(): void {
    this.world.clear();
    applyArenaTerrain(this.world.nav);
    // 原地 reset，保留 decks 引用：单机 HandPanel 创建时绑的是同一对象
    this.decks[Faction.Blue].reset();
    this.decks[Faction.Red].reset();
    this.phase = 'normal';
    this.result = null;
    this.blueCastleId = null;
    this.redCastleId = null;
    this.dealStartingHands();
    // 保留调试覆盖的节奏参数，只重置本局倒计时
    this.nextDrawTick = this.normalDrawIntervalTicks;
  }

  /**
   * 双方半场底端各落一座主堡，不推进 tick（避免联机首帧错位）。
   * 必须在 new MatchState(seed) 之后、第一次 step 之前调用，两端顺序一致。
   */
  seedStartingCastles(): void {
    const footprint = UNIT_CONFIGS.building_base.footprint;
    const centerX = toFloat(ARENA_WIDTH) / 2;
    const edgeInset = footprint / 2;
    const blueCastle = this.world.spawnBuilding(
      Faction.Blue,
      'building_base',
      fromFloat(centerX),
      fromFloat(edgeInset),
    );
    const redCastle = this.world.spawnBuilding(
      Faction.Red,
      'building_base',
      fromFloat(centerX),
      fromFloat(toFloat(ARENA_HEIGHT) - edgeInset),
    );
    this.blueCastleId = blueCastle?.id ?? null;
    this.redCastleId = redCastle?.id ?? null;
  }

  /** 返回指定阵营主堡当前生命；主堡已被清理时视为零。 */
  getCastleHp(faction: Faction): number {
    const id = faction === Faction.Blue ? this.blueCastleId : this.redCastleId;
    return id ? (this.world.getUnit(id)?.hp ?? 0) : 0;
  }

  /** 返回指定阵营主堡的最大生命，未初始化时返回零。 */
  getCastleMaxHp(faction: Faction): number {
    const id = faction === Faction.Blue ? this.blueCastleId : this.redCastleId;
    return id ? (this.world.getUnit(id)?.config.maxHp ?? UNIT_CONFIGS.building_base.maxHp) : 0;
  }

  /** 当前阶段距离下一张牌的逻辑帧数，结算后为零。 */
  getTicksUntilDraw(): number {
    return this.result ? 0 : Math.max(0, this.nextDrawTick - this.world.tick);
  }

  /** 当前阶段一次补牌周期的逻辑帧数，供 UI 遮罩进度与倒计时对齐。 */
  getDrawIntervalTicks(): number {
    return this.drawIntervalTicks();
  }

  /** 当前阶段手牌上限，供 HUD / 手牌面板展示。 */
  getMaxHandSize(): number {
    return this.currentHandLimit();
  }

  /** 当前阶段结束 tick，供 HUD 倒计时；已结束则停在结算帧。 */
  getPhaseDeadlineTick(): number {
    if (this.phase === 'ended' || this.result) return this.result?.endTick ?? this.matchEndTick();
    if (this.phase === 'double_speed') return this.finalStartTick();
    if (this.phase === 'final') return this.matchEndTick();
    return this.doubleSpeedStartTick();
  }

  /**
   * 覆盖三阶段发牌间隔（调试用）。
   * 缩短周期时夹住剩余倒计时，避免遮罩进度超过 100%。
   */
  setDrawIntervals(intervals: MatchDrawIntervals): void {
    this.normalDrawIntervalTicks = clampPositiveTicks(intervals.normalTicks);
    this.doubleSpeedDrawIntervalTicks = clampPositiveTicks(intervals.doubleSpeedTicks);
    this.finalDrawIntervalTicks = clampPositiveTicks(intervals.finalTicks);
    this.clampDrawCountdown();
  }

  /** 覆盖三阶段时长；边界从 tick 0 重算，下一帧按 >= 切换。 */
  setPhaseDurations(durations: MatchPhaseDurations): void {
    this.normalPhaseTicks = clampPositiveTicks(durations.normalTicks);
    this.doubleSpeedPhaseTicks = clampPositiveTicks(durations.doubleSpeedTicks);
    this.finalPhaseTicks = clampPositiveTicks(durations.finalTicks);
  }

  /** 覆盖三阶段手牌上限，立即同步到双方牌堆。 */
  setHandLimits(limits: MatchHandLimits): void {
    this.normalHandLimit = clampHandSize(limits.normal);
    this.doubleSpeedHandLimit = clampHandSize(limits.doubleSpeed);
    this.finalHandLimit = clampHandSize(limits.final);
    this.syncHandLimits();
  }

  /**
   * 覆盖起手张数。开局尚未推进时重发，避免调试改数后仍拿着旧的 4 张。
   */
  setInitialHandSize(size: number): void {
    this.initialHandSize = clampHandSize(size);
    if (this.world.tick === 0 && !this.result) {
      this.decks[Faction.Blue].reset();
      this.decks[Faction.Red].reset();
      this.dealStartingHands();
      this.nextDrawTick = this.normalDrawIntervalTicks;
    }
  }

  /**
   * 在战斗清理后按主堡存活和时间边界裁决对局。
   * 主堡同帧归零直接平局，避免依赖系统内部伤害迭代顺序。
   */
  private updateMatchState(): void {
    // 沙盒/确定性测试可复用 MatchState 而不播种主堡，此时不启用对局结算。
    if (this.blueCastleId === null || this.redCastleId === null) return;
    const blueHp = this.getCastleHp(Faction.Blue);
    const redHp = this.getCastleHp(Faction.Red);
    if (blueHp <= 0 || redHp <= 0) {
      if (blueHp <= 0 && redHp <= 0) {
        this.finish(null, 'simultaneous_destroyed');
      } else {
        this.finish(blueHp > 0 ? Faction.Blue : Faction.Red, 'base_destroyed');
      }
      return;
    }

    if (this.phase === 'normal' && this.world.tick >= this.doubleSpeedStartTick()) {
      this.enterPhase('double_speed');
    }
    if (this.phase === 'double_speed' && this.world.tick >= this.finalStartTick()) {
      this.enterPhase('final');
    }
    if (this.phase === 'final' && this.world.tick >= this.matchEndTick()) {
      this.finish(compareHp(blueHp, redHp), 'time_limit');
    }
  }

  /** 切阶段：同步手牌上限，并从当前 tick 重新计下一次补牌。 */
  private enterPhase(phase: 'double_speed' | 'final'): void {
    this.phase = phase;
    this.syncHandLimits();
    this.nextDrawTick = this.world.tick + this.drawIntervalTicks();
  }

  /** 记录不可逆结算结果并冻结后续逻辑帧。 */
  private finish(winner: Faction | null, reason: MatchEndReason): void {
    this.phase = 'ended';
    this.result = { winner, reason, endTick: this.world.tick };
  }

  /** 当前阶段的下一次补牌间隔。 */
  private drawIntervalTicks(): number {
    if (this.phase === 'normal') return this.normalDrawIntervalTicks;
    if (this.phase === 'double_speed') return this.doubleSpeedDrawIntervalTicks;
    return this.finalDrawIntervalTicks;
  }

  private currentHandLimit(): number {
    if (this.phase === 'double_speed') return this.doubleSpeedHandLimit;
    if (this.phase === 'final' || this.phase === 'ended') return this.finalHandLimit;
    return this.normalHandLimit;
  }

  private syncHandLimits(): void {
    const max = this.currentHandLimit();
    this.decks[Faction.Blue].setMaxHandSize(max);
    this.decks[Faction.Red].setMaxHandSize(max);
  }

  private dealStartingHands(): void {
    this.syncHandLimits();
    this.decks[Faction.Blue].drawMany(this.initialHandSize);
    this.decks[Faction.Red].drawMany(this.initialHandSize);
  }

  private clampDrawCountdown(): void {
    if (this.result) return;
    const remaining = this.nextDrawTick - this.world.tick;
    const interval = this.drawIntervalTicks();
    if (remaining > interval) {
      this.nextDrawTick = this.world.tick + interval;
    }
  }

  private doubleSpeedStartTick(): number {
    return this.normalPhaseTicks;
  }

  private finalStartTick(): number {
    return this.normalPhaseTicks + this.doubleSpeedPhaseTicks;
  }

  private matchEndTick(): number {
    return this.normalPhaseTicks + this.doubleSpeedPhaseTicks + this.finalPhaseTicks;
  }

  private phaseCode(): number {
    if (this.phase === 'normal') return 1;
    if (this.phase === 'double_speed') return 2;
    if (this.phase === 'final') return 3;
    return 4;
  }

  /** PlayFormation 专属规则：手牌 / 牌型 / 半场 / 建筑重叠。 */
  private validatePlayFormation(cmd: PlayFormationCommand): boolean {
    const template = findFormationById(cmd.formationId);
    if (!template) return false;

    const deck = this.decks[cmd.faction];
    const uniqueIds = [...new Set(cmd.cardIds)];
    if (uniqueIds.length === 0 || uniqueIds.length !== cmd.cardIds.length) return false;
    for (const id of uniqueIds) {
      if (!deck.hasInHand(id)) return false;
    }

    const cards = uniqueIds.map((id) => deck.hand.find((card) => card.id === id)!);
    const categories = detectHandCategories(cards);
    if (!categories.includes(template.category)) return false;
    const formation = resolveCardFormation(template, cards);
    if (!formation) return false;

    const anchorX = toFloat(cmd.x);
    const anchorY = toFloat(cmd.y);

    if (isFuseBombFormation(formation)) {
      return anchorX >= 0 && anchorX <= toFloat(ARENA_WIDTH) && anchorY >= 0 && anchorY <= toFloat(ARENA_HEIGHT);
    }

    if (isBuildingOnlyFormation(formation)) {
      const typeId = getFormationBuildingTypeId(formation);
      if (!typeId) return false;
      const footprint = UNIT_CONFIGS[typeId].footprint;
      if (!isBuildingInsideHalfCourt(anchorX, anchorY, footprint, cmd.faction)) return false;
      return this.world.canPlaceBuilding(typeId, cmd.x, cmd.y);
    }

    // 与白色部署区高亮一致：只校验锚点，阵型贴边溢出仍可放置
    return isDeployAnchorInsideHalfCourt(anchorX, anchorY, cmd.faction);
  }
}

function clampPositiveTicks(ticks: number): number {
  if (!Number.isFinite(ticks)) return 1;
  return Math.max(1, Math.floor(ticks));
}

function compareHp(blueHp: number, redHp: number): Faction | null {
  if (blueHp === redHp) return null;
  return blueHp > redHp ? Faction.Blue : Faction.Red;
}

function resultReasonCode(reason: MatchEndReason): number {
  if (reason === 'base_destroyed') return 1;
  if (reason === 'time_limit') return 2;
  return 3;
}

/** FNV-1a，与 World.hash 同款混入。 */
function mix(hash: number, value: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (value >>> shift) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}
