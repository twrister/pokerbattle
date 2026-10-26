import * as THREE from 'three';
import { Faction, halfCourtYRange } from '@pb/sim';
import { ARENA_W, toSceneX, toSceneZ } from '../view/coords.js';

/**
 * 高亮用饱和亮蓝而不是白色：场地底板是米黄、河道是青绿，
 * 纯白叠上去只剩一点点提亮，很难看出哪片区域能放。
 */
const HIGHLIGHT_COLOR = 0x3ad2ff;
/** 呼吸动画的透明度上下限；下限保证静止时也足够显眼。 */
const HIGHLIGHT_OPACITY_MIN = 0.28;
const HIGHLIGHT_OPACITY_MAX = 0.46;
/** 一次呼吸（亮 → 暗 → 亮）的时长，慢一点避免闪烁干扰瞄准。 */
const HIGHLIGHT_PULSE_PERIOD_MS = 1400;
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
 * 与 isDeployAnchorInsideHalfCourt 对齐：高亮区域内锚点均可放置。
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
 * 在场地上显示蓝色半透明部署区格，并返回释放场景资源的句柄。
 * 淡入后转入持续呼吸，让可放置区域在混战画面里也能一眼看到。
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

  /** 停掉在跑的 rAF；呼吸与淡入淡出共用同一个句柄，避免两条动画抢 opacity。 */
  const stopAnimation = (): void => {
    if (animationFrameId === null) return;
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  };

  /** 正弦呼吸：相位从波峰开始，接住淡入结束时的最大透明度，避免接手瞬间跳变。 */
  const pulseOpacity = (now: number): number => {
    const phase = (now % HIGHLIGHT_PULSE_PERIOD_MS) / HIGHLIGHT_PULSE_PERIOD_MS;
    const wave = (Math.sin(phase * Math.PI * 2 + Math.PI / 2) + 1) / 2;
    return HIGHLIGHT_OPACITY_MIN + (HIGHLIGHT_OPACITY_MAX - HIGHLIGHT_OPACITY_MIN) * wave;
  };

  /** 常驻呼吸循环：每次重设不透明度，直到被 stopAnimation 取消。 */
  const startPulse = (): void => {
    stopAnimation();
    const tick = (now: number): void => {
      material.opacity = pulseOpacity(now);
      animationFrameId = requestAnimationFrame(tick);
    };
    animationFrameId = requestAnimationFrame(tick);
  };

  /** 在淡入或淡出时平滑更新材质透明度，结束后交给 onComplete。 */
  const fadeTo = (targetOpacity: number, onComplete?: () => void): void => {
    stopAnimation();
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

  // 先淡入到呼吸上限，再接着呼吸，避免第一帧突然出现
  fadeTo(HIGHLIGHT_OPACITY_MAX, () => {
    if (!disposed) startPulse();
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      fadeTo(0, remove);
    },
  };
}
