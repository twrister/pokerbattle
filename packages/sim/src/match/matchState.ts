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

/** 3 秒抽一张：墙钟节奏换成 tick，避免联机两端用 deltaMs 分叉。 */
export const DRAW_INTERVAL_TICKS = TICK_RATE * 3;

/**
 * 联机/单机对局的唯一步进入口：World + 双方牌堆。
 * 刻意不改 World 本身，抽牌与出牌校验都在这一层完成。
 */
export class MatchState {
  readonly world: World;
  readonly decks: Record<Faction, PokerDeck>;

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

    // 开局已发初始手牌；之后每 DRAW_INTERVAL_TICKS 补一张
    if (this.world.tick > 0 && this.world.tick % DRAW_INTERVAL_TICKS === 0) {
      this.decks[Faction.Blue].draw();
      this.decks[Faction.Red].draw();
    }
  }

  /**
   * 校验出牌：阵营手牌齐全、牌型匹配阵型、落点在己方半场。
   * Spawn/PlaceBuilding 在对局路径上一般不走这里（沙盒仍可直接喂 World）。
   */
  validate(cmd: Command): boolean {
    if (cmd.kind !== CommandKind.PlayFormation) return true;
    return this.validatePlayFormation(cmd);
  }

  /** 世界 + 双方牌堆指纹，供联机 hash 对账。 */
  hash(): number {
    let h = this.world.hash();
    h = mix(h, this.decks[Faction.Blue].hash());
    h = mix(h, this.decks[Faction.Red].hash());
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
  }

  /**
   * 双方半场底端各落一座主堡，不推进 tick（避免联机首帧错位）。
   * 必须在 new MatchState(seed) 之后、第一次 step 之前调用，两端顺序一致。
   */
  seedStartingCastles(): void {
    const footprint = UNIT_CONFIGS.building_base.footprint;
    const centerX = toFloat(ARENA_WIDTH) / 2;
    const edgeInset = footprint / 2;
    this.world.spawnBuilding(
      Faction.Blue,
      'building_base',
      fromFloat(centerX),
      fromFloat(edgeInset),
    );
    this.world.spawnBuilding(
      Faction.Red,
      'building_base',
      fromFloat(centerX),
      fromFloat(toFloat(ARENA_HEIGHT) - edgeInset),
    );
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

/** FNV-1a，与 World.hash 同款混入。 */
function mix(hash: number, value: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (value >>> shift) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}
