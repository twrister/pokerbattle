import type { UnitTypeId } from '../../config/units.js';
import { Rng } from '../../math/rng.js';
import type { ScriptedEnemyStep, StageDef } from '../stageDef.js';
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
const MIN_INTERVAL = 6;
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

/** 计算第 wave 波的难度参数。 */
export function waveSpec(wave: number): WaveSpec {
  return {
    wave,
    budget: BASE_BUDGET * BUDGET_GROWTH ** (wave - 1),
    intervalSeconds: Math.max(MIN_INTERVAL, BASE_INTERVAL - INTERVAL_STEP * (wave - 1)),
    boss: isBossWave(wave),
  };
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
  const pool = WAVE_UNITS.filter((unit) => unit.fromWave <= wave);
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
    while (budget > 0) {
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
 * 把挑战状态转成一份关卡定义，复用 StageRunner / ObjectiveTracker：
 * 敌方无主堡只进攻，目标是清光这一波的敌人。
 */
export function buildWaveStage(state: EndlessRunState): StageDef {
  const steps = buildWaveSteps(state.runSeed, state.wave, state.waveSeconds);
  // 清场目标的判定门槛取脚本里最后一次出兵的时刻：兵没放完就还有后续敌人
  const spawnEndSeconds = steps.reduce((end, step) => Math.max(end, step.atSeconds), 0);
  return {
    id: `endless_w${state.wave}`,
    index: 0,
    title: `无限防守 第 ${state.wave} 波`,
    // 无限波不靠对局计时收局：给一个足够大的兜底时长，实际结束看清场目标
    durationSeconds: state.waveSeconds * 10,
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
