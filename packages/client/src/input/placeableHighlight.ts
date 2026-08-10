import * as THREE from 'three';
import { Faction, halfCourtYRange } from '@pb/sim';
import { ARENA_W, toSceneX, toSceneZ } from '../view/coords.js';

const HIGHLIGHT_COLOR = 0xffffff;
const HIGHLIGHT_OPACITY = 0.1;
const HIGHLIGHT_SCALE = 1;
const HIGHLIGHT_FADE_DURATION_MS = 160;

export interface PlaceableCell {
  x: number;
  y: number;
}

export interface PlaceableHighlightHandle {
  dispose: () => void;
}

/**
 * 枚举指定阵营部署半场内的 1×1 格心。
 * 高亮只提示基础半场范围；阵型贴边时仍由实际落点校验决定是否可放。
 */
export function collectHalfCourtPlaceableCells(faction: Faction): PlaceableCell[] {
  const { minY, maxY } = halfCourtYRange(faction);
  const cells: PlaceableCell[] = [];

  for (let y = Math.ceil(minY) + 0.5; y < maxY; y += 1) {
    for (let x = 0.5; x < ARENA_W; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * 在场地上显示白色半透明部署区格，并返回释放场景资源的句柄。
 */
export function showPlaceableHighlight(
  scene: THREE.Scene,
  cells: readonly PlaceableCell[],
): PlaceableHighlightHandle {
  const material = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  mesh.name = 'placeable-highlight';
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const scale = new THREE.Vector3(HIGHLIGHT_SCALE, HIGHLIGHT_SCALE, 1);
  const position = new THREE.Vector3();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    position.set(toSceneX(cell.x), 0.04, toSceneZ(cell.y));
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  let disposed = false;
  let animationFrameId: number | null = null;

  /** 在淡入或淡出时平滑更新材质透明度，避免部署区突兀跳变。 */
  const fadeTo = (targetOpacity: number, onComplete?: () => void): void => {
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    const startOpacity = material.opacity;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min((now - startedAt) / HIGHLIGHT_FADE_DURATION_MS, 1);
      material.opacity = startOpacity + (targetOpacity - startOpacity) * progress;
      if (progress < 1) {
        animationFrameId = requestAnimationFrame(tick);
        return;
      }
      animationFrameId = null;
      onComplete?.();
    };
    animationFrameId = requestAnimationFrame(tick);
  };

  /** 移除网格并在淡出结束后释放 GPU 资源。 */
  const remove = (): void => {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  };

  fadeTo(HIGHLIGHT_OPACITY);
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      fadeTo(0, remove);
    },
  };
}
