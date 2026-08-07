import * as THREE from 'three';
import { ARENA_H, ARENA_W, toSimX, toSimY } from '../view/coords.js';

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
