import { getFuseBombTypeId, resolveFormationSpawnsFx } from '../config/cardFormations.js';
import { resolveFuseBombDamage } from '../config/cardMapping.js';
import { TICK_RATE } from '../config/tuning.js';
import { Faction } from '../entity/unit.js';
import { fromFloat, toFloat } from '../math/fixed.js';
import { World } from '../world.js';
import { clamp01, isBattleSettled, remainingHp } from './battleOutcome.js';
import type { Entry } from './entries.js';

/** 同半场对拆锚点：避开河道，Blue 靠下、Red 靠上。 */
export const SOLO_BLUE_ANCHOR = { x: 9, y: 6 };
export const SOLO_RED_ANCHOR = { x: 9, y: 12 };

/** 混战各波次横向错开，避免后手叠在同一格。 */
const MELEE_WAVE_X = [6, 9, 12, 4, 14] as const;

export const DEFAULT_MAX_TICKS = 1200;
export const MELEE_DEPLOY_INTERVAL = TICK_RATE * 3;

/** 单场对拆的连续评分（0..1，0.5 为均势）。 */
export interface DuelResult {
  scoreA: number;
  hpFracA: number;
  hpFracB: number;
  ticks: number;
  timeout: boolean;
}

/** 混战一轮的队伍与评分。 */
export interface MeleeResult {
  teamA: string[];
  teamB: string[];
  scoreA: number;
  hpFracA: number;
  hpFracB: number;
  ticks: number;
  timeout: boolean;
}

/**
 * 沙盒 1v1：按阵型落点出兵，swap 时对调阵营与锚点以抵消站位偏差。
 * 引信炸弹走主堡抛物线，落在对方阵型中心。
 */
export function runDuel(a: Entry, b: Entry, seed: number, swap: boolean): DuelResult {
  const world = new World(seed);
  const aFaction = swap ? Faction.Red : Faction.Blue;
  const bFaction = swap ? Faction.Blue : Faction.Red;
  const aAnchor = swap ? SOLO_RED_ANCHOR : SOLO_BLUE_ANCHOR;
  const bAnchor = swap ? SOLO_BLUE_ANCHOR : SOLO_RED_ANCHOR;
  const maxHpA = deployEntry(world, a, aFaction, aAnchor.x, aAnchor.y, bAnchor.x, bAnchor.y);
  const maxHpB = deployEntry(world, b, bFaction, bAnchor.x, bAnchor.y, aAnchor.x, aAnchor.y);
  return finishBattle(world, aFaction, bFaction, maxHpA, maxHpB, DEFAULT_MAX_TICKS);
}

/**
 * 混战：双方各 K 个条目，每 3 秒投放一波，投完后再等到分出胜负或超时。
 */
export function runMelee(
  teamA: readonly Entry[],
  teamB: readonly Entry[],
  seed: number,
  swap: boolean,
  maxTicks = DEFAULT_MAX_TICKS,
): MeleeResult {
  const world = new World(seed);
  const aFaction = swap ? Faction.Red : Faction.Blue;
  const bFaction = swap ? Faction.Blue : Faction.Red;
  let maxHpA = 0;
  let maxHpB = 0;
  const waves = Math.max(teamA.length, teamB.length);
  const lastDeployTick = Math.max(0, waves - 1) * MELEE_DEPLOY_INTERVAL;
  let nextWave = 0;

  for (let tick = 0; tick < maxTicks; tick++) {
    if (tick === nextWave * MELEE_DEPLOY_INTERVAL && nextWave < waves) {
      const ax = MELEE_WAVE_X[nextWave % MELEE_WAVE_X.length]!;
      const bx = MELEE_WAVE_X[nextWave % MELEE_WAVE_X.length]!;
      const aAnchor = swap ? { x: ax, y: SOLO_RED_ANCHOR.y } : { x: ax, y: SOLO_BLUE_ANCHOR.y };
      const bAnchor = swap ? { x: bx, y: SOLO_BLUE_ANCHOR.y } : { x: bx, y: SOLO_RED_ANCHOR.y };
      const aEntry = teamA[nextWave];
      const bEntry = teamB[nextWave];
      if (aEntry) {
        maxHpA += deployEntry(world, aEntry, aFaction, aAnchor.x, aAnchor.y, bAnchor.x, bAnchor.y);
      }
      if (bEntry) {
        maxHpB += deployEntry(world, bEntry, bFaction, bAnchor.x, bAnchor.y, aAnchor.x, aAnchor.y);
      }
      nextWave += 1;
    }
    world.step();
    if (tick >= lastDeployTick && isBattleSettled(world, aFaction, bFaction)) {
      return toMeleeResult(teamA, teamB, world, aFaction, bFaction, maxHpA, maxHpB, false);
    }
  }
  return toMeleeResult(teamA, teamB, world, aFaction, bFaction, maxHpA, maxHpB, true);
}

/** 把阵型落到场上；炸弹不占 maxHp，由评分侧按「是否清场」折算。 */
function deployEntry(
  world: World,
  entry: Entry,
  faction: Faction,
  anchorX: number,
  anchorY: number,
  enemyX: number,
  enemyY: number,
): number {
  const bombType = getFuseBombTypeId(entry.formation);
  if (bombType) {
    const damage = resolveFuseBombDamage(entry.formation, entry.cards);
    const tx = fromFloat(enemyX);
    const ty = fromFloat(enemyY);
    if (bombType === 'giant_bomb') world.spawnGiantBomb(faction, tx, ty, damage);
    else world.spawnSmallBomb(faction, tx, ty, damage);
    return 0;
  }
  const points = resolveFormationSpawnsFx(
    entry.formation,
    faction,
    fromFloat(anchorX),
    fromFloat(anchorY),
  );
  let maxHp = 0;
  for (const point of points) {
    const unit = world.spawnUnit(faction, point.typeId, point.x, point.y);
    maxHp += toFloat(unit.hp);
  }
  return maxHp;
}

function finishBattle(
  world: World,
  factionA: Faction,
  factionB: Faction,
  maxHpA: number,
  maxHpB: number,
  maxTicks: number,
): DuelResult {
  for (let i = 0; i < maxTicks; i++) {
    world.step();
    if (isBattleSettled(world, factionA, factionB)) {
      return toDuelResult(world, factionA, factionB, maxHpA, maxHpB, false);
    }
  }
  return toDuelResult(world, factionA, factionB, maxHpA, maxHpB, true);
}

function toDuelResult(
  world: World,
  factionA: Faction,
  factionB: Faction,
  maxHpA: number,
  maxHpB: number,
  timeout: boolean,
): DuelResult {
  const remainA = remainingHp(world, factionA);
  const remainB = remainingHp(world, factionB);
  const hpFracA = hpFraction(maxHpA, remainA, maxHpB, remainB);
  const hpFracB = hpFraction(maxHpB, remainB, maxHpA, remainA);
  return {
    scoreA: clamp01((hpFracA - hpFracB + 1) / 2),
    hpFracA,
    hpFracB,
    ticks: world.tick,
    timeout,
  };
}

function toMeleeResult(
  teamA: readonly Entry[],
  teamB: readonly Entry[],
  world: World,
  factionA: Faction,
  factionB: Faction,
  maxHpA: number,
  maxHpB: number,
  timeout: boolean,
): MeleeResult {
  const duel = toDuelResult(world, factionA, factionB, maxHpA, maxHpB, timeout);
  return {
    teamA: teamA.map((entry) => entry.key),
    teamB: teamB.map((entry) => entry.key),
    scoreA: duel.scoreA,
    hpFracA: duel.hpFracA,
    hpFracB: duel.hpFracB,
    ticks: duel.ticks,
    timeout: duel.timeout,
  };
}

/**
 * 常规部队用「剩余 / 出场 maxHp」。
 * 引信炸弹没有驻场单位：清掉对方部队记 1，否则记 0，避免除零把炸清场判成平局。
 */
function hpFraction(ownMax: number, ownRemain: number, enemyMax: number, enemyRemain: number): number {
  if (ownMax > 0) return clamp01(ownRemain / ownMax);
  if (enemyMax > 0 && enemyRemain <= 0) return 1;
  return 0;
}

