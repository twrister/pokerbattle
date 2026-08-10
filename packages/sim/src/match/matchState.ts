import { createPokerCards, INITIAL_HAND_SIZE, PokerDeck } from '../cards/deck.js';
import { detectHandCategories } from '../cards/handCategory.js';
import {
  type Command,
  CommandKind,
  type PlayFormationCommand,
} from '../commands.js';
import {
  findFormationById,
  getFormationBuildingTypeId,
  isBuildingOnlyFormation,
  resolveFormationSpawnsFx,
} from '../config/cardFormations.js';
import { applyArenaTerrain } from '../config/arenaTerrain.js';
import { isBuildingInsideHalfCourt, isFormationInsideHalfCourt } from '../config/halfCourt.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/arena.js';
import { TICK_RATE } from '../config/tuning.js';
import { UNIT_CONFIGS } from '../config/units.js';
import { Faction } from '../entity/unit.js';
import { fromFloat, toFloat } from '../math/fixed.js';
import { World } from '../world.js';

/** 对局的三个可发牌阶段。 */
export type MatchPhase = 'normal' | 'double_speed' | 'overtime' | 'ended';
/** 结算原因由 sim 产出，UI 和联机协议只负责展示与转发。 */
export type MatchEndReason = 'base_destroyed' | 'time_limit' | 'simultaneous_destroyed';
export interface MatchResult {
  winner: Faction | null;
  reason: MatchEndReason;
  endTick: number;
}

/** 2:00 进入倍速发牌。 */
export const DOUBLE_SPEED_START_TICKS = TICK_RATE * 120;
/** 3:00 常规阶段结束；血量相同则进加时。 */
export const NORMAL_PHASE_TICKS = TICK_RATE * 180;
/** 4:00 加时结束。 */
export const OVERTIME_END_TICKS = TICK_RATE * 240;
/** @deprecated 使用 DOUBLE_SPEED_START_TICKS；保留别名兼容既有引用。 */
export const DOUBLE_SPEED_PHASE_TICKS = DOUBLE_SPEED_START_TICKS;
export const NORMAL_DRAW_INTERVAL_TICKS = TICK_RATE * 6;
export const DOUBLE_SPEED_DRAW_INTERVAL_TICKS = TICK_RATE * 3;
export const OVERTIME_DRAW_INTERVAL_TICKS = TICK_RATE * 2;

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
  private nextDrawTick = NORMAL_DRAW_INTERVAL_TICKS;

  constructor(seed = 1) {
    this.world = new World(seed);
    applyArenaTerrain(this.world.nav);
    // 双方牌堆共用 world.rng，抽牌顺序固定为蓝→红，保证确定性
    this.decks = {
      [Faction.Blue]: new PokerDeck(createPokerCards(), this.world.rng),
      [Faction.Red]: new PokerDeck(createPokerCards(), this.world.rng),
    };
    this.decks[Faction.Blue].drawMany(INITIAL_HAND_SIZE);
    this.decks[Faction.Red].drawMany(INITIAL_HAND_SIZE);
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
    return h >>> 0;
  }

  /** 清空战场与牌堆，回到开局发牌状态。 */
  clear(): void {
    this.world.clear();
    applyArenaTerrain(this.world.nav);
    // 原地 reset，保留 decks 引用：单机 HandPanel 创建时绑的是同一对象
    this.decks[Faction.Blue].reset();
    this.decks[Faction.Red].reset();
    this.decks[Faction.Blue].drawMany(INITIAL_HAND_SIZE);
    this.decks[Faction.Red].drawMany(INITIAL_HAND_SIZE);
    this.phase = 'normal';
    this.result = null;
    this.blueCastleId = null;
    this.redCastleId = null;
    this.nextDrawTick = NORMAL_DRAW_INTERVAL_TICKS;
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

    if (this.world.tick === NORMAL_PHASE_TICKS) {
      const winner = compareHp(blueHp, redHp);
      if (winner !== null) {
        this.finish(winner, 'time_limit');
        return;
      }
      this.phase = 'overtime';
      this.nextDrawTick = this.world.tick + OVERTIME_DRAW_INTERVAL_TICKS;
      return;
    }

    if (this.world.tick === OVERTIME_END_TICKS) {
      this.finish(compareHp(blueHp, redHp), 'time_limit');
      return;
    }

    if (this.world.tick === DOUBLE_SPEED_START_TICKS) {
      this.phase = 'double_speed';
      this.nextDrawTick = this.world.tick + DOUBLE_SPEED_DRAW_INTERVAL_TICKS;
    }
  }

  /** 记录不可逆结算结果并冻结后续逻辑帧。 */
  private finish(winner: Faction | null, reason: MatchEndReason): void {
    this.phase = 'ended';
    this.result = { winner, reason, endTick: this.world.tick };
  }

  /** 当前阶段的下一次补牌间隔。 */
  private drawIntervalTicks(): number {
    if (this.phase === 'normal') return NORMAL_DRAW_INTERVAL_TICKS;
    if (this.phase === 'double_speed') return DOUBLE_SPEED_DRAW_INTERVAL_TICKS;
    return OVERTIME_DRAW_INTERVAL_TICKS;
  }

  private phaseCode(): number {
    if (this.phase === 'normal') return 1;
    if (this.phase === 'double_speed') return 2;
    if (this.phase === 'overtime') return 3;
    return 4;
  }

  /** PlayFormation 专属规则：手牌 / 牌型 / 半场 / 建筑重叠。 */
  private validatePlayFormation(cmd: PlayFormationCommand): boolean {
    const formation = findFormationById(cmd.formationId);
    if (!formation) return false;

    const deck = this.decks[cmd.faction];
    const uniqueIds = [...new Set(cmd.cardIds)];
    if (uniqueIds.length === 0 || uniqueIds.length !== cmd.cardIds.length) return false;
    for (const id of uniqueIds) {
      if (!deck.hasInHand(id)) return false;
    }

    const cards = uniqueIds.map((id) => deck.hand.find((card) => card.id === id)!);
    const categories = detectHandCategories(cards);
    if (!categories.includes(formation.category)) return false;

    const anchorX = toFloat(cmd.x);
    const anchorY = toFloat(cmd.y);

    if (isBuildingOnlyFormation(formation)) {
      const typeId = getFormationBuildingTypeId(formation);
      if (!typeId) return false;
      const footprint = UNIT_CONFIGS[typeId].footprint;
      if (!isBuildingInsideHalfCourt(anchorX, anchorY, footprint, cmd.faction)) return false;
      return this.world.canPlaceBuilding(typeId, cmd.x, cmd.y);
    }

    const points = resolveFormationSpawnsFx(formation, cmd.faction, cmd.x, cmd.y).map((point) => ({
      typeId: point.typeId,
      x: toFloat(point.x),
      y: toFloat(point.y),
      row: point.row,
      col: point.col,
    }));
    return isFormationInsideHalfCourt(points, cmd.faction);
  }
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
