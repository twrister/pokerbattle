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
import { applyArenaPreset, dumpArenaConfigDraft, mirrorBaseY, resolveSideBasePositions } from '../config/arenaConfig.js';
import { applyArenaTerrain } from '../config/arenaTerrain.js';
import { isBuildingInsideHalfCourt, isDeployAnchorInsideHalfCourt } from '../config/halfCourt.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/arena.js';
import { UNIT_CONFIGS } from '../config/units.js';
import {
  DEFAULT_DOUBLE_SPEED_DURATION_SECONDS,
  DEFAULT_DOUBLE_SPEED_DURATION_TICKS,
  DEFAULT_FINAL_DURATION_SECONDS,
  DEFAULT_FINAL_DURATION_TICKS,
  DEFAULT_FINAL_UNIT_TIME_SCALE,
  DEFAULT_PHASE_DURATION_SECONDS,
  DEFAULT_PHASE_DURATION_TICKS,
  DEFAULT_SETTLEMENT_DURATION_SECONDS,
  DEFAULT_SETTLEMENT_DURATION_TICKS,
  DOUBLE_SPEED_DRAW_INTERVAL_TICKS,
  DOUBLE_SPEED_START_TICKS,
  FINAL_DRAW_INTERVAL_TICKS,
  FINAL_START_TICKS,
  FINAL_UNIT_TIME_SCALE_MAX,
  FINAL_UNIT_TIME_SCALE_MIN,
  MATCH_END_TICKS,
  NORMAL_DRAW_INTERVAL_TICKS,
  SETTLEMENT_START_TICKS,
  defaultMatchRules,
  type MatchDrawIntervals,
  type MatchHandLimits,
  type MatchPhaseDurations,
  type MatchRules,
} from '../config/matchRules.js';
import { Faction, type Unit } from '../entity/unit.js';
import { type Fx, fromFloat, ONE, toFloat } from '../math/fixed.js';
import { World } from '../world.js';
import {
  allSlots,
  slotCount,
  teamSlots,
  type MatchMode,
} from './matchMode.js';

export {
  DEFAULT_DOUBLE_SPEED_DURATION_SECONDS,
  DEFAULT_DOUBLE_SPEED_DURATION_TICKS,
  DEFAULT_FINAL_DURATION_SECONDS,
  DEFAULT_FINAL_DURATION_TICKS,
  DEFAULT_FINAL_UNIT_TIME_SCALE,
  DEFAULT_PHASE_DURATION_SECONDS,
  DEFAULT_PHASE_DURATION_TICKS,
  DEFAULT_SETTLEMENT_DURATION_SECONDS,
  DEFAULT_SETTLEMENT_DURATION_TICKS,
  DOUBLE_SPEED_DRAW_INTERVAL_TICKS,
  DOUBLE_SPEED_START_TICKS,
  FINAL_DRAW_INTERVAL_TICKS,
  FINAL_START_TICKS,
  FINAL_UNIT_TIME_SCALE_MAX,
  FINAL_UNIT_TIME_SCALE_MIN,
  MATCH_END_TICKS,
  NORMAL_DRAW_INTERVAL_TICKS,
  SETTLEMENT_START_TICKS,
  defaultMatchRules,
  type MatchDrawIntervals,
  type MatchHandLimits,
  type MatchPhaseDurations,
  type MatchRules,
};

/** 对局可玩阶段含停发后的结算；ended 是冻结收局。 */
export type MatchPhase = 'normal' | 'double_speed' | 'final' | 'settlement' | 'ended';
/** 结算原因由 sim 产出，UI 和联机协议只负责展示与转发。 */
export type MatchEndReason = 'base_destroyed' | 'time_limit' | 'simultaneous_destroyed';
export interface MatchResult {
  winner: Faction | null;
  reason: MatchEndReason;
  endTick: number;
}
/** 主堡生命低于最大生命的该比例时触发保护卡包。 */
export const CASTLE_PROTECT_HP_RATIO = 0.5;
/** 默认主堡配置下的保护线（显示血量），供测试与静态刻度对齐。 */
export const CASTLE_PROTECT_HP = toFloat(UNIT_CONFIGS.building_base.maxHp) * CASTLE_PROTECT_HP_RATIO;
/** 领取保护卡包时无视上限抽取的张数。 */
export const CASTLE_PROTECT_CARDS = 5;
/** 每方每局卡包生命周期：未触发 / 待领取 / 已领取。 */
export type CastlePackState = 'none' | 'pending' | 'claimed';

/**
 * 联机/单机对局的唯一步进入口：World + 各席牌堆。
 * 1v1 下 slot === faction，现有按阵营取值的调用语义不变。
 */
export class MatchState {
  readonly mode: MatchMode;
  readonly world: World;
  /** 按席位索引；1v1 下 decks[Faction.Blue/Red] 仍可用。 */
  readonly decks: PokerDeck[];
  phase: MatchPhase = 'normal';
  result: MatchResult | null = null;
  private readonly castleIds: Array<number | null>;
  private readonly packStates: CastlePackState[];
  private initialHandSize = INITIAL_HAND_SIZE;
  private normalPhaseTicks = DEFAULT_PHASE_DURATION_TICKS;
  private doubleSpeedPhaseTicks = DEFAULT_DOUBLE_SPEED_DURATION_TICKS;
  private finalPhaseTicks = DEFAULT_FINAL_DURATION_TICKS;
  private settlementPhaseTicks = DEFAULT_SETTLEMENT_DURATION_TICKS;
  private finalUnitTimeScale: Fx = fromFloat(DEFAULT_FINAL_UNIT_TIME_SCALE);
  private normalDrawIntervalTicks = NORMAL_DRAW_INTERVAL_TICKS;
  private doubleSpeedDrawIntervalTicks = DOUBLE_SPEED_DRAW_INTERVAL_TICKS;
  private finalDrawIntervalTicks = FINAL_DRAW_INTERVAL_TICKS;
  private normalHandLimit = HAND_LIMIT_NORMAL;
  private doubleSpeedHandLimit = HAND_LIMIT_DOUBLE_SPEED;
  private finalHandLimit = HAND_LIMIT_FINAL;
  /** 各席下一张补牌 tick；满手待发时该席冻结。 */
  private readonly nextDrawTicks: number[];
  /** 周期到点却满手时记一张待发，空位出现后同帧补上。 */
  private readonly pendingDraw: boolean[];

  constructor(seed = 1, mode: MatchMode = '1v1') {
    this.mode = mode;
    applyArenaPreset(mode);
    this.world = new World(seed);
    applyArenaTerrain(this.world.nav);
    const slots = slotCount(mode);
    this.decks = [];
    this.castleIds = [];
    this.packStates = [];
    this.nextDrawTicks = [];
    this.pendingDraw = [];
    // 各席牌堆共用 world.rng，抽牌顺序固定为 slot 升序，保证确定性
    const rules = defaultMatchRules();
    this.applyDefaultRules(rules);
    for (let slot = 0; slot < slots; slot += 1) {
      this.decks.push(new PokerDeck(createPokerCards(), this.world.rng));
      this.castleIds.push(null);
      this.packStates.push('none');
      this.nextDrawTicks.push(rules.drawIntervals.normalTicks);
      this.pendingDraw.push(false);
    }
    this.dealStartingHands();
  }

  /** 把当前运行时默认节奏写进本局字段，避免构造后再覆盖漏字段。 */
  private applyDefaultRules(rules: MatchRules): void {
    this.initialHandSize = rules.initialHandSize;
    this.normalPhaseTicks = rules.phaseDurations.normalTicks;
    this.doubleSpeedPhaseTicks = rules.phaseDurations.doubleSpeedTicks;
    this.finalPhaseTicks = rules.phaseDurations.finalTicks;
    this.settlementPhaseTicks = rules.phaseDurations.settlementTicks;
    this.finalUnitTimeScale = fromFloat(rules.finalUnitTimeScale);
    this.normalDrawIntervalTicks = rules.drawIntervals.normalTicks;
    this.doubleSpeedDrawIntervalTicks = rules.drawIntervals.doubleSpeedTicks;
    this.finalDrawIntervalTicks = rules.drawIntervals.finalTicks;
    this.normalHandLimit = rules.handLimits.normal;
    this.doubleSpeedHandLimit = rules.handLimits.doubleSpeed;
    this.finalHandLimit = rules.handLimits.final;
  }

  /**
   * 推进一帧：先过滤并扣牌，再 world.step，最后按 tick 给未满手席补牌。
   */
  step(commands: readonly Command[] = []): void {
    if (this.result) return;

    const accepted: Command[] = [];
    for (const command of commands) {
      if (command.kind === CommandKind.PlayFormation) {
        if (!this.validate(command)) continue;
        this.decks[commandSlot(command)].play(command.cardIds);
        accepted.push(command);
        continue;
      }
      if (command.kind === CommandKind.ClaimCastlePack) {
        if (!this.validate(command)) continue;
        this.claimCastlePack(commandSlot(command));
        continue;
      }
      accepted.push(command);
    }

    this.world.step(accepted);
    this.updateMatchState();
    if (this.result) return;

    for (const slot of allSlots(this.mode)) {
      this.tryDrawForSlot(slot);
    }
  }

  /**
   * 校验出牌：席位手牌齐全、牌型匹配阵型、落点在己方半场。
   * 基地已陷落仍可打完手牌，但不能再领保护卡包。
   */
  validate(cmd: Command): boolean {
    if (this.result) return false;
    if (cmd.kind === CommandKind.ClaimCastlePack) {
      const slot = commandSlot(cmd);
      if (this.isSlotEliminated(slot)) return false;
      return this.getSlotCastlePackState(slot) === 'pending';
    }
    if (cmd.kind !== CommandKind.PlayFormation) return true;
    return this.validatePlayFormation(cmd);
  }

  /** 世界 + 各席牌堆指纹，供联机 hash 对账。 */
  hash(): number {
    let h = this.world.hash();
    h = mix(h, this.mode === '2v2' ? 2 : 1);
    for (const slot of allSlots(this.mode)) {
      h = mix(h, this.decks[slot]!.hash());
      h = mix(h, this.castleIds[slot] ?? 0);
      h = mix(h, this.nextDrawTicks[slot]!);
      h = mix(h, this.pendingDraw[slot] ? 1 : 0);
      h = mix(h, packStateCode(this.packStates[slot]!));
    }
    h = mix(h, this.phaseCode());
    h = mix(h, this.result?.winner ?? -1);
    h = mix(h, this.result ? resultReasonCode(this.result.reason) : 0);
    h = mix(h, this.result?.endTick ?? 0);
    h = mix(h, this.initialHandSize);
    h = mix(h, this.normalPhaseTicks);
    h = mix(h, this.doubleSpeedPhaseTicks);
    h = mix(h, this.finalPhaseTicks);
    h = mix(h, this.settlementPhaseTicks);
    h = mix(h, this.finalUnitTimeScale);
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
    applyArenaPreset(this.mode);
    this.world.clear();
    applyArenaTerrain(this.world.nav);
    // 原地 reset，保留 decks 引用：单机 HandPanel 创建时绑的是同一对象
    for (const slot of allSlots(this.mode)) {
      this.decks[slot]!.reset();
      this.castleIds[slot] = null;
      this.packStates[slot] = 'none';
    }
    this.phase = 'normal';
    this.result = null;
    this.syncUnitTimeScale();
    this.dealStartingHands();
    // 保留调试覆盖的节奏参数，只重置本局倒计时与待发
    this.resetDrawClocks(this.normalDrawIntervalTicks);
  }

  /**
   * 按场景草稿的单边基地坐标播种主堡，对岸只镜像 Y。
   * 必须在 new MatchState 之后、第一次 step 之前调用，两端顺序一致。
   */
  seedStartingCastles(): void {
    const draft = dumpArenaConfigDraft();
    const sideBases = resolveSideBasePositions(draft, teamSlots(Faction.Blue, this.mode).length);
    const arenaH = toFloat(ARENA_HEIGHT);
    for (const faction of [Faction.Blue, Faction.Red] as const) {
      const slots = teamSlots(faction, this.mode);
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i]!;
        const side = sideBases[i]!;
        const y = faction === Faction.Blue ? side.y : mirrorBaseY(side.y, arenaH);
        const castle = this.world.spawnBuilding(
          faction,
          'building_base',
          fromFloat(side.x),
          fromFloat(y),
          slot,
        );
        this.castleIds[slot] = castle?.id ?? null;
      }
    }
  }

  /** 指定席位主堡当前生命；未播种或已清理视为零。 */
  getSlotCastleHp(slot: number): number {
    return this.findSlotCastle(slot)?.hp ?? 0;
  }

  /** 指定席位主堡最大生命。 */
  getSlotCastleMaxHp(slot: number): number {
    const unit = this.findSlotCastle(slot);
    if (unit) return unit.config.maxHp;
    return this.castleIds[slot] != null ? UNIT_CONFIGS.building_base.maxHp : 0;
  }

  /** 指定席位主堡 sim 平面坐标。 */
  getSlotCastlePosition(slot: number): { x: number; y: number } | null {
    const unit = this.findSlotCastle(slot);
    if (!unit) return null;
    return { x: toFloat(unit.pos.x), y: toFloat(unit.pos.y) };
  }

  /** 指定席位本局保护卡包状态。 */
  getSlotCastlePackState(slot: number): CastlePackState {
    return this.packStates[slot] ?? 'none';
  }

  /** 该席位主堡已陷落（播种后 hp ≤ 0）。未播种时不算淘汰，避免沙盒误禁。 */
  isSlotEliminated(slot: number): boolean {
    const castle = this.findSlotCastle(slot);
    if (castle) return castle.hp <= 0 || castle.dead;
    // 播种过但实体已被 cleanup 摘掉 → 淘汰；从未播种 → 不淘汰
    return this.castleIds[slot] != null;
  }

  /** 队伍主堡剩余总血量；1v1 仍是单座血量。 */
  getCastleHp(faction: Faction): number {
    let total = 0;
    for (const slot of teamSlots(faction, this.mode)) {
      total += this.getSlotCastleHp(slot);
    }
    return total;
  }

  /** 队伍主堡最大生命总和。 */
  getCastleMaxHp(faction: Faction): number {
    let total = 0;
    for (const slot of teamSlots(faction, this.mode)) {
      total += this.getSlotCastleMaxHp(slot);
    }
    return total;
  }

  /** 主堡保护触发线（显示血量），按该席主堡最大生命的一半计算。 */
  getCastleProtectHp(factionOrSlot: Faction | number = Faction.Blue): number {
    return toFloat(this.getSlotCastleMaxHp(factionOrSlot)) * CASTLE_PROTECT_HP_RATIO;
  }

  /** 指定阵营/席位本局保护卡包状态。1v1 下 faction 即 slot。 */
  getCastlePackState(factionOrSlot: Faction | number): CastlePackState {
    return this.getSlotCastlePackState(factionOrSlot);
  }

  /**
   * 调试用：强制掉落指定席位保护卡包。
   * 已领取后也可再掉，方便反复看飞出与领取，不改主堡血量。
   */
  debugDropCastlePack(factionOrSlot: Faction | number): boolean {
    if (this.result) return false;
    if (!this.getSlotCastlePosition(factionOrSlot)) return false;
    this.packStates[factionOrSlot] = 'pending';
    return true;
  }

  /** 主堡 sim 平面坐标；1v1 下 faction 即 slot。 */
  getCastlePosition(factionOrSlot: Faction | number): { x: number; y: number } | null {
    return this.getSlotCastlePosition(factionOrSlot);
  }

  /**
   * 指定席位距离下一张牌的逻辑帧数。
   * 有待发牌时视为 0（读条收起）；未传时默认蓝方席 0，兼容旧调用。
   */
  getTicksUntilDraw(slot: number = Faction.Blue): number {
    if (this.result || this.phase === 'settlement' || this.pendingDraw[slot]) {
      return 0;
    }
    return Math.max(0, this.nextDrawTicks[slot]! - this.world.tick);
  }

  /** 该席是否有一张周期已到、因满手尚未发出的待发牌。 */
  hasPendingDraw(slot: number): boolean {
    return (
      !this.result
      && this.phase !== 'settlement'
      && this.pendingDraw[slot] === true
    );
  }

  /** 当前阶段一次补牌周期的逻辑帧数。 */
  getDrawIntervalTicks(): number {
    return this.drawIntervalTicks();
  }

  /** 指定席位当前补牌周期；2v2 单座陷落也不再加速，始终等于阶段间隔。 */
  getDrawIntervalTicksForSlot(slot: number): number {
    void slot;
    return this.drawIntervalTicks();
  }

  /** 当前阶段手牌上限，供 HUD / 手牌面板展示。 */
  getMaxHandSize(): number {
    return this.currentHandLimit();
  }

  /** 当前阶段结束 tick，供阶段播报倒数；已结束则停在收局帧。 */
  getPhaseDeadlineTick(): number {
    if (this.phase === 'ended' || this.result) return this.result?.endTick ?? this.matchEndTick();
    if (this.phase === 'double_speed') return this.finalStartTick();
    if (this.phase === 'final') return this.settlementStartTick();
    if (this.phase === 'settlement') return this.matchEndTick();
    return this.doubleSpeedStartTick();
  }

  /**
   * HUD 倒计时截止：前三段显示发牌合计剩余，结算阶段显示结算剩余。
   */
  getHudDeadlineTick(): number {
    if (this.phase === 'ended' || this.result) return this.result?.endTick ?? this.matchEndTick();
    if (this.phase === 'settlement') return this.matchEndTick();
    return this.settlementStartTick();
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

  /** 覆盖各阶段时长；边界从 tick 0 重算，并立刻按当前 tick 切阶段。 */
  setPhaseDurations(durations: MatchPhaseDurations): void {
    this.normalPhaseTicks = clampPositiveTicks(durations.normalTicks);
    this.doubleSpeedPhaseTicks = clampPositiveTicks(durations.doubleSpeedTicks);
    this.finalPhaseTicks = clampPositiveTicks(durations.finalTicks);
    this.settlementPhaseTicks = clampPositiveTicks(durations.settlementTicks);
    // 未播种主堡时不启用对局结算，避免沙盒/单测被改时长直接收局
    if (!this.result && this.castleIds.some((id) => id !== null)) {
      this.advancePhases();
    }
  }

  /** 覆盖决胜/结算单位加速；已在这两阶段时立即写回 World。 */
  setFinalUnitTimeScale(scale: number): void {
    this.finalUnitTimeScale = fromFloat(clampUnitTimeScale(scale));
    this.syncUnitTimeScale();
  }

  /** 覆盖三阶段手牌上限，立即同步到各席牌堆。 */
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
      for (const slot of allSlots(this.mode)) {
        this.decks[slot]!.reset();
      }
      this.dealStartingHands();
      this.resetDrawClocks(this.normalDrawIntervalTicks);
    }
  }

  /**
   * 在战斗清理后按队伍主堡存活和时间边界裁决对局。
   * 2v2 必须一队主堡全灭才结束；同帧双灭判平；结算到点比队伍总血量。
   */
  private updateMatchState(): void {
    // 沙盒/确定性测试可复用 MatchState 而不播种主堡，此时不启用对局结算。
    if (this.castleIds.every((id) => id === null)) return;
    const blueAlive = this.teamHasLivingCastle(Faction.Blue);
    const redAlive = this.teamHasLivingCastle(Faction.Red);
    if (!blueAlive || !redAlive) {
      if (!blueAlive && !redAlive) {
        this.finish(null, 'simultaneous_destroyed');
      } else {
        this.finish(blueAlive ? Faction.Blue : Faction.Red, 'base_destroyed');
      }
      return;
    }

    for (const slot of allSlots(this.mode)) {
      this.maybeTriggerCastlePack(slot, this.getSlotCastleHp(slot));
    }
    this.clampDrawCountdown();
    this.advancePhases();
  }

  /**
   * 按当前 tick 连续越过已到期的阶段边界。
   * 调试改时长时也走这里，避免暂停或同帧改数后阶段仍停在旧边界。
   */
  private advancePhases(): void {
    if (this.phase === 'normal' && this.world.tick >= this.doubleSpeedStartTick()) {
      this.enterPhase('double_speed');
    }
    if (this.phase === 'double_speed' && this.world.tick >= this.finalStartTick()) {
      this.enterPhase('final');
    }
    if (this.phase === 'final' && this.world.tick >= this.settlementStartTick()) {
      this.enterPhase('settlement');
    }
    if (this.phase === 'settlement' && this.world.tick >= this.matchEndTick()) {
      this.finish(compareHp(this.getCastleHp(Faction.Blue), this.getCastleHp(Faction.Red)), 'time_limit');
    }
  }

  /** 切阶段：同步手牌上限与单位加速；发牌读条继承剩余时间，仅当超过新间隔时夹住。 */
  private enterPhase(phase: 'double_speed' | 'final' | 'settlement'): void {
    this.phase = phase;
    this.syncHandLimits();
    this.syncUnitTimeScale();
    if (phase === 'settlement') return;
    // 必须在 phase 写完后再夹：updateMatchState 里更早那次 clamp 用的还是旧间隔。
    this.clampDrawCountdown();
  }

  /** 记录不可逆结算结果并冻结后续逻辑帧。 */
  private finish(winner: Faction | null, reason: MatchEndReason): void {
    this.phase = 'ended';
    this.result = { winner, reason, endTick: this.world.tick };
    this.syncUnitTimeScale();
  }

  /** 决胜与结算写入配置倍率，其余阶段（含 ended）回到 1 倍。 */
  private syncUnitTimeScale(): void {
    this.world.unitTimeScale =
      this.phase === 'final' || this.phase === 'settlement' ? this.finalUnitTimeScale : ONE;
  }

  /** 当前阶段的基础补牌间隔。 */
  private drawIntervalTicks(): number {
    if (this.phase === 'normal') return this.normalDrawIntervalTicks;
    if (this.phase === 'double_speed') return this.doubleSpeedDrawIntervalTicks;
    return this.finalDrawIntervalTicks;
  }

  private currentHandLimit(): number {
    if (this.phase === 'double_speed') return this.doubleSpeedHandLimit;
    if (this.phase === 'final' || this.phase === 'settlement' || this.phase === 'ended') {
      return this.finalHandLimit;
    }
    return this.normalHandLimit;
  }

  private syncHandLimits(): void {
    const max = this.currentHandLimit();
    for (const slot of allSlots(this.mode)) {
      this.decks[slot]!.setMaxHandSize(max);
    }
  }

  private dealStartingHands(): void {
    this.syncHandLimits();
    for (const slot of allSlots(this.mode)) {
      this.decks[slot]!.drawMany(this.initialHandSize);
    }
  }

  /**
   * 先冲待发，再到点抽牌。
   * 满手拒抽只冻结该席计时；牌堆抽空仍推进周期，避免空堆把读条卡死。
   * 2v2 单座陷落不停抽：本队还有主堡时全队按阶段间隔正常补牌。
   */
  private tryDrawForSlot(slot: number): void {
    if (this.phase === 'settlement') return;
    const deck = this.decks[slot]!;
    const interval = this.drawIntervalTicks();
    if (this.pendingDraw[slot]) {
      if (deck.hand.length >= deck.maxHandSize) return;
      deck.draw();
      this.pendingDraw[slot] = false;
      this.nextDrawTicks[slot] = this.world.tick + interval;
      return;
    }
    if (this.world.tick < this.nextDrawTicks[slot]!) return;
    const drawn = deck.draw();
    if (drawn) {
      this.nextDrawTicks[slot] = this.world.tick + interval;
      return;
    }
    if (deck.hand.length >= deck.maxHandSize) {
      this.pendingDraw[slot] = true;
      return;
    }
    this.nextDrawTicks[slot] = this.world.tick + interval;
  }

  /** 各席读条与待发一起重置。 */
  private resetDrawClocks(nextTick: number): void {
    for (const slot of allSlots(this.mode)) {
      this.nextDrawTicks[slot] = nextTick;
      this.pendingDraw[slot] = false;
    }
  }

  private clampDrawCountdown(): void {
    if (this.result) return;
    const interval = this.drawIntervalTicks();
    for (const slot of allSlots(this.mode)) {
      if (this.pendingDraw[slot]) continue;
      const remaining = this.nextDrawTicks[slot]! - this.world.tick;
      if (remaining > interval) {
        this.nextDrawTicks[slot] = this.world.tick + interval;
      }
    }
  }

  private doubleSpeedStartTick(): number {
    return this.normalPhaseTicks;
  }

  private finalStartTick(): number {
    return this.normalPhaseTicks + this.doubleSpeedPhaseTicks;
  }

  /** 三段发牌结束、进入停发结算的 tick。 */
  private settlementStartTick(): number {
    return this.normalPhaseTicks + this.doubleSpeedPhaseTicks + this.finalPhaseTicks;
  }

  private matchEndTick(): number {
    return this.settlementStartTick() + this.settlementPhaseTicks;
  }

  private phaseCode(): number {
    if (this.phase === 'normal') return 1;
    if (this.phase === 'double_speed') return 2;
    if (this.phase === 'final') return 3;
    if (this.phase === 'settlement') return 4;
    return 5;
  }

  /**
   * 该队是否还有至少一座主堡存活。
   * 以场上实体为准，避免席位 ID 对不上时单座陷落被误判成团灭停 sim。
   */
  private teamHasLivingCastle(faction: Faction): boolean {
    for (const unit of this.world.units) {
      if (unit.typeId !== 'building_base' || unit.faction !== faction) continue;
      if (!unit.dead && unit.hp > 0) return true;
    }
    return false;
  }

  /**
   * 查找该席开局主堡：先按播种 ID，再按 ownerSlot 回扫场上实体。
   * cleanup 摘掉尸体后 ID 会失效，回扫才能认到仍存活的另一座。
   */
  private findSlotCastle(slot: number): Unit | undefined {
    const id = this.castleIds[slot];
    if (id != null) {
      const byId = this.world.getUnit(id);
      if (byId) return byId;
    }
    return this.world.units.find(
      (unit) => unit.ownerSlot === slot && unit.typeId === 'building_base',
    );
  }

  /** 主堡仍存活且血量低于半血保护线时，每席每局只升到 pending 一次。 */
  private maybeTriggerCastlePack(slot: number, hp: number): void {
    if (this.packStates[slot] !== 'none') return;
    if (this.isSlotEliminated(slot)) return;
    if (toFloat(hp) >= this.getCastleProtectHp(slot)) return;
    this.packStates[slot] = 'pending';
  }

  /** 从剩余牌堆无视上限抽保护牌，并将卡包标为已领取。 */
  private claimCastlePack(slot: number): void {
    const deck = this.decks[slot]!;
    for (let index = 0; index < CASTLE_PROTECT_CARDS; index += 1) {
      if (!deck.drawIgnoringLimit()) break;
    }
    this.packStates[slot] = 'claimed';
  }

  /** PlayFormation 专属规则：手牌 / 牌型 / 半场 / 建筑重叠。淘汰席仍可打完剩余手牌。 */
  private validatePlayFormation(cmd: PlayFormationCommand): boolean {
    const slot = commandSlot(cmd);
    const template = findFormationById(cmd.formationId);
    if (!template) return false;

    const deck = this.decks[slot];
    if (!deck) return false;
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

function commandSlot(cmd: { slot?: number; faction: Faction }): number {
  return cmd.slot ?? cmd.faction;
}

function clampPositiveTicks(ticks: number): number {
  if (!Number.isFinite(ticks)) return 1;
  return Math.max(1, Math.floor(ticks));
}

/** 调试覆盖加速倍率时夹到 1–3，非法值回落默认 1.5。 */
function clampUnitTimeScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_FINAL_UNIT_TIME_SCALE;
  return Math.min(FINAL_UNIT_TIME_SCALE_MAX, Math.max(FINAL_UNIT_TIME_SCALE_MIN, scale));
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
