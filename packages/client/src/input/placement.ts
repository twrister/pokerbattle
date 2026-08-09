import * as THREE from 'three';
import {
  Faction,
  UNIT_CONFIGS,
  buildingCellRange,
  getFormationBuildingTypeId,
  isBuildingOnlyFormation,
  isBuildingRectInsideArena,
  resolveFormationSpawns,
  snapBuildingCenter,
  type CardFormation,
  type FormationSpawnPoint,
} from '@pb/sim';
import { ARENA_H, ARENA_W, toSimX, toSimY } from '../view/coords.js';

/** 蓝方可出兵区域：整个宽度 + 靠近己方的半场（含中线）。 */
export const BLUE_HALF_MAX_Y = ARENA_H / 2;

export interface SimPoint {
  x: number;
  y: number;
}

export interface PlacementOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  groundPlane: THREE.Plane;
  onPlace: (simX: number, simY: number) => void;
}

/** 拖拽超过这个像素就算在转相机，不算点击放兵 */
const CLICK_DRAG_TOLERANCE = 6;
const CLICK_MAX_DURATION_MS = 500;

/** 点击落点是否在场地矩形内（含边界） */
function isInsideArena(simX: number, simY: number): boolean {
  return simX >= 0 && simX <= ARENA_W && simY >= 0 && simY <= ARENA_H;
}

/**
 * 屏幕坐标 → sim 平面坐标。
 * 射线打的是无限地面平面，命中失败（视线与地面平行）时返回 null，场外判断交给调用方。
 */
export function screenToSim(
  domElement: HTMLElement,
  camera: THREE.Camera,
  groundPlane: THREE.Plane,
  clientX: number,
  clientY: number,
): SimPoint | null {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
  return { x: toSimX(hit.x), y: toSimY(hit.z) };
}

/**
 * 整套阵型是否都落在蓝方半场内。
 * 故意不做逐单位 clamp：贴边时 clamp 会把整排压到同一条线上互相重叠，
 * 宁可判非法让玩家重放，也不生成一堆挤在边界的单位。
 */
export function isFormationInsideBlueHalf(points: readonly FormationSpawnPoint[]): boolean {
  return points.every(
    (point) => point.x >= 0 && point.x <= ARENA_W && point.y >= 0 && point.y <= BLUE_HALF_MAX_Y,
  );
}

/**
 * 吸附后的建筑占地是否完全落在蓝方半场（含中线）内。
 * 用占格半开区间判断，避免半截建筑跨过中线。
 */
export function isBuildingInsideBlueHalf(
  centerX: number,
  centerY: number,
  footprint: number,
): boolean {
  const snappedX = snapBuildingCenter(centerX, footprint);
  const snappedY = snapBuildingCenter(centerY, footprint);
  const rect = buildingCellRange(snappedX, snappedY, footprint);
  if (!isBuildingRectInsideArena(rect, ARENA_W, ARENA_H)) return false;
  return rect.minY >= 0 && rect.maxY <= BLUE_HALF_MAX_Y;
}

/**
 * 点击按钮自动出兵时的落点：从蓝方半场中央出发，再按阵型包围盒把锚点推回合法区域。
 * 阵型本身比半场还大时返回 null，由调用方提示玩家。
 * 单建筑阵型改为按占地边长推算安全中心。
 */
export function blueHalfSafeAnchor(formation: CardFormation): SimPoint | null {
  if (isBuildingOnlyFormation(formation)) {
    const typeId = getFormationBuildingTypeId(formation)!;
    return blueHalfSafeBuildingAnchor(UNIT_CONFIGS[typeId].footprint);
  }
  const centerX = ARENA_W / 2;
  const centerY = BLUE_HALF_MAX_Y / 2;
  const points = resolveFormationSpawns(formation, Faction.Blue, centerX, centerY);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const offsetX = shiftIntoRange(Math.min(...xs), Math.max(...xs), 0, ARENA_W);
  const offsetY = shiftIntoRange(Math.min(...ys), Math.max(...ys), 0, BLUE_HALF_MAX_Y);
  if (offsetX === null || offsetY === null) return null;
  return { x: centerX + offsetX, y: centerY + offsetY };
}

/** 蓝方半场内可容纳指定占地的吸附中心；半场装不下则返回 null。 */
export function blueHalfSafeBuildingAnchor(footprint: number): SimPoint | null {
  const size = Math.max(1, Math.floor(footprint));
  if (size > ARENA_W || size > BLUE_HALF_MAX_Y) return null;
  const half = size / 2;
  // 半开区间 [half, width-half] / [half, blueMax-half] 内吸附
  const minCenter = half;
  const maxCenterX = ARENA_W - half;
  const maxCenterY = BLUE_HALF_MAX_Y - half;
  if (minCenter > maxCenterX || minCenter > maxCenterY) return null;
  const cx = snapBuildingCenter((minCenter + maxCenterX) / 2, size);
  const cy = snapBuildingCenter((minCenter + maxCenterY) / 2, size);
  if (!isBuildingInsideBlueHalf(cx, cy, size)) return null;
  return { x: cx, y: cy };
}

/** 求把 [min, max] 整体推入 [low, high] 所需的位移；区间本身超长则无解。 */
function shiftIntoRange(min: number, max: number, low: number, high: number): number | null {
  if (max - min > high - low) return null;
  if (min < low) return low - min;
  if (max > high) return high - max;
  return 0;
}

/**
 * 点击地面放兵。
 *
 * 相机用的是 OrbitControls，左键既要能转视角又要能放兵，
 * 所以用「按下到抬起之间位移很小且时间很短」来区分点击和拖拽。
 * 射线打的是无限地面平面，因此必须额外拒绝场外命中，避免被 clamp 到边缘仍出兵。
 */
export function enablePlacement(options: PlacementOptions): () => void {
  const { domElement, camera, groundPlane, onPlace } = options;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  let downX = 0;
  let downY = 0;
  let downTime = 0;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    downX = event.clientX;
    downY = event.clientY;
    downTime = event.timeStamp;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.timeStamp - downTime > CLICK_MAX_DURATION_MS) return;
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_DRAG_TOLERANCE) return;

    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;

    const simX = toSimX(hit.x);
    const simY = toSimY(hit.z);
    // 无限平面在场外也能命中；场外点击不放兵
    if (!isInsideArena(simX, simY)) return;

    onPlace(simX, simY);
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', onPointerUp);
  return () => {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointerup', onPointerUp);
  };
}
