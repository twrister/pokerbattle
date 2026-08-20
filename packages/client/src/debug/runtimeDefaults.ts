import { dumpArenaConfigDraft } from '@pb/sim';
import { clampSoloCameraAngle, clampSoloViewBottomExtra } from '../view/scene.js';
import { defaultMatchRulesView, type MatchRulesView } from './matchRulesView.js';

/** localStorage 键：运行控制「保存为默认」后的镜头；节奏改走 matchRules.json */
const STORAGE_KEY = 'pb.runtimeControls.defaults';

export interface RuntimeDefaults {
  cameraAngle: number;
  viewBottomExtra: number;
  /** 对局节奏读 sim 草稿（matchRules.json / 本次写回后的运行时）。 */
  matchRules: MatchRulesView;
}

/** 内置默认：镜头读 arena.json，节奏读 matchRules.json。 */
export function builtInRuntimeDefaults(): RuntimeDefaults {
  const camera = dumpArenaConfigDraft().camera;
  return {
    cameraAngle: camera.angleDeg,
    viewBottomExtra: camera.bottomExtra,
    matchRules: defaultMatchRulesView(),
  };
}

/** 读取运行控制默认值；镜头以 arena 为准，节奏以 sim 草稿为准。 */
export function loadRuntimeDefaults(): RuntimeDefaults {
  return builtInRuntimeDefaults();
}

/** 将当前镜头写入本地；对局节奏由调试面板另行写回 matchRules.json。 */
export function saveRuntimeDefaults(values: {
  cameraAngle: number;
  viewBottomExtra: number;
}): void {
  const fallback = builtInRuntimeDefaults();
  const next = {
    cameraAngle: readCameraAngle(values.cameraAngle, fallback.cameraAngle),
    viewBottomExtra: readBottomExtra(values.viewBottomExtra, fallback.viewBottomExtra),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等写不进 storage 时忽略
  }
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
