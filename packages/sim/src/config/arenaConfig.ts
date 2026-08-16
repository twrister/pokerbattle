import type { MatchMode } from '../match/matchMode.js';
import { toFloat } from '../math/fixed.js';
import { buildingCellRange, snapBuildingCenter } from '../nav/buildingGrid.js';
import { ARENA_HEIGHT, ARENA_WIDTH, setArenaSize } from './arena.js';
import {
  ARENA_RIVER_MAX_Y,
  ARENA_RIVER_MIN_Y,
  setArenaTerrain,
  type ArenaBridge,
} from './arenaTerrain.js';
import { UNIT_CONFIGS } from './units.js';
import rawArenaConfig from './arena.json';
import rawArena2v2Config from './arena2v2.json';

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

/** 蓝方半场基地中心；对岸只镜像 Y，X 保持不变。 */
export interface ArenaBasePos {
  x: number;
  y: number;
}

/** 场景配置页与 JSON 共用的完整草稿。宽高都是单边半场，对岸对称展开。 */
export interface ArenaConfigDraft {
  /** 单边宽（横向格数），两边共用，即全场宽。 */
  width: number;
  /** 单边高（己方半场纵向格数），对岸同高。 */
  height: number;
  riverWidth: number;
  bridges: ArenaBridge[];
  /** 第三座桥是否写入地形；关闭时只保留前两座。 */
  bridge3Enabled: boolean;
  /** 单边（蓝方）基地中心；1v1 一座、2v2 两座，对岸按全场高镜像。 */
  bases: ArenaBasePos[];
  camera: ArenaCameraDraft;
  colors: ArenaColorsDraft;
}

/** 由单边宽高展开全场：宽共用，高 = 两边半场 + 河道。 */
export function arenaFullSize(
  draft: Pick<ArenaConfigDraft, 'width' | 'height' | 'riverWidth'>,
): { width: number; height: number } {
  return {
    width: draft.width,
    height: draft.height * 2 + draft.riverWidth,
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_RIVER_WIDTH = 1;
const MAX_BRIDGES = 8;
const MIN_BRIDGES = 1;
const BRIDGE3_INDEX = 2;
const MAX_SIDE_BASES = 2;
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
const initialDraft1v1 = parseArenaConfigDraft(rawArenaConfig) ?? fallbackArenaConfigDraft();
const initialDraft2v2 = parseArenaConfigDraft(rawArena2v2Config) ?? fallbackArena2v2ConfigDraft();
let runtimeMode: MatchMode = '1v1';
let runtimeVisual: Pick<ArenaConfigDraft, 'camera' | 'colors'> = {
  camera: { ...initialDraft1v1.camera },
  colors: { ...initialDraft1v1.colors },
};
/** 完整桥列表与基地需单独记住：运行时 ARENA_BRIDGES 可能已去掉未开启的桥三。 */
let runtimeLayout: Pick<ArenaConfigDraft, 'bridges' | 'bridge3Enabled' | 'bases'> = {
  bridges: initialDraft1v1.bridges.map((bridge) => ({ ...bridge })),
  bridge3Enabled: initialDraft1v1.bridge3Enabled,
  bases: initialDraft1v1.bases.map((base) => ({ ...base })),
};
applyArenaLayout(initialDraft1v1);
const defaultDrafts: Record<MatchMode, ArenaConfigDraft> = {
  '1v1': cloneArenaConfigDraft(initialDraft1v1),
  '2v2': cloneArenaConfigDraft(initialDraft2v2),
};
/** 非当前运行时模式的草稿缓存，避免切预设时丢掉另一套未保存编辑。 */
const idleDrafts: Partial<Record<MatchMode, ArenaConfigDraft>> = {};

/** 当前已应用到运行时场地的模式。 */
export function currentArenaPreset(): MatchMode {
  return runtimeMode;
}

/** 把指定模式的已保存预设写入运行时场地/河桥/镜头。 */
export function applyArenaPreset(mode: MatchMode): void {
  applyArenaConfigDraft(defaultDrafts[mode], mode);
}

/** 导出场景草稿：省略 mode 时读当前运行时；指定另一模式则读该套缓存/预设。 */
export function dumpArenaConfigDraft(mode?: MatchMode): ArenaConfigDraft {
  const target = mode ?? runtimeMode;
  if (target === runtimeMode) return dumpLiveDraft();
  return cloneArenaConfigDraft(idleDrafts[target] ?? defaultDrafts[target]);
}

/** 导出最近一次成功保存（或模块加载）的快照，供重置表单。 */
export function dumpDefaultArenaConfigDraft(mode?: MatchMode): ArenaConfigDraft {
  return cloneArenaConfigDraft(defaultDrafts[mode ?? runtimeMode]);
}

/** 校验场景草稿；通过返回 undefined。 */
export function validateArenaConfigDraft(draft: unknown): string | undefined {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return '配置必须是对象';
  const value = draft as Partial<ArenaConfigDraft>;
  if (!isPositiveInt(value.width)) return '单边宽必须是正整数';
  if (!isPositiveInt(value.height)) return '单边高必须是正整数';
  if (!isPositiveInt(value.riverWidth) || value.riverWidth < MIN_RIVER_WIDTH) {
    return '河道宽度必须是正整数';
  }
  if (!Array.isArray(value.bridges) || value.bridges.length < MIN_BRIDGES) return '至少需要一座桥';
  if (value.bridges.length > MAX_BRIDGES) return `桥数量不能超过 ${MAX_BRIDGES}`;
  if (value.bridge3Enabled !== undefined && typeof value.bridge3Enabled !== 'boolean') {
    return '桥三开关必须是布尔值';
  }
  const bridge3On = value.bridge3Enabled ?? value.bridges.length > BRIDGE3_INDEX;
  if (bridge3On && value.bridges.length <= BRIDGE3_INDEX) {
    return '开启桥三时需要配置第三座桥';
  }
  // 桥三关闭时只校验前两座，避免未启用的第三座坐标挡住保存。
  const activeBridges = bridge3On
    ? value.bridges
    : value.bridges.slice(0, Math.min(BRIDGE3_INDEX, value.bridges.length));
  const sorted = [...activeBridges].sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < sorted.length; i++) {
    const bridge = sorted[i]!;
    const error = validateBridge(bridge, value.width!);
    if (error) return error;
    const next = sorted[i + 1];
    if (next && bridge.maxX > next.minX) return '桥不能重叠';
  }
  if (value.bases !== undefined) {
    const basesError = validateBases(value.bases, value.width!, value.height!);
    if (basesError) return basesError;
  }
  const cameraError = validateCamera(value.camera);
  if (cameraError) return cameraError;
  const colorsError = validateColors(value.colors);
  if (colorsError) return colorsError;
  return undefined;
}

/** 校验通过后覆盖运行时场地/河桥/镜头/颜色。下一局 World 会读到新尺寸。 */
export function applyArenaConfigDraft(draft: ArenaConfigDraft, mode?: MatchMode): void {
  const error = validateArenaConfigDraft(draft);
  if (error) throw new Error(error);
  const target = mode ?? runtimeMode;
  const next = cloneArenaConfigDraft(draft);
  if (target !== runtimeMode) {
    idleDrafts[runtimeMode] = dumpLiveDraft();
  }
  applyArenaLayout(next);
  runtimeVisual = { camera: { ...next.camera }, colors: { ...next.colors } };
  runtimeMode = target;
  idleDrafts[target] = undefined;
}

/** 恢复到最近一次成功保存（或初始加载）的配置快照。 */
export function resetArenaConfigToDefault(mode?: MatchMode): void {
  const target = mode ?? runtimeMode;
  applyArenaConfigDraft(defaultDrafts[target], target);
}

/** 成功写回 JSON 后，把当前配置设为后续重置基准。 */
export function captureArenaConfigAsDefault(mode?: MatchMode): void {
  const target = mode ?? runtimeMode;
  defaultDrafts[target] = dumpArenaConfigDraft(target);
}

/** 从当前运行时常量拼出草稿。 */
function dumpLiveDraft(): ArenaConfigDraft {
  const width = Math.round(toFloat(ARENA_WIDTH));
  const fullHeight = Math.round(toFloat(ARENA_HEIGHT));
  const riverWidth = ARENA_RIVER_MAX_Y - ARENA_RIVER_MIN_Y;
  return {
    width,
    height: Math.round((fullHeight - riverWidth) / 2),
    riverWidth,
    bridges: runtimeLayout.bridges.map((bridge) => ({ ...bridge })),
    bridge3Enabled: runtimeLayout.bridge3Enabled,
    bases: runtimeLayout.bases.map((base) => ({ ...base })),
    camera: { ...runtimeVisual.camera },
    colors: { ...runtimeVisual.colors },
  };
}

function applyArenaLayout(draft: ArenaConfigDraft): void {
  const full = arenaFullSize(draft);
  setArenaSize(full.width, full.height);
  setArenaTerrain(draft.height, draft.height + draft.riverWidth, resolveActiveBridges(draft));
  runtimeLayout = {
    bridges: draft.bridges.map((bridge) => ({ ...bridge })),
    bridge3Enabled: draft.bridge3Enabled,
    bases: draft.bases.map((base) => ({ ...base })),
  };
}

/** 关闭桥三时只把前两座写入河道地形，配置里仍保留第三座方便再打开。 */
export function resolveActiveBridges(
  draft: Pick<ArenaConfigDraft, 'bridges' | 'bridge3Enabled'>,
): ArenaBridge[] {
  const bridges = draft.bridges.map((bridge) => ({ minX: bridge.minX, maxX: bridge.maxX }));
  if (draft.bridge3Enabled) return bridges;
  return bridges.slice(0, Math.min(BRIDGE3_INDEX, bridges.length));
}

/** 按席位数补齐单边基地；缺的席位沿底边均分，避免 2v2 只配了一座。 */
export function resolveSideBasePositions(
  draft: Pick<ArenaConfigDraft, 'width' | 'bases'>,
  count: number,
): ArenaBasePos[] {
  const fallback = defaultSideBasePositions(draft.width, count);
  return fallback.map((pos, index) => draft.bases[index] ?? pos);
}

/** 对岸镜像：X 不动，Y 关于全场中心对称。 */
export function mirrorBaseY(y: number, fullHeight: number): number {
  return fullHeight - y;
}

function parseArenaConfigDraft(raw: unknown): ArenaConfigDraft | null {
  if (validateArenaConfigDraft(raw)) return null;
  return cloneArenaConfigDraft(raw as ArenaConfigDraft);
}

function fallbackArena2v2ConfigDraft(): ArenaConfigDraft {
  return {
    width: 30,
    height: 15,
    riverWidth: 2,
    bridges: [
      { minX: 6, maxX: 9 },
      { minX: 14, maxX: 17 },
      { minX: 21, maxX: 24 },
    ],
    bridge3Enabled: true,
    bases: defaultSideBasePositions(30, 2),
    camera: {
      mode: 'perspective',
      fov: 30,
      distance: 71,
      angleDeg: 45,
      bottomExtra: 8,
      offsetY: 5,
    },
    colors: {
      background: '#0d1117',
      ground: '#3a465a',
      river: '#548196',
      bridge: '#3a465a',
      grid: '#484d56',
      border: '#8394ad',
    },
  };
}

function fallbackArenaConfigDraft(): ArenaConfigDraft {
  return {
    width: 18,
    height: 15,
    riverWidth: 1,
    bridges: [
      { minX: 3, maxX: 5 },
      { minX: 13, maxX: 15 },
      { minX: 8, maxX: 10 },
    ],
    bridge3Enabled: false,
    bases: defaultSideBasePositions(18, 1),
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
  const bridges = padBridges(draft.bridges, draft.width);
  return {
    width: draft.width,
    height: draft.height,
    riverWidth: draft.riverWidth,
    bridges,
    bridge3Enabled: draft.bridge3Enabled ?? draft.bridges.length > BRIDGE3_INDEX,
    bases: normalizeBases(draft),
    camera: {
      ...draft.camera,
      distance: isFiniteNumber(draft.camera.distance) ? draft.camera.distance : DEFAULT_CAMERA_DISTANCE,
      offsetY: isFiniteNumber(draft.camera.offsetY) ? draft.camera.offsetY : 0,
    },
    colors: { ...draft.colors },
  };
}

/** 旧 JSON 不足三座时补上不重叠的桥三，避免开关打开后没有坐标。 */
function padBridges(bridges: readonly ArenaBridge[], width: number): ArenaBridge[] {
  const next = bridges.map((bridge) => ({ minX: bridge.minX, maxX: bridge.maxX }));
  while (next.length <= BRIDGE3_INDEX) {
    next.push(defaultExtraBridge(width, next));
  }
  return next;
}

function defaultExtraBridge(width: number, existing: readonly ArenaBridge[]): ArenaBridge {
  const span = existing[0] ? Math.max(1, existing[0].maxX - existing[0].minX) : 2;
  const center = Math.floor((width - span) / 2);
  const candidate = { minX: center, maxX: center + span };
  const overlaps = existing.some((bridge) => candidate.maxX > bridge.minX && candidate.minX < bridge.maxX);
  if (!overlaps && candidate.minX >= 0 && candidate.maxX <= width) return candidate;
  const sorted = [...existing].sort((a, b) => a.minX - b.minX);
  let cursor = 0;
  for (const bridge of sorted) {
    if (bridge.minX - cursor >= span) return { minX: cursor, maxX: cursor + span };
    cursor = Math.max(cursor, bridge.maxX);
  }
  if (width - cursor >= span) return { minX: cursor, maxX: cursor + span };
  return { minX: 0, maxX: Math.min(span, width) };
}

/** 缺省时按 1v1 一座居中底边；2v2 JSON 会显式写两座。 */
function normalizeBases(draft: Pick<ArenaConfigDraft, 'width' | 'bases'>): ArenaBasePos[] {
  if (Array.isArray(draft.bases) && draft.bases.length > 0) {
    return draft.bases.slice(0, MAX_SIDE_BASES).map((base) => ({ x: base.x, y: base.y }));
  }
  return defaultSideBasePositions(draft.width, 1);
}

/** 单边底边均分：与旧版 seedStartingCastles 公式一致，偶数 footprint 随后再吸附。 */
export function defaultSideBasePositions(width: number, count: number): ArenaBasePos[] {
  const size = Math.max(1, count);
  const y = UNIT_CONFIGS.building_base.footprint / 2;
  const result: ArenaBasePos[] = [];
  for (let i = 0; i < size; i += 1) {
    result.push({
      x: width * (2 * i + 1) / (2 * size),
      y,
    });
  }
  return result;
}

function validateBases(bases: unknown, width: number, height: number): string | undefined {
  if (!Array.isArray(bases) || bases.length === 0) return '至少需要一座单边基地';
  if (bases.length > MAX_SIDE_BASES) return '单边基地不能超过 2 座';
  const footprint = UNIT_CONFIGS.building_base.footprint;
  const rects: ReturnType<typeof buildingCellRange>[] = [];
  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i] as Partial<ArenaBasePos> | undefined;
    if (!base || !isFiniteNumber(base.x) || !isFiniteNumber(base.y)) {
      return `基地 ${i + 1} 坐标无效`;
    }
    const snappedX = snapBuildingCenter(base.x, footprint);
    const snappedY = snapBuildingCenter(base.y, footprint);
    const rect = buildingCellRange(snappedX, snappedY, footprint);
    if (rect.minX < 0 || rect.maxX > width) return `基地 ${i + 1} 必须落在单边宽度内`;
    if (rect.minY < 0 || rect.maxY > height) return `基地 ${i + 1} 必须落在单边半场内`;
    if (rects.some((other) => rectsOverlap(rect, other))) return '单边基地不能重叠';
    rects.push(rect);
  }
  return undefined;
}

function rectsOverlap(
  a: ReturnType<typeof buildingCellRange>,
  b: ReturnType<typeof buildingCellRange>,
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
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
