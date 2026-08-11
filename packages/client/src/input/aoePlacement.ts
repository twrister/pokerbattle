import * as THREE from 'three';
import { toSceneX, toSceneZ } from '../view/coords.js';
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
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0.9 });
  const root = new THREE.Group();
  root.name = 'aoe-placement';
  root.visible = false;

  const fill = new THREE.Mesh(new THREE.CircleGeometry(options.radius, 48), fillMaterial);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.05;
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 48 }, (_, index) => {
        const angle = (index / 48) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * options.radius, 0.06, Math.sin(angle) * options.radius);
      }),
    ),
    lineMaterial,
  );
  root.add(fill, line);
  options.scene.add(root);

  let disposed = false;
  return {
    syncPointer(clientX, clientY) {
      if (disposed) return;
      const point = screenToSim(options.domElement, options.camera, options.groundPlane, clientX, clientY);
      if (!point) {
        root.visible = false;
        return;
      }
      root.position.set(toSceneX(point.x), 0, toSceneZ(point.y));
      root.visible = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.scene.remove(root);
      fill.geometry.dispose();
      fillMaterial.dispose();
      line.geometry.dispose();
      lineMaterial.dispose();
    },
  };
}
