import { toFloat } from '../math/fixed.js';
import { ARENA_HEIGHT, ARENA_WIDTH, setArenaSize } from './arena.js';
import {
  ARENA_BRIDGES,
  ARENA_RIVER_MAX_Y,
  ARENA_RIVER_MIN_Y,
  centeredRiverRange,
  setArenaTerrain,
  type ArenaBridge,
} from './arenaTerrain.js';
import rawArenaConfig from './arena.json';

/** 单机镜头投影方式：正交无透视，透视可调 FOV。 */
export type ArenaCameraMode = 'ortho' | 'perspective';

/** 镜头草稿：正交看俯仰/留白，透视额外看 FOV、距离与画面上下偏移。 */
export interface ArenaCameraDraft {
  mode: ArenaCameraMode;
  fov: number;
  /** 透视镜头到场地中心的距离（世界单位）；正交位姿仍用默认 50。 */
  distance: number;
  angleDeg: number;
  bottomExtra: number;
  /** 透视镜头沿画面竖直方向的位移；正值让场景上移。正交忽略。 */
  offsetY: number;
}

/** 场景各块颜色，CSS #rrggbb。 */
export interface ArenaColorsDraft {
  background: string;
  ground: string;
  river: string;
  bridge: string;
  grid: string;
  border: string;
}

/** 场景配置页与 JSON 共用的完整草稿。 */
export interface ArenaConfigDraft {
  width: number;
  height: number;
  riverWidth: number;
  bridges: ArenaBridge[];
  camera: ArenaCameraDraft;
  colors: ArenaColorsDraft;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_SIDE_CELLS = 1;
const MIN_RIVER_WIDTH = 1;
const MAX_BRIDGES = 8;
const FOV_MIN = 20;
const FOV_MAX = 90;
const DISTANCE_MIN = 8;
const DISTANCE_MAX = 120;
const DEFAULT_CAMERA_DISTANCE = 50;
const ANGLE_MIN = 15;
const ANGLE_MAX = 90;
const BOTTOM_EXTRA_MIN = 0;
const BOTTOM_EXTRA_MAX = 15;
const OFFSET_Y_MIN = -30;
const OFFSET_Y_MAX = 30;

/** 从 JSON 初始化运行时布局；非法文件回落到当前硬编码默认。 */
const initialDraft = parseArenaConfigDraft(rawArenaConfig) ?? fallbackArenaConfigDraft();
applyArenaLayout(initialDraft);
let runtimeVisual: Pick<ArenaConfigDraft, 'camera' | 'colors'> = {
  camera: { ...initialDraft.camera },
  colors: { ...initialDraft.colors },
};
let defaultDraft: ArenaConfigDraft = cloneArenaConfigDraft(initialDraft);

/** 导出当前运行时场景草稿：布局读可变常量，镜头/颜色读最近一次 apply。 */
export function dumpArenaConfigDraft(): ArenaConfigDraft {
  const width = Math.round(toFloat(ARENA_WIDTH));
  const height = Math.round(toFloat(ARENA_HEIGHT));
  return {
    width,
    height,
    riverWidth: ARENA_RIVER_MAX_Y - ARENA_RIVER_MIN_Y,
    bridges: ARENA_BRIDGES.map((bridge) => ({ ...bridge })),
    camera: { ...runtimeVisual.camera },
    colors: { ...runtimeVisual.colors },
  };
}

/** 导出最近一次成功保存（或模块加载）的快照，供重置表单。 */
export function dumpDefaultArenaConfigDraft(): ArenaConfigDraft {
  return cloneArenaConfigDraft(defaultDraft);
}

/** 校验场景草稿；通过返回 undefined。 */
export function validateArenaConfigDraft(draft: unknown): string | undefined {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return '配置必须是对象';
  const value = draft as Partial<ArenaConfigDraft>;
  if (!isPositiveInt(value.width)) return '场地宽必须是正整数';
  if (!isPositiveInt(value.height)) return '场地高必须是正整数';
  if (!isPositiveInt(value.riverWidth) || value.riverWidth < MIN_RIVER_WIDTH) {
    return '河道宽度必须是正整数';
  }
  if (value.riverWidth! >= value.height!) return '河道宽度必须小于场地高';
  if (value.height! - value.riverWidth! < MIN_SIDE_CELLS * 2) {
    return '河道两侧半场至少各保留 1 格';
  }
  if (!Array.isArray(value.bridges) || value.bridges.length === 0) return '至少需要一座桥';
  if (value.bridges.length > MAX_BRIDGES) return `桥数量不能超过 ${MAX_BRIDGES}`;
  const sorted = [...value.bridges].sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < sorted.length; i++) {
    const bridge = sorted[i]!;
    const error = validateBridge(bridge, value.width!);
    if (error) return error;
    const next = sorted[i + 1];
    if (next && bridge.maxX > next.minX) return '桥不能重叠';
  }
  const cameraError = validateCamera(value.camera);
  if (cameraError) return cameraError;
  const colorsError = validateColors(value.colors);
  if (colorsError) return colorsError;
  return undefined;
}

/** 校验通过后覆盖运行时场地/河桥/镜头/颜色。下一局 World 会读到新尺寸。 */
export function applyArenaConfigDraft(draft: ArenaConfigDraft): void {
  const error = validateArenaConfigDraft(draft);
  if (error) throw new Error(error);
  const next = cloneArenaConfigDraft(draft);
  applyArenaLayout(next);
  runtimeVisual = { camera: { ...next.camera }, colors: { ...next.colors } };
}

/** 恢复到最近一次成功保存（或初始加载）的配置快照。 */
export function resetArenaConfigToDefault(): void {
  applyArenaConfigDraft(defaultDraft);
}

/** 成功写回 JSON 后，把当前配置设为后续重置基准。 */
export function captureArenaConfigAsDefault(): void {
  defaultDraft = dumpArenaConfigDraft();
}

function applyArenaLayout(draft: ArenaConfigDraft): void {
  const river = centeredRiverRange(draft.height, draft.riverWidth);
  setArenaSize(draft.width, draft.height);
  setArenaTerrain(river.minY, river.maxY, draft.bridges);
}

function parseArenaConfigDraft(raw: unknown): ArenaConfigDraft | null {
  if (validateArenaConfigDraft(raw)) return null;
  return cloneArenaConfigDraft(raw as ArenaConfigDraft);
}

function fallbackArenaConfigDraft(): ArenaConfigDraft {
  return {
    width: 18,
    height: 31,
    riverWidth: 1,
    bridges: [
      { minX: 3, maxX: 5 },
      { minX: 13, maxX: 15 },
    ],
    camera: {
      mode: 'ortho',
      fov: 45,
      distance: DEFAULT_CAMERA_DISTANCE,
      angleDeg: 46,
      bottomExtra: 8,
      offsetY: 0,
    },
    colors: {
      background: '#0d1117',
      ground: '#2b3444',
      river: '#173c4d',
      bridge: '#8b6a42',
      grid: '#3b4557',
      border: '#8394ad',
    },
  };
}

function cloneArenaConfigDraft(draft: ArenaConfigDraft): ArenaConfigDraft {
  return {
    width: draft.width,
    height: draft.height,
    riverWidth: draft.riverWidth,
    bridges: draft.bridges.map((bridge) => ({ minX: bridge.minX, maxX: bridge.maxX })),
    camera: {
      ...draft.camera,
      distance: isFiniteNumber(draft.camera.distance) ? draft.camera.distance : DEFAULT_CAMERA_DISTANCE,
      offsetY: isFiniteNumber(draft.camera.offsetY) ? draft.camera.offsetY : 0,
    },
    colors: { ...draft.colors },
  };
}

function validateBridge(bridge: ArenaBridge, width: number): string | undefined {
  if (!Number.isInteger(bridge.minX) || !Number.isInteger(bridge.maxX)) return '桥坐标必须是整数';
  if (bridge.minX < 0 || bridge.maxX > width) return '桥必须落在场地宽度内';
  if (bridge.maxX - bridge.minX < 1) return '桥宽度至少 1 格';
  return undefined;
}

function validateCamera(camera: ArenaCameraDraft | undefined): string | undefined {
  if (!camera || typeof camera !== 'object') return '缺少镜头配置';
  if (camera.mode !== 'ortho' && camera.mode !== 'perspective') return '镜头模式必须是正交或透视';
  if (!isFiniteNumber(camera.fov) || camera.fov < FOV_MIN || camera.fov > FOV_MAX) {
    return `FOV 必须在 ${FOV_MIN}–${FOV_MAX}`;
  }
  if (camera.distance !== undefined) {
    if (!isFiniteNumber(camera.distance) || camera.distance < DISTANCE_MIN || camera.distance > DISTANCE_MAX) {
      return `镜头距离必须在 ${DISTANCE_MIN}–${DISTANCE_MAX}`;
    }
  }
  if (!isFiniteNumber(camera.angleDeg) || camera.angleDeg < ANGLE_MIN || camera.angleDeg > ANGLE_MAX) {
    return `俯仰角必须在 ${ANGLE_MIN}–${ANGLE_MAX}`;
  }
  if (
    !isFiniteNumber(camera.bottomExtra)
    || camera.bottomExtra < BOTTOM_EXTRA_MIN
    || camera.bottomExtra > BOTTOM_EXTRA_MAX
  ) {
    return `底部留白必须在 ${BOTTOM_EXTRA_MIN}–${BOTTOM_EXTRA_MAX}`;
  }
  const offsetY = camera.offsetY ?? 0;
  if (!isFiniteNumber(offsetY) || offsetY < OFFSET_Y_MIN || offsetY > OFFSET_Y_MAX) {
    return `画面上下偏移必须在 ${OFFSET_Y_MIN}–${OFFSET_Y_MAX}`;
  }
  return undefined;
}

function validateColors(colors: ArenaColorsDraft | undefined): string | undefined {
  if (!colors || typeof colors !== 'object') return '缺少颜色配置';
  for (const key of ['background', 'ground', 'river', 'bridge', 'grid', 'border'] as const) {
    if (typeof colors[key] !== 'string' || !HEX_COLOR.test(colors[key])) {
      return `${key} 必须是 #rrggbb 颜色`;
    }
  }
  return undefined;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
