import { dumpArenaConfigDraft } from '@pb/sim';
import { clampSoloCameraAngle, clampSoloViewBottomExtra } from '../view/scene.js';

/** localStorage 键：运行控制「保存为默认」后的镜头参数 */
const STORAGE_KEY = 'pb.runtimeControls.defaults';

export interface RuntimeDefaults {
  cameraAngle: number;
  viewBottomExtra: number;
}

/** 内置默认：镜头读 arena.json。对局节奏不进本地存储，与联机共用 sim 常量。 */
export function builtInRuntimeDefaults(): RuntimeDefaults {
  const camera = dumpArenaConfigDraft().camera;
  return {
    cameraAngle: camera.angleDeg,
    viewBottomExtra: camera.bottomExtra,
  };
}

/** 读取运行控制默认值；镜头以 arena 配置为准。 */
export function loadRuntimeDefaults(): RuntimeDefaults {
  return builtInRuntimeDefaults();
}

/** 将当前镜头参数写入本地，供后续进局与刷新后沿用。 */
export function saveRuntimeDefaults(values: RuntimeDefaults): void {
  const next = sanitizeRuntimeDefaults(values, builtInRuntimeDefaults());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等写不进 storage 时忽略
  }
}

/** 夹紧并填补非法字段，避免脏数据把镜头打坏。 */
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
  };
}
