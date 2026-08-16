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
/** 主堡生命低于最大生命的该比例时触发保护卡包。 */
export const CASTLE_PROTECT_HP_RATIO = 0.5;
/** 默认主堡配置下的保护线（显示血量），供测试与静态刻度对齐。 */
export const CASTLE_PROTECT_HP = toFloat(UNIT_CONFIGS.building_base.maxHp) * CASTLE_PROTECT_HP_RATIO;
/** 领取保护卡包时无视上限抽取的张数。 */
export const CASTLE_PROTECT_CARDS = 5;
/** 每方每局卡包生命周期：未触发 / 待领取 / 已领取。 */
export type CastlePackState = 'none' | 'pending' | 'claimed';

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
  /** 双方各自的下一张补牌 tick；满手待发时该方冻结，不拖累对方。 */
  private nextDrawTicks: Record<Faction, number> = {
    [Faction.Blue]: NORMAL_DRAW_INTERVAL_TICKS,
    [Faction.Red]: NORMAL_DRAW_INTERVAL_TICKS,
  };
  /** 周期到点却满手时记一张待发，空位出现后同帧补上。 */
  private pendingDraw: Record<Faction, boolean> = {
    [Faction.Blue]: false,
    [Faction.Red]: false,
  };
  private bluePackState: CastlePackState = 'none';
  private redPackState: CastlePackState = 'none';

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
      if (command.kind === CommandKind.ClaimCastlePack) {
        if (!this.validate(command)) continue;
        this.claimCastlePack(command.faction);
        continue;
      }
      accepted.push(command);
    }

    this.world.step(accepted);
    this.updateMatchState();
    if (this.result) return;

    this.tryDrawForFaction(Faction.Blue);
    this.tryDrawForFaction(Faction.Red);
  }

  /**
   * 校验出牌：阵营手牌齐全、牌型匹配阵型、落点在己方半场。
   * Spawn/PlaceBuilding 在对局路径上一般不走这里（沙盒仍可直接喂 World）。
   */
  validate(cmd: Command): boolean {
    if (this.result) return false;
    if (cmd.kind === CommandKind.ClaimCastlePack) {
      return this.getCastlePackState(cmd.faction) === 'pending';
    }
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
    h = mix(h, this.nextDrawTicks[Faction.Blue]);
    h = mix(h, this.nextDrawTicks[Faction.Red]);
    h = mix(h, this.pendingDraw[Faction.Blue] ? 1 : 0);
    h = mix(h, this.pendingDraw[Faction.Red] ? 1 : 0);
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
    h = mix(h, packStateCode(this.bluePackState));
    h = mix(h, packStateCode(this.redPackState));
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
    this.bluePackState = 'none';
    this.redPackState = 'none';
    this.dealStartingHands();
    // 保留调试覆盖的节奏参数，只重置本局倒计时与待发
    this.resetDrawClocks(this.normalDrawIntervalTicks);
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

  /** 主堡保护触发线（显示血量），按该方主堡最大生命的一半计算。 */
  getCastleProtectHp(faction: Faction = Faction.Blue): number {
    return toFloat(this.getCastleMaxHp(faction)) * CASTLE_PROTECT_HP_RATIO;
  }

  /** 指定阵营本局保护卡包状态。 */
  getCastlePackState(faction: Faction): CastlePackState {
    return faction === Faction.Blue ? this.bluePackState : this.redPackState;
  }

  /**
   * 调试用：强制掉落指定阵营保护卡包。
   * 已领取后也可再掉，方便反复看飞出与领取，不改主堡血量。
   */
  debugDropCastlePack(faction: Faction): boolean {
    if (this.result) return false;
    if (!this.getCastlePosition(faction)) return false;
    this.setCastlePackState(faction, 'pending');
    return true;
  }

  /** 主堡 sim 平面坐标；未播种或已清理时返回 null。 */
  getCastlePosition(faction: Faction): { x: number; y: number } | null {
    const id = faction === Faction.Blue ? this.blueCastleId : this.redCastleId;
    const unit = id ? this.world.getUnit(id) : undefined;
    if (!unit) return null;
    return { x: toFloat(unit.pos.x), y: toFloat(unit.pos.y) };
  }

  /**
   * 指定阵营距离下一张牌的逻辑帧数。
   * 有待发牌时视为 0（读条收起）；未传阵营时默认蓝方，兼容旧调用。
   */
  getTicksUntilDraw(faction: Faction = Faction.Blue): number {
    if (this.result || this.pendingDraw[faction]) return 0;
    return Math.max(0, this.nextDrawTicks[faction] - this.world.tick);
  }

  /** 该方是否有一张周期已到、因满手尚未发出的待发牌。 */
  hasPendingDraw(faction: Faction): boolean {
    return !this.result && this.pendingDraw[faction];
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
      this.resetDrawClocks(this.normalDrawIntervalTicks);
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

    this.maybeTriggerCastlePack(Faction.Blue, blueHp);
    this.maybeTriggerCastlePack(Faction.Red, redHp);

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

  /** 切阶段：同步手牌上限，未待发的一方从当前 tick 重开读条。 */
  private enterPhase(phase: 'double_speed' | 'final'): void {
    this.phase = phase;
    this.syncHandLimits();
    const nextTick = this.world.tick + this.drawIntervalTicks();
    // 待发保留：上限变大时本帧 tryDrawForFaction 会立刻补上，不能在这里清掉。
    if (!this.pendingDraw[Faction.Blue]) this.nextDrawTicks[Faction.Blue] = nextTick;
    if (!this.pendingDraw[Faction.Red]) this.nextDrawTicks[Faction.Red] = nextTick;
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

  /**
   * 先冲待发，再到点抽牌。
   * 满手拒抽只冻结该方计时；牌堆抽空仍推进周期，避免空堆把读条卡死。
   */
  private tryDrawForFaction(faction: Faction): void {
    const deck = this.decks[faction];
    if (this.pendingDraw[faction]) {
      if (deck.hand.length >= deck.maxHandSize) return;
      deck.draw();
      this.pendingDraw[faction] = false;
      this.nextDrawTicks[faction] = this.world.tick + this.drawIntervalTicks();
      return;
    }
    if (this.world.tick < this.nextDrawTicks[faction]) return;
    const drawn = deck.draw();
    if (drawn) {
      this.nextDrawTicks[faction] = this.world.tick + this.drawIntervalTicks();
      return;
    }
    if (deck.hand.length >= deck.maxHandSize) {
      this.pendingDraw[faction] = true;
      return;
    }
    this.nextDrawTicks[faction] = this.world.tick + this.drawIntervalTicks();
  }

  /** 双方读条与待发一起重置，避免清局/切阶段后仍握着上一阶段的冻结状态。 */
  private resetDrawClocks(nextTick: number): void {
    this.nextDrawTicks[Faction.Blue] = nextTick;
    this.nextDrawTicks[Faction.Red] = nextTick;
    this.pendingDraw[Faction.Blue] = false;
    this.pendingDraw[Faction.Red] = false;
  }

  private clampDrawCountdown(): void {
    if (this.result) return;
    const interval = this.drawIntervalTicks();
    for (const faction of [Faction.Blue, Faction.Red] as const) {
      if (this.pendingDraw[faction]) continue;
      const remaining = this.nextDrawTicks[faction] - this.world.tick;
      if (remaining > interval) {
        this.nextDrawTicks[faction] = this.world.tick + interval;
      }
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

  /** 主堡仍存活且血量低于半血保护线时，每方每局只升到 pending 一次。 */
  private maybeTriggerCastlePack(faction: Faction, hp: number): void {
    if (this.getCastlePackState(faction) !== 'none') return;
    if (toFloat(hp) >= this.getCastleProtectHp(faction)) return;
    this.setCastlePackState(faction, 'pending');
  }

  /** 从剩余牌堆无视上限抽保护牌，并将卡包标为已领取。 */
  private claimCastlePack(faction: Faction): void {
    const deck = this.decks[faction];
    for (let index = 0; index < CASTLE_PROTECT_CARDS; index += 1) {
      if (!deck.drawIgnoringLimit()) break;
    }
    this.setCastlePackState(faction, 'claimed');
  }

  private setCastlePackState(faction: Faction, state: CastlePackState): void {
    if (faction === Faction.Blue) this.bluePackState = state;
    else this.redPackState = state;
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

function packStateCode(state: CastlePackState): number {
  if (state === 'pending') return 1;
  if (state === 'claimed') return 2;
  return 0;
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
