import {
  FORMATION_COL_SPACING,
  FORMATION_ROW_SPACING,
  isFuseBombTypeId,
} from '../config/cardFormations.js';
import { TICK_RATE } from '../config/tuning.js';
import { getUnitConfig, isBuildingConfig, UNIT_TYPE_IDS, type UnitTypeId } from '../config/units.js';
import { Faction } from '../entity/unit.js';
import { fromFloat, toFloat } from '../math/fixed.js';
import { World } from '../world.js';
import { clamp01, countAlive, isBattleSettled, remainingHp } from './battleOutcome.js';
import { DEFAULT_MAX_TICKS, SOLO_BLUE_ANCHOR, SOLO_RED_ANCHOR } from './duel.js';

export { clamp01, countAlive, isBattleSettled, remainingHp };

/** 一条「兵种 + 数量」配置。 */
export interface MixUnitEntry {
  typeId: UnitTypeId;
  count: number;
}

export interface MixMatchupOptions {
  /** 双方共用的基础阵容。 */
  base?: readonly MixUnitEntry[];
  mixA?: readonly MixUnitEntry[];
  mixB?: readonly MixUnitEntry[];
  seed?: number;
  maxTicks?: number;
  /** 每排最多几人，默认 5。 */
  rowWidth?: number;
  /** 超时时血量比差距小于此值判平局。 */
  drawThreshold?: number;
}

/** 重建一场混编对局所需的全部输入；确定性保证同输入同结果。 */
export interface MixReplaySetup {
  unitsA: readonly MixUnitEntry[];
  unitsB: readonly MixUnitEntry[];
  seed: number;
  swap: boolean;
  rowWidth: number;
  maxTicks: number;
  /** 超时判平时用的血量比阈值，回放复现胜负需要。 */
  drawThreshold: number;
}

/** 一局的结果摘要 + 回放入口。 */
export interface MixGameRecord {
  index: number;
  round: number;
  swap: boolean;
  seed: number;
  winner: MixWinner;
  timeout: boolean;
  hpFracA: number;
  hpFracB: number;
  ticks: number;
  replay: MixReplaySetup;
}

/** 统计与回放共用的已落兵世界，避免两边站位漂移。 */
export interface MixWorldSession {
  world: World;
  aFaction: Faction;
  bFaction: Faction;
  maxHpA: number;
  maxHpB: number;
}

export const DEFAULT_MIX_BASE: readonly MixUnitEntry[] = [
  { typeId: 'melee_grunt', count: 5 },
  { typeId: 'ranged_archer', count: 5 },
];

export const DEFAULT_MIX_MATCHUP_OPTIONS = {
  base: DEFAULT_MIX_BASE,
  mixA: [] as MixUnitEntry[],
  mixB: [] as MixUnitEntry[],
  seed: 1,
  maxTicks: DEFAULT_MAX_TICKS,
  rowWidth: 5,
  drawThreshold: 0.05,
};

const MIX_ROW_WIDTH_MIN = 1;
const MIX_ROW_WIDTH_MAX = 12;

export type MixWinner = 'a' | 'b' | 'draw';

interface MixDuelResult {
  winner: MixWinner;
  timeout: boolean;
  hpFracA: number;
  hpFracB: number;
  ticks: number;
}

/** 可混编的地面作战单位，排除建筑与引信炸弹。 */
export function listMixableUnitTypeIds(): UnitTypeId[] {
  return UNIT_TYPE_IDS.filter((id) => isDeployableUnit(id));
}

/**
 * 按攻击类型将近战排在前、远程排在后，每排最多 rowWidth 人。
 * 建筑与炸弹会被丢掉，避免混编站位无法落地。
 */
export function layoutMixedRows(
  units: readonly MixUnitEntry[],
  rowWidth: number,
): UnitTypeId[][] {
  const width = clampInt(rowWidth, MIX_ROW_WIDTH_MIN, MIX_ROW_WIDTH_MAX);
  const melee: UnitTypeId[] = [];
  const ranged: UnitTypeId[] = [];
  for (const typeId of expandEntries(units)) {
    const attack = getUnitConfig(typeId).attack.kind;
    (attack === 'melee' || attack === 'melee_aoe' ? melee : ranged).push(typeId);
  }
  return [...chunk(melee, width), ...chunk(ranged, width)];
}

/**
 * 只跑正手一场，返回摘要与可回放的建场输入；不做多局统计。
 * 超时用剩余血量比判优势方，差距过小记平局。
 */
export function runMixSingleGame(options: MixMatchupOptions = {}): MixGameRecord {
  const resolved = resolveMixOptions(options);
  const unitsA = [...resolved.base, ...resolved.mixA];
  const unitsB = [...resolved.base, ...resolved.mixB];
  const result = runMixDuel(
    unitsA,
    unitsB,
    resolved.seed,
    false,
    resolved.maxTicks,
    resolved.rowWidth,
    resolved.drawThreshold,
  );
  return toGameRecord(1, 1, resolved.seed, false, result, {
    unitsA,
    unitsB,
    seed: resolved.seed,
    swap: false,
    rowWidth: resolved.rowWidth,
    maxTicks: resolved.maxTicks,
    drawThreshold: resolved.drawThreshold,
  });
}

export function resolveMixOptions(options: MixMatchupOptions = {}): {
  base: MixUnitEntry[];
  mixA: MixUnitEntry[];
  mixB: MixUnitEntry[];
  seed: number;
  maxTicks: number;
  rowWidth: number;
  drawThreshold: number;
} {
  return {
    base: normalizeEntries(options.base ?? DEFAULT_MIX_MATCHUP_OPTIONS.base),
    mixA: normalizeEntries(options.mixA ?? DEFAULT_MIX_MATCHUP_OPTIONS.mixA),
    mixB: normalizeEntries(options.mixB ?? DEFAULT_MIX_MATCHUP_OPTIONS.mixB),
    seed: (options.seed ?? DEFAULT_MIX_MATCHUP_OPTIONS.seed) | 0 || 1,
    maxTicks: Math.max(1, Math.floor(options.maxTicks ?? DEFAULT_MIX_MATCHUP_OPTIONS.maxTicks)),
    rowWidth: clampInt(
      options.rowWidth ?? DEFAULT_MIX_MATCHUP_OPTIONS.rowWidth,
      MIX_ROW_WIDTH_MIN,
      MIX_ROW_WIDTH_MAX,
    ),
    drawThreshold: clamp01(options.drawThreshold ?? DEFAULT_MIX_MATCHUP_OPTIONS.drawThreshold),
  };
}

/** 建好 World 并按混编阵型落兵；统计与回放共用，避免两边站位漂移。 */
export function setupMixWorld(setup: MixReplaySetup): MixWorldSession {
  const world = new World(setup.seed);
  const aFaction = setup.swap ? Faction.Red : Faction.Blue;
  const bFaction = setup.swap ? Faction.Blue : Faction.Red;
  const aAnchor = setup.swap ? SOLO_RED_ANCHOR : SOLO_BLUE_ANCHOR;
  const bAnchor = setup.swap ? SOLO_BLUE_ANCHOR : SOLO_RED_ANCHOR;
  const maxHpA = deployMixedArmy(world, setup.unitsA, aFaction, aAnchor.x, aAnchor.y, setup.rowWidth);
  const maxHpB = deployMixedArmy(world, setup.unitsB, bFaction, bAnchor.x, bAnchor.y, setup.rowWidth);
  return { world, aFaction, bFaction, maxHpA, maxHpB };
}

/**
 * 从已步进的世界读出胜负与剩余血量。
 * 回放测试用同一套判定，避免 UI 自己重写超时/平局规则。
 */
export function summarizeMixWorld(
  session: MixWorldSession,
  timeout: boolean,
  drawThreshold: number,
): MixDuelResult {
  const aliveA = countAlive(session.world, session.aFaction);
  const aliveB = countAlive(session.world, session.bFaction);
  const remainA = remainingHp(session.world, session.aFaction);
  const remainB = remainingHp(session.world, session.bFaction);
  const hpFracA = session.maxHpA > 0 ? clamp01(remainA / session.maxHpA) : 0;
  const hpFracB = session.maxHpB > 0 ? clamp01(remainB / session.maxHpB) : 0;
  return {
    winner: decideWinner(aliveA, aliveB, hpFracA, hpFracB, timeout, drawThreshold),
    timeout,
    hpFracA,
    hpFracB,
    ticks: session.world.tick,
  };
}

/** 把混编列表按阵型落点投到半场锚点，再步进到分出胜负或超时。 */
function runMixDuel(
  unitsA: readonly MixUnitEntry[],
  unitsB: readonly MixUnitEntry[],
  seed: number,
  swap: boolean,
  maxTicks: number,
  rowWidth: number,
  drawThreshold: number,
): MixDuelResult {
  const session = setupMixWorld({
    unitsA,
    unitsB,
    seed,
    swap,
    rowWidth,
    maxTicks,
    drawThreshold,
  });
  let timeout = true;
  for (let i = 0; i < maxTicks; i += 1) {
    session.world.step();
    if (isBattleSettled(session.world, session.aFaction, session.bFaction)) {
      timeout = false;
      break;
    }
  }
  return summarizeMixWorld(session, timeout, drawThreshold);
}

function toGameRecord(
  index: number,
  round: number,
  seed: number,
  swap: boolean,
  result: MixDuelResult,
  replay: MixReplaySetup,
): MixGameRecord {
  return {
    index,
    round,
    swap,
    seed,
    winner: result.winner,
    timeout: result.timeout,
    hpFracA: result.hpFracA,
    hpFracB: result.hpFracB,
    ticks: result.ticks,
    replay: {
      unitsA: replay.unitsA.map((entry) => ({ ...entry })),
      unitsB: replay.unitsB.map((entry) => ({ ...entry })),
      seed: replay.seed,
      swap: replay.swap,
      rowWidth: replay.rowWidth,
      maxTicks: replay.maxTicks,
      drawThreshold: replay.drawThreshold,
    },
  };
}

/**
 * 全灭结束看谁还活着；超时比剩余血量比，差距不够大记平。
 * 换边后仍按配置方 A/B 记胜负，不跟蓝红阵营绑定。
 */
function decideWinner(
  aliveA: number,
  aliveB: number,
  hpFracA: number,
  hpFracB: number,
  timeout: boolean,
  drawThreshold: number,
): MixWinner {
  if (!timeout) {
    if (aliveA > 0 && aliveB === 0) return 'a';
    if (aliveB > 0 && aliveA === 0) return 'b';
    return 'draw';
  }
  const diff = hpFracA - hpFracB;
  if (diff > drawThreshold) return 'a';
  if (diff < -drawThreshold) return 'b';
  return 'draw';
}

function deployMixedArmy(
  world: World,
  units: readonly MixUnitEntry[],
  faction: Faction,
  anchorX: number,
  anchorY: number,
  rowWidth: number,
): number {
  const rows = layoutMixedRows(units, rowWidth);
  const points = resolveMixedSpawns(rows, faction, anchorX, anchorY);
  let maxHp = 0;
  for (const point of points) {
    const unit = world.spawnUnit(faction, point.typeId, fromFloat(point.x), fromFloat(point.y));
    maxHp += toFloat(unit.hp);
  }
  return maxHp;
}

/** 与阵型落点同一套朝向：row=0 朝敌，整阵以锚点为几何中心。 */
function resolveMixedSpawns(
  rows: readonly (readonly UnitTypeId[])[],
  faction: Faction,
  anchorX: number,
  anchorY: number,
): Array<{ typeId: UnitTypeId; x: number; y: number }> {
  if (rows.length === 0) return [];
  const maxRow = rows.length - 1;
  const forwardCenter = (maxRow * FORMATION_ROW_SPACING) / 2;
  const facingForward = faction === Faction.Blue ? 1 : -1;
  const facingRight = faction === Faction.Blue ? 1 : -1;
  const points: Array<{ typeId: UnitTypeId; x: number; y: number }> = [];
  rows.forEach((row, rowIndex) => {
    const width = row.length;
    row.forEach((typeId, col) => {
      const localRight = (col - (width - 1) / 2) * FORMATION_COL_SPACING;
      const localForward = forwardCenter - rowIndex * FORMATION_ROW_SPACING;
      points.push({
        typeId,
        x: anchorX + facingRight * localRight,
        y: anchorY + facingForward * localForward,
      });
    });
  });
  return points;
}

function expandEntries(entries: readonly MixUnitEntry[]): UnitTypeId[] {
  const out: UnitTypeId[] = [];
  for (const entry of entries) {
    if (!isDeployableUnit(entry.typeId)) continue;
    const count = Math.max(0, Math.floor(entry.count));
    for (let i = 0; i < count; i += 1) out.push(entry.typeId);
  }
  return out;
}

function normalizeEntries(entries: readonly MixUnitEntry[]): MixUnitEntry[] {
  return entries
    .filter((entry) => isDeployableUnit(entry.typeId) && Number.isFinite(entry.count) && entry.count > 0)
    .map((entry) => ({ typeId: entry.typeId, count: Math.floor(entry.count) }));
}

function isDeployableUnit(typeId: UnitTypeId): boolean {
  if (isFuseBombTypeId(typeId)) return false;
  return !isBuildingConfig(getUnitConfig(typeId));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 给 UI 把 tick 换成秒；逻辑帧率固定。 */
export function mixTicksToSeconds(ticks: number): number {
  return ticks / TICK_RATE;
}
