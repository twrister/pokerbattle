import {
  ENDLESS_WAVE_BUDGET_MIN,
  ENDLESS_WAVE_INTERVAL_MIN,
  ENDLESS_WAVE_SECONDS_MAX,
  ENDLESS_WAVE_SECONDS_MIN,
  clampEndlessWaveSeconds,
  getEndlessWaveOverride,
  type EndlessWaveDraft,
} from '../../config/endlessConfig.js';
import { isBuildingConfig, isCastleId, type UnitTypeId } from '../../config/units.js';
import { ARENA_RIVER_MAX_Y, ARENA_RIVER_MIN_Y } from '../../config/arenaTerrain.js';
import { Faction } from '../../entity/unit.js';
import { type Fx, toFloat } from '../../math/fixed.js';
import { Rng } from '../../math/rng.js';
import type { MatchState } from '../../match/matchState.js';
import type { ScriptedEnemyStep, StageDef, StagePresetUnit } from '../stageDef.js';
import { isBossWave, type EndlessRunState } from './endlessRun.js';

/** 兵种池条目：价值决定一波预算能买多少，fromWave 决定第几波起出现。 */
interface WaveUnit {
  typeId: UnitTypeId;
  cost: number;
  fromWave: number;
}

/** 敌方兵种池，按解锁波次排列；调难度主要改这里和下面几个常量。 */
const WAVE_UNITS: readonly WaveUnit[] = [
  { typeId: 'melee_grunt', cost: 1, fromWave: 1 },
  { typeId: 'melee_guard', cost: 1.2, fromWave: 1 },
  { typeId: 'ranged_archer', cost: 1, fromWave: 3 },
  { typeId: 'melee_cavalry', cost: 2, fromWave: 5 },
  { typeId: 'ranged_chariot', cost: 3, fromWave: 5 },
  { typeId: 'melee_charge_wagon', cost: 3, fromWave: 7 },
  { typeId: 'melee_golem_small', cost: 5, fromWave: 9 },
  { typeId: 'dragon', cost: 6, fromWave: 11 },
];

/** Boss 单位：按 Boss 波序号轮换。 */
const BOSS_UNITS: readonly UnitTypeId[] = ['melee_golem', 'dragon', 'fire_dragon'];

/** 第 1 波总预算（单位价值），之后按 BUDGET_GROWTH 指数增长。 */
const BASE_BUDGET = 14;
const BUDGET_GROWTH = 1.18;
/** 第 1 波出兵间隔（秒），每波缩短 STEP，下限 MIN。 */
const BASE_INTERVAL = 15;
const INTERVAL_STEP = 0.8;
const MIN_INTERVAL = ENDLESS_WAVE_INTERVAL_MIN;
/** 出兵窗口开头留的缓冲（秒）：开局先给玩家看清场面。 */
const SPAWN_START_SECONDS = 2;
/** 出兵窗口结尾留的清场窗口（秒）：窗口内停止增兵，留给玩家收拾残局。 */
const SPAWN_TAIL_SECONDS = 10;
/** Boss 出场时间（秒）。 */
const BOSS_SPAWN_SECONDS = 20;
/** 出兵点：敌方半场靠后，横向在三路间轮换。 */
const SPAWN_LANES_X = [4, 9, 14] as const;
const SPAWN_Y = 27;

/** 一波的难度参数，纯函数方便单测与调参。 */
export interface WaveSpec {
  wave: number;
  budget: number;
  intervalSeconds: number;
  boss: boolean;
}

/** 计算第 wave 波的难度参数：配置页给了覆盖项就用覆盖值，否则按公式。 */
export function waveSpec(wave: number): WaveSpec {
  const override = getEndlessWaveOverride(wave);
  return {
    wave,
    budget: override?.budget ?? formulaBudget(wave),
    intervalSeconds: override?.intervalSeconds ?? formulaInterval(wave),
    boss: isBossWave(wave),
  };
}

/**
 * 公式预算：随波次指数增长，只兜住下界。
 * 上界 ENDLESS_WAVE_BUDGET_MAX 只约束手动配置，公式要继续增长才能保持难度单调。
 */
function formulaBudget(wave: number): number {
  const budget = BASE_BUDGET * BUDGET_GROWTH ** (Math.max(1, wave) - 1);
  return Math.max(ENDLESS_WAVE_BUDGET_MIN, budget);
}

/** 公式出兵间隔：逐波缩短到下限为止。 */
function formulaInterval(wave: number): number {
  return Math.max(MIN_INTERVAL, BASE_INTERVAL - INTERVAL_STEP * (Math.max(1, wave) - 1));
}

/** 公式默认值（不看配置覆盖），配置页拿它当输入框占位提示。 */
export function endlessWaveFormula(wave: number): { budget: number; intervalSeconds: number } {
  return { budget: formulaBudget(wave), intervalSeconds: formulaInterval(wave) };
}

/** 内置池里本波已解锁的兵种，配置页用来预填兵种勾选项与默认权重。 */
export function endlessDefaultWaveUnits(wave: number): Array<{ typeId: UnitTypeId; cost: number }> {
  return WAVE_UNITS.filter((unit) => unit.fromWave <= wave).map((unit) => ({
    typeId: unit.typeId,
    cost: unit.cost,
  }));
}

/** 某兵种在内置池里的默认价值；不在池里时按 1 计。 */
export function endlessDefaultUnitCost(typeId: UnitTypeId): number {
  return WAVE_UNITS.find((unit) => unit.typeId === typeId)?.cost ?? 1;
}

/**
 * 该波实际可用的兵种池：配置页写了就只按配置的兵种与权重，
 * 否则取内置池里本波已解锁的条目（权重就是它的价值 cost）。
 */
function wavePool(wave: number, override: EndlessWaveDraft | undefined): WaveUnit[] {
  if (override?.units && override.units.length > 0) {
    return override.units.map((unit) => ({ typeId: unit.typeId, cost: unit.weight, fromWave: 1 }));
  }
  return WAVE_UNITS.filter((unit) => unit.fromWave <= wave);
}

/** 一波的出兵窗口：该波覆盖值优先，其次用挑战存档锁定的窗口。 */
export function waveWindowSeconds(wave: number, fallbackSeconds: number): number {
  const override = getEndlessWaveOverride(wave);
  const seconds = override?.waveSeconds ?? fallbackSeconds;
  return clampEndlessWaveSeconds(
    Math.min(ENDLESS_WAVE_SECONDS_MAX, Math.max(ENDLESS_WAVE_SECONDS_MIN, seconds)),
  );
}

/** 一波的最后一次出兵时间（秒），清场目标等它到期才允许判定全灭。 */
function waveSpawnEndSeconds(waveSeconds: number): number {
  return Math.max(SPAWN_START_SECONDS, waveSeconds - SPAWN_TAIL_SECONDS);
}

/**
 * 生成一波的出兵脚本：把预算平均摊到每个出兵时间点，在已解锁兵种里随机买兵。
 * Boss 波开场额外放一只 Boss 单位。种子 = runSeed + wave，保证可复现。
 * waveSeconds 为出兵窗口，决定最后一个出兵时间点。
 */
export function buildWaveSteps(
  runSeed: number,
  wave: number,
  waveSeconds: number,
): ScriptedEnemyStep[] {
  const spec = waveSpec(wave);
  const rng = new Rng(((runSeed + wave * 7919) >>> 0) || 1);
  const pool = wavePool(wave, getEndlessWaveOverride(wave));
  const spawnEnd = waveSpawnEndSeconds(waveSeconds);
  // 最后一段时间不再出兵，给玩家清场的窗口
  const times: number[] = [];
  for (let t = SPAWN_START_SECONDS; t <= spawnEnd; t += spec.intervalSeconds) times.push(Math.round(t));
  const perPoint = spec.budget / Math.max(1, times.length);

  const steps: ScriptedEnemyStep[] = [];
  if (spec.boss) {
    const bossIndex = (wave / 5 - 1) % BOSS_UNITS.length;
    steps.push({
      atSeconds: Math.min(BOSS_SPAWN_SECONDS, spawnEnd),
      typeId: BOSS_UNITS[bossIndex]!,
      x: 9,
      y: SPAWN_Y,
    });
  }
  // 预算随时间点逐步上升：前半波轻、后半波重，结尾压力最大
  times.forEach((atSeconds, index) => {
    let budget = perPoint * (0.6 + (0.8 * index) / Math.max(1, times.length - 1));
    const x = SPAWN_LANES_X[rng.nextInt(SPAWN_LANES_X.length)]!;
    const bought = new Map<UnitTypeId, number>();
    while (budget > 0 && pool.length > 0) {
      const affordable = pool.filter((unit) => unit.cost <= budget + 0.5);
      if (affordable.length === 0) break;
      const unit = affordable[rng.nextInt(affordable.length)]!;
      bought.set(unit.typeId, (bought.get(unit.typeId) ?? 0) + 1);
      budget -= unit.cost;
    }
    let row = 0;
    for (const [typeId, count] of bought) {
      steps.push({ atSeconds, typeId, count, x, y: SPAWN_Y + row * 1.5 });
      row += 1;
    }
  });
  return steps;
}

/**
 * 收集玩家场上的存活单位，作为下一波的继承阵容。
 * 保留原位置与原血量比例，玩家攒下的前排与箭塔因此能延续到下一波。
 */
export function collectSurvivors(match: MatchState, faction: Faction = Faction.Blue): StagePresetUnit[] {
  const survivors: StagePresetUnit[] = [];
  for (const unit of match.world.units) {
    if (unit.dead || unit.faction !== faction) continue;
    const isBuilding = isBuildingConfig(unit.config);
    // 主堡不继承：每波会重新播种，血量走 castleHpRatio 单独继承
    if (isBuilding && isCastleId(unit.typeId)) continue;
    // 已过河的单位不继承：留在敌方半场等于白送，也避免回防兵被强行拉回
    if (!isBuilding && isPastRiver(unit.pos.y, faction)) continue;
    survivors.push({
      faction: faction === Faction.Blue ? 0 : 1,
      typeId: unit.typeId,
      x: toFloat(unit.pos.x),
      y: toFloat(unit.pos.y),
      hpRatio: unit.config.maxHp > 0 ? Math.min(1, Math.max(0.01, unit.hp / unit.config.maxHp)) : 1,
    });
  }
  return survivors;
}

/**
 * 单位是否已越过河道进入敌方半场。
 * 河道占据 [ARENA_RIVER_MIN_Y, ARENA_RIVER_MAX_Y]，蓝方过河即 y >= 上沿，红方反之。
 */
function isPastRiver(y: Fx, faction: Faction): boolean {
  const floatY = toFloat(y);
  return faction === Faction.Blue ? floatY >= ARENA_RIVER_MAX_Y : floatY < ARENA_RIVER_MIN_Y;
}

/**
 * 把挑战状态转成一份关卡定义，复用 StageRunner / ObjectiveTracker：
 * 敌方无主堡只进攻，目标是清光这一波的敌人。
 */
export function buildWaveStage(state: EndlessRunState): StageDef {
  const waveSeconds = waveWindowSeconds(state.wave, state.waveSeconds);
  const steps = buildWaveSteps(state.runSeed, state.wave, waveSeconds);
  // 清场目标的判定门槛取脚本里最后一次出兵的时刻：兵没放完就还有后续敌人
  const spawnEndSeconds = steps.reduce((end, step) => Math.max(end, step.atSeconds), 0);
  const inherited = state.carriedUnits ?? [];
  return {
    id: `endless_w${state.wave}`,
    index: 0,
    title: `无限防守 第 ${state.wave} 波`,
    // 无限波不靠对局计时收局：给一个足够大的兜底时长，实际结束看清场目标
    durationSeconds: waveSeconds * 10,
    playerCastleHpRatio: state.castleHpRatio,
    enemyCastles: false,
    wildCount: state.wildCards,
    rules: {
      wildCardsEnabled: state.wildCards > 0,
      initialHandSize: state.initialHandSize,
      normalHandLimit: state.handLimit,
      normalDrawIntervalSeconds: state.drawIntervalSeconds,
    },
    enemy: { kind: 'script', steps },
    // 上一波的存活单位原样摆回场上，玩家攒的阵容才能延续
    ...(inherited.length > 0 ? { preset: inherited } : {}),
    objectives: [{ kind: 'clear_wave', spawnEndSeconds }],
    seed: ((state.runSeed + state.wave) >>> 0) || 1,
  };
}

/**
 * 出兵进度（0~1）：已过去的秒数相对最后一次出兵时刻的比例，够 1 表示不再增兵。
 * HUD 用它画类似植物大战僵尸的出兵进度条。
 */
export function endlessWaveSpawnProgress(spawnEndSeconds: number, elapsedSeconds: number): number {
  if (spawnEndSeconds <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedSeconds / spawnEndSeconds));
}
