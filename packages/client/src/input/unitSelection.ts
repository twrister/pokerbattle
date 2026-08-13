import * as THREE from 'three';
import { isShortClick, screenToSim } from './placement.js';

export interface UnitSelectionOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  groundPlane: THREE.Plane;
  /** 用当前画面上的 sim 坐标挑单位；未命中返回 null。 */
  pickUnit: (simX: number, simY: number) => number | null;
  /** 命中则选中该 id；点空地传 null 取消选中。 */
  onSelect: (unitId: number | null) => void;
}

/**
 * 点击场上单位选中（一次一个），点空地取消。
 * 命中单位时拦住后续放兵监听，避免沙盒左键既选中又刷兵。
 */
export function enableUnitSelection(options: UnitSelectionOptions): () => void {
  const { domElement, camera, groundPlane, pickUnit, onSelect } = options;
  let downX = 0;
  let downY = 0;
  let downTime = 0;
  let pointerDown = false;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerDown = true;
    downX = event.clientX;
    downY = event.clientY;
    downTime = event.timeStamp;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (!isShortClick(event, downX, downY, downTime)) return;

    const point = screenToSim(domElement, camera, groundPlane, event.clientX, event.clientY);
    if (!point) {
      onSelect(null);
      return;
    }
    const unitId = pickUnit(point.x, point.y);
    onSelect(unitId);
    // 点到单位就不要再走放兵；点空地则放行，沙盒仍可点击出兵
    if (unitId != null) event.stopImmediatePropagation();
  };

  const onPointerCancel = (): void => {
    pointerDown = false;
  };

  // capture：抢在放兵 pointerup 之前判定命中
  domElement.addEventListener('pointerdown', onPointerDown, true);
  domElement.addEventListener('pointerup', onPointerUp, true);
  domElement.addEventListener('pointercancel', onPointerCancel, true);
  return () => {
    domElement.removeEventListener('pointerdown', onPointerDown, true);
    domElement.removeEventListener('pointerup', onPointerUp, true);
    domElement.removeEventListener('pointercancel', onPointerCancel, true);
  };
}
