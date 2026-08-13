import * as THREE from 'three';
import { toSceneX, toSceneZ } from '../view/coords.js';
import { AoeGroundMark } from '../view/aoeGroundMark.js';
import { screenToSim } from './placement.js';

export interface AoePlacementHandle {
  syncPointer: (clientX: number, clientY: number) => void;
  dispose: () => void;
}

export interface AoePlacementOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  groundPlane: THREE.Plane;
  scene: THREE.Scene;
  radius: number;
}

/**
 * 显示全图技能的圆形落点范围。
 * 预览只负责坐标与表现，边界校验仍由调用方和 sim 权威逻辑完成。
 */
export function enableAoePlacement(options: AoePlacementOptions): AoePlacementHandle {
  const mark = new AoeGroundMark();
  mark.group.name = 'aoe-placement';
  mark.group.visible = false;
  options.scene.add(mark.group);

  let disposed = false;
  return {
    syncPointer(clientX, clientY) {
      if (disposed) return;
      const point = screenToSim(options.domElement, options.camera, options.groundPlane, clientX, clientY);
      if (!point) {
        mark.group.visible = false;
        return;
      }
      mark.update(toSceneX(point.x), toSceneZ(point.y), options.radius);
      mark.group.visible = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.scene.remove(mark.group);
      mark.dispose();
    },
  };
}
