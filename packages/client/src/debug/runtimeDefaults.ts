import { dumpArenaConfigDraft } from '@pb/sim';
import { clampSoloCameraAngle, clampSoloViewBottomExtra } from '../view/scene.js';
import {
  defaultMatchRulesView,
  sanitizeMatchRulesView,
  type MatchRulesView,
} from './matchRulesView.js';

/** localStorage 键：运行控制「保存为默认」后的镜头与对局节奏 */
const STORAGE_KEY = 'pb.runtimeControls.defaults';

export interface RuntimeDefaults {
  cameraAngle: number;
  viewBottomExtra: number;
  /** 单机调试节奏；联机仍走 sim 常量，不读这份本地覆盖。 */
  matchRules: MatchRulesView;
}

/** 内置默认：镜头读 arena.json，节奏读 sim 常量。 */
export function builtInRuntimeDefaults(): RuntimeDefaults {
  const camera = dumpArenaConfigDraft().camera;
  return {
    cameraAngle: camera.angleDeg,
    viewBottomExtra: camera.bottomExtra,
    matchRules: defaultMatchRulesView(),
  };
}

/** 读取运行控制默认值；镜头以 arena 为准，对局节奏可走本地覆盖。 */
export function loadRuntimeDefaults(): RuntimeDefaults {
  const fallback = builtInRuntimeDefaults();
  return {
    cameraAngle: fallback.cameraAngle,
    viewBottomExtra: fallback.viewBottomExtra,
    matchRules: readStoredMatchRules() ?? fallback.matchRules,
  };
}

/** 将当前镜头与对局节奏写入本地，供后续进局与刷新后沿用。 */
export function saveRuntimeDefaults(values: {
  cameraAngle: number;
  viewBottomExtra: number;
  matchRules?: Partial<MatchRulesView>;
}): void {
  const fallback = builtInRuntimeDefaults();
  const next: RuntimeDefaults = {
    cameraAngle: readCameraAngle(values.cameraAngle, fallback.cameraAngle),
    viewBottomExtra: readBottomExtra(values.viewBottomExtra, fallback.viewBottomExtra),
    // 只改镜头时保留已保存的节奏，避免点保存把阶段时长冲掉
    matchRules: sanitizeMatchRulesView(
      values.matchRules ?? readStoredMatchRules() ?? fallback.matchRules,
    ),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等写不进 storage 时忽略
  }
}

/** 只认嵌套 matchRules，忽略统一节奏前残留的扁平发牌间隔字段。 */
function readStoredMatchRules(): MatchRulesView | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RuntimeDefaults>;
    return isMatchRulesRecord(parsed.matchRules)
      ? sanitizeMatchRulesView(parsed.matchRules)
      : null;
  } catch {
    return null;
  }
}

function isMatchRulesRecord(value: unknown): value is Partial<MatchRulesView> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCameraAngle(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampSoloCameraAngle(value)
    : fallback;
}

function readBottomExtra(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampSoloViewBottomExtra(value)
    : fallback;
}
