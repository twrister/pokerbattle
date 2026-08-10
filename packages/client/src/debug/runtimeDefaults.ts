import {
  clampSoloCameraAngle,
  clampSoloViewBottomExtra,
  DEFAULT_SOLO_CAMERA_ANGLE_DEG,
  DEFAULT_SOLO_VIEW_BOTTOM_EXTRA,
} from '../view/scene.js';

/** localStorage 键：运行控制「保存为默认」后的参数 */
const STORAGE_KEY = 'pb.runtimeControls.defaults';

/** 与 MatchState 默认发牌周期一致（秒）。 */
export const DEFAULT_NORMAL_DRAW_INTERVAL_SECONDS = 6;
export const DEFAULT_DOUBLE_SPEED_DRAW_INTERVAL_SECONDS = 3;
export const DEFAULT_OVERTIME_DRAW_INTERVAL_SECONDS = 2;
const DRAW_INTERVAL_MIN = 0.25;
const DRAW_INTERVAL_MAX = 60;

export interface RuntimeDefaults {
  cameraAngle: number;
  viewBottomExtra: number;
  normalDrawIntervalSeconds: number;
  doubleSpeedDrawIntervalSeconds: number;
  overtimeDrawIntervalSeconds: number;
}

/** 内置默认；无本地记录或字段非法时回落至此。 */
export function builtInRuntimeDefaults(): RuntimeDefaults {
  return {
    cameraAngle: DEFAULT_SOLO_CAMERA_ANGLE_DEG,
    viewBottomExtra: DEFAULT_SOLO_VIEW_BOTTOM_EXTRA,
    normalDrawIntervalSeconds: DEFAULT_NORMAL_DRAW_INTERVAL_SECONDS,
    doubleSpeedDrawIntervalSeconds: DEFAULT_DOUBLE_SPEED_DRAW_INTERVAL_SECONDS,
    overtimeDrawIntervalSeconds: DEFAULT_OVERTIME_DRAW_INTERVAL_SECONDS,
  };
}

/** 读取已保存的运行控制默认值；缺省或损坏时与内置默认合并。 */
export function loadRuntimeDefaults(): RuntimeDefaults {
  const fallback = builtInRuntimeDefaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RuntimeDefaults>;
    return sanitizeRuntimeDefaults(parsed, fallback);
  } catch {
    return fallback;
  }
}

/** 将当前参数写入本地，供后续进局与刷新后沿用。 */
export function saveRuntimeDefaults(values: RuntimeDefaults): void {
  const next = sanitizeRuntimeDefaults(values, builtInRuntimeDefaults());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等写不进 storage 时忽略
  }
}

/** 发牌间隔控件合法区间。 */
export function clampDrawIntervalSeconds(seconds: number): number {
  return Math.min(DRAW_INTERVAL_MAX, Math.max(DRAW_INTERVAL_MIN, seconds));
}

/** 夹紧并填补非法字段，避免脏数据把镜头/计时打坏。 */
function sanitizeRuntimeDefaults(
  values: Partial<RuntimeDefaults>,
  fallback: RuntimeDefaults,
): RuntimeDefaults {
  const cameraAngle =
    typeof values.cameraAngle === 'number' && Number.isFinite(values.cameraAngle)
      ? clampSoloCameraAngle(values.cameraAngle)
      : fallback.cameraAngle;
  const viewBottomExtra =
    typeof values.viewBottomExtra === 'number' && Number.isFinite(values.viewBottomExtra)
      ? clampSoloViewBottomExtra(values.viewBottomExtra)
      : fallback.viewBottomExtra;
  return {
    cameraAngle,
    viewBottomExtra,
    normalDrawIntervalSeconds: readDrawInterval(
      values.normalDrawIntervalSeconds,
      fallback.normalDrawIntervalSeconds,
    ),
    doubleSpeedDrawIntervalSeconds: readDrawInterval(
      values.doubleSpeedDrawIntervalSeconds,
      fallback.doubleSpeedDrawIntervalSeconds,
    ),
    overtimeDrawIntervalSeconds: readDrawInterval(
      values.overtimeDrawIntervalSeconds,
      fallback.overtimeDrawIntervalSeconds,
    ),
  };
}

/** 非法或缺失时回落默认，合法则夹紧到控件区间。 */
function readDrawInterval(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampDrawIntervalSeconds(value)
    : fallback;
}
