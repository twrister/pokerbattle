import { MAX_HAND_SIZE, MAX_WILD_CARDS } from '../../cards/deck.js';
import { defaultEndlessWaveSeconds, clampEndlessWaveSeconds } from '../../config/endlessConfig.js';

/** 发牌间隔下限（秒），再快手牌会溢出、节奏失控。 */
export const ENDLESS_MIN_DRAW_INTERVAL = 2;
/** 每 N 波一个 Boss 波，通过后只给稀有强化。 */
export const ENDLESS_BOSS_EVERY = 5;

/**
 * 一次无限防守挑战（Run）的全部继承状态。
 * 纯数据，可直接 JSON 存档；每波开局按它生成关卡。
 */
export interface EndlessRunState {
  /** 本次挑战的种子，波次生成与强化抽取都由它派生，保证可复现。 */
  runSeed: number;
  /** 即将开打（或正在打）的波次，从 1 开始。 */
  wave: number;
  /** 本局的出兵窗口（秒），跟存档走，续玩不会被中途改配置影响。 */
  waveSeconds: number;
  /** 手牌上限。 */
  handLimit: number;
  /** 起手张数，不超过手牌上限。 */
  initialHandSize: number;
  /** 发牌间隔（秒）。 */
  drawIntervalSeconds: number;
  /** 玩家主堡开局血量比例（0~1），由上一波结束时的残血继承。 */
  castleHpRatio: number;
  /** 万能牌张数，0 表示不放万能牌。 */
  wildCards: number;
  /** 每波结束自动回血比例（可叠加）。 */
  regenPerWave: number;
  /** 已选强化 id，按选择顺序记录，供结算展示与排行榜校验。 */
  boons: string[];
  /** 已撑过的累计秒数。 */
  totalSeconds: number;
}

/**
 * 新开一次挑战的初始状态。
 * waveSeconds 缺省取运行时配置，调用方要锁定配置时可显式传入。
 */
export function createRun(runSeed: number, waveSeconds: number = defaultEndlessWaveSeconds()): EndlessRunState {
  return {
    runSeed: runSeed >>> 0,
    wave: 1,
    waveSeconds: clampEndlessWaveSeconds(waveSeconds),
    handLimit: 7,
    initialHandSize: 5,
    drawIntervalSeconds: 5,
    castleHpRatio: 1,
    wildCards: 0,
    regenPerWave: 0,
    boons: [],
    totalSeconds: 0,
  };
}

/** 是否 Boss 波。 */
export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % ENDLESS_BOSS_EVERY === 0;
}

/**
 * 撑过一波：记下残血、累计时长并推进到下一波，同时结算每波回血。
 * remainingHpRatio 为本波结束时玩家主堡血量比例；
 * elapsedSeconds 为本波实际用时（清场流，时长不固定），缺省按窗口长度记。
 */
export function advanceWave(
  state: EndlessRunState,
  remainingHpRatio: number,
  elapsedSeconds: number = state.waveSeconds,
): EndlessRunState {
  const healed = clamp01(remainingHpRatio) + state.regenPerWave;
  return {
    ...state,
    wave: state.wave + 1,
    castleHpRatio: clamp01(healed),
    totalSeconds: state.totalSeconds + Math.max(0, elapsedSeconds),
  };
}

/** 把任意数值夹到合法区间，读存档与应用强化共用，防止坏数据卡死对局。 */
export function sanitizeRun(state: EndlessRunState): EndlessRunState {
  const handLimit = clampInt(state.handLimit, 1, MAX_HAND_SIZE);
  return {
    ...state,
    runSeed: state.runSeed >>> 0,
    wave: Math.max(1, Math.floor(state.wave)),
    waveSeconds: clampEndlessWaveSeconds(
      Number.isFinite(state.waveSeconds) ? state.waveSeconds : defaultEndlessWaveSeconds(),
    ),
    handLimit,
    initialHandSize: clampInt(state.initialHandSize, 1, handLimit),
    drawIntervalSeconds: Math.max(ENDLESS_MIN_DRAW_INTERVAL, state.drawIntervalSeconds),
    castleHpRatio: Math.max(0.01, clamp01(state.castleHpRatio)),
    wildCards: clampInt(state.wildCards, 0, MAX_WILD_CARDS),
    regenPerWave: Math.max(0, Math.min(1, state.regenPerWave)),
    boons: [...state.boons],
    totalSeconds: Math.max(0, state.totalSeconds),
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
