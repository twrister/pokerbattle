import * as THREE from 'three';
import {
  Faction,
  HALF_COURT_MID_Y,
  halfCourtSafeAnchor,
  halfCourtSafeBuildingAnchor,
  isBuildingInsideHalfCourt,
  isDeployAnchorInsideHalfCourt,
  isFormationInsideHalfCourt,
  type CardFormation,
  type FormationSpawnPoint,
} from '@pb/sim';
import { ARENA_H, ARENA_W, toSimX, toSimY } from '../view/coords.js';

/** @deprecated 使用 HALF_COURT_MID_Y；保留别名以免旧测试/调用方断裂。 */
export { HALF_COURT_MID_Y as BLUE_HALF_MAX_Y };

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

/** 拖拽超过这个像素就算在转相机，不算点击放兵 / 选中 */
const CLICK_DRAG_TOLERANCE = 6;
const CLICK_MAX_DURATION_MS = 500;

/** 按下到抬起位移小且时间短，视为点击而非拖拽转镜头。 */
export function isShortClick(
  event: PointerEvent,
  downX: number,
  downY: number,
  downTime: number,
): boolean {
  if (event.button !== 0) return false;
  if (event.timeStamp - downTime > CLICK_MAX_DURATION_MS) return false;
  return Math.hypot(event.clientX - downX, event.clientY - downY) <= CLICK_DRAG_TOLERANCE;
}

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

/** 整套阵型是否都落在蓝方半场内（转调 sim 半场规则）。 */
export function isFormationInsideBlueHalf(points: readonly FormationSpawnPoint[]): boolean {
  return isFormationInsideHalfCourt(points, Faction.Blue);
}

/** 整套阵型是否都落在指定阵营半场内。 */
export function isFormationInsideFactionHalf(
  points: readonly FormationSpawnPoint[],
  faction: Faction,
): boolean {
  return isFormationInsideHalfCourt(points, faction);
}

/** 出兵锚点是否落在蓝方白色部署区内。 */
export function isDeployAnchorInsideBlueHalf(x: number, y: number): boolean {
  return isDeployAnchorInsideHalfCourt(x, y, Faction.Blue);
}

/** 出兵锚点是否落在指定阵营白色部署区内。 */
export function isDeployAnchorInsideFactionHalf(
  x: number,
  y: number,
  faction: Faction,
): boolean {
  return isDeployAnchorInsideHalfCourt(x, y, faction);
}

/** 吸附后的建筑占地是否完全落在蓝方半场内。 */
export function isBuildingInsideBlueHalf(
  centerX: number,
  centerY: number,
  footprint: number,
): boolean {
  return isBuildingInsideHalfCourt(centerX, centerY, footprint, Faction.Blue);
}

/** 吸附后的建筑占地是否完全落在指定阵营半场内。 */
export function isBuildingInsideFactionHalf(
  centerX: number,
  centerY: number,
  footprint: number,
  faction: Faction,
): boolean {
  return isBuildingInsideHalfCourt(centerX, centerY, footprint, faction);
}

/** 蓝方半场自动出兵安全锚点。 */
export function blueHalfSafeAnchor(formation: CardFormation): SimPoint | null {
  return halfCourtSafeAnchor(formation, Faction.Blue);
}

/** 指定阵营半场自动出兵安全锚点。 */
export function factionHalfSafeAnchor(formation: CardFormation, faction: Faction): SimPoint | null {
  return halfCourtSafeAnchor(formation, faction);
}

/** 蓝方半场内可容纳指定占地的吸附中心。 */
export function blueHalfSafeBuildingAnchor(footprint: number): SimPoint | null {
  return halfCourtSafeBuildingAnchor(footprint, Faction.Blue);
}

/**
 * 点击地面放兵。
 *
 * 相机用的是 OrbitControls，左键既要能转视角又要能放兵，
 * 所以用「按下到抬起之间位移很小且时间很短」来区分点击和拖拽。
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
    if (!isShortClick(event, downX, downY, downTime)) return;

    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;

    const simX = toSimX(hit.x);
    const simY = toSimY(hit.z);
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
