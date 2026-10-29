import { MAX_HAND_SIZE, MAX_WILD_CARDS } from '../../cards/deck.js';
import { defaultEndlessWaveSeconds, clampEndlessWaveSeconds } from '../../config/endlessConfig.js';
import { UNIT_CONFIGS, UNIT_TYPE_IDS, isBuildingConfig, isCastleId } from '../../config/units.js';
import type { StagePresetUnit } from '../stageDef.js';

/** 发牌间隔下限（秒），再快手牌会溢出、节奏失控。 */
export const ENDLESS_MIN_DRAW_INTERVAL = 2;
/** 每 N 波一个 Boss 波，通过后只给稀有强化。 */
export const ENDLESS_BOSS_EVERY = 5;
/** 继承到下一波的单位上限：再多会把玩家半场挤爆，也会让对局变成单边；建筑优先占位。 */
export const ENDLESS_MAX_CARRIED_UNITS = 30;

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
  /** 上一波结束时玩家场上的存活单位，原位置、原血量比例带入下一波开局。 */
  carriedUnits: StagePresetUnit[];
  /**
   * 上一波结束时玩家手上的牌（牌 id），下一波开局原样发回，最多收手牌上限张。
   * 缺省（undefined）表示还没继承过：首波与旧存档走规则里的默认起手；
   * 空数组表示上一波把牌打空了，下一波就是空手开局，不会再补默认起手。
   */
  carriedHand?: string[];
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
    drawIntervalSeconds: 5,
    castleHpRatio: 1,
    wildCards: 0,
    regenPerWave: 0,
    boons: [],
    totalSeconds: 0,
    carriedUnits: [],
  };
}

/** 是否 Boss 波。 */
export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % ENDLESS_BOSS_EVERY === 0;
}

/**
 * 撑过一波：记下残血、存活单位与手牌、累计时长并推进到下一波，同时结算每波回血。
 * remainingHpRatio 为本波结束时玩家主堡血量比例；
 * elapsedSeconds 为本波实际用时（清场流，时长不固定），缺省按窗口长度记；
 * survivors 为本波结束时玩家场上的存活单位，不带则清空继承（调试/旧调用方）；
 * hand 为本波结束时玩家手牌（牌 id）；不传表示这次不继承（下一波走默认起手），
 * 传空数组表示上一波把牌打空了，下一波也要空手开局。
 */
export function advanceWave(
  state: EndlessRunState,
  remainingHpRatio: number,
  elapsedSeconds: number = state.waveSeconds,
  survivors: readonly StagePresetUnit[] = [],
  hand?: readonly string[],
): EndlessRunState {
  const healed = clamp01(remainingHpRatio) + state.regenPerWave;
  return {
    ...state,
    wave: state.wave + 1,
    castleHpRatio: clamp01(healed),
    totalSeconds: state.totalSeconds + Math.max(0, elapsedSeconds),
    carriedUnits: sanitizeCarriedUnits(survivors),
    carriedHand: hand ? sanitizeCarriedHand(hand, state.handLimit) : undefined,
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
    drawIntervalSeconds: Math.max(ENDLESS_MIN_DRAW_INTERVAL, state.drawIntervalSeconds),
    castleHpRatio: Math.max(0.01, clamp01(state.castleHpRatio)),
    wildCards: clampInt(state.wildCards, 0, MAX_WILD_CARDS),
    regenPerWave: Math.max(0, Math.min(1, state.regenPerWave)),
    boons: [...state.boons],
    totalSeconds: Math.max(0, state.totalSeconds),
    carriedUnits: sanitizeCarriedUnits(state.carriedUnits),
    // 缺省保持缺省：未继承过的存档继续走默认起手，不能悄悄变成「空手开局」
    ...(state.carriedHand === undefined
      ? {}
      : { carriedHand: sanitizeCarriedHand(state.carriedHand, handLimit) }),
  };
}

/**
 * 清洗继承手牌：只保留非空字符串 id、去重并按手牌上限截断。
 * 非数组（旧存档、坏数据）按空数组处理，表示「没有可继承的手牌」。
 */
export function sanitizeCarriedHand(raw: unknown, handLimit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) continue;
    if (ids.includes(item)) continue;
    ids.push(item);
    if (ids.length >= handLimit) break;
  }
  return ids;
}

/**
 * 清洗继承单位：丢掉未知兵种、非有限坐标与主堡，最多保留 ENDLESS_MAX_CARRIED_UNITS 个。
 * 建筑（箭塔）优先入列，避免被可移动单位挤掉；血量比例缺失按满血处理，
 * 避免旧存档读进来每波都是残血。
 */
export function sanitizeCarriedUnits(raw: unknown): StagePresetUnit[] {
  if (!Array.isArray(raw)) return [];
  const buildings: StagePresetUnit[] = [];
  const mobiles: StagePresetUnit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<StagePresetUnit>;
    if (typeof entry.typeId !== 'string' || !UNIT_TYPE_IDS.includes(entry.typeId)) continue;
    const config = UNIT_CONFIGS[entry.typeId];
    // 主堡不进继承：每波重新播种，血量由 castleHpRatio 单独带
    if (isCastleId(entry.typeId)) continue;
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) continue;
    const hpRatio = typeof entry.hpRatio === 'number' && Number.isFinite(entry.hpRatio)
      ? clamp01(entry.hpRatio)
      : 1;
    const unit: StagePresetUnit = {
      faction: 0,
      typeId: entry.typeId,
      x: entry.x as number,
      y: entry.y as number,
      hpRatio,
    };
    (isBuildingConfig(config) ? buildings : mobiles).push(unit);
  }
  return [...buildings, ...mobiles].slice(0, ENDLESS_MAX_CARRIED_UNITS);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
