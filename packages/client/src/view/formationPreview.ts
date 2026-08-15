import * as THREE from 'three';
import {
  Faction,
  UnitState,
  resolveFormationSpawns,
  type CardFormation,
  type UnitTypeId,
} from '@pb/sim';
import { UnitView } from './unitView.js';
import { getSpriteMaterials } from './unitSprites.js';

/** 预览地面半宽/半深（世界单位）；比旧版更大，方便对照 1 格一线看间距。 */
const PREVIEW_HALF_W = 8;
const PREVIEW_HALF_H = 6;
/** 正交相机半高；略大于旧值以露出更多格子，同时单位仍够大便于辨认。 */
const PREVIEW_ORTHO_HALF_HEIGHT = 6.5;

/** 预览单位：保留站位与兵种，便于贴图就绪后再次 update 同步可见性。 */
interface PreviewUnit {
  view: UnitView;
  typeId: UnitTypeId;
  x: number;
  z: number;
}

/** 卡组页中的只读阵型预览，独立于战斗场景以免编辑时影响正在运行的对局。 */
export interface FormationPreviewHandle {
  render(formation: CardFormation | null): void;
  resize(): void;
  dispose(): void;
}

/** 创建静态 3D 阵型预览；每次草稿变动以新的派生阵型重建单位展示。 */
export function createFormationPreview(container: HTMLElement): FormationPreviewHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 100);
  // 略抬高并拉远，保证地面格子在斜视下仍清晰可读
  camera.position.set(0, 16, 14);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xc7dcff, 0x1d2430, 1.8));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(PREVIEW_HALF_W * 2, PREVIEW_HALF_H * 2),
    new THREE.MeshStandardMaterial({ color: 0x243143, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = createPreviewGrid(PREVIEW_HALF_W, PREVIEW_HALF_H);
  scene.add(grid);
  const axes = createPreviewAxes(PREVIEW_HALF_W, PREVIEW_HALF_H);
  scene.add(axes);

  const units: PreviewUnit[] = [];
  let rafId = 0;
  let startedAt = 0;

  /** 停止贴图等待循环，避免 dispose / 换阵型后旧帧仍改场景。 */
  const cancelPaintLoop = (): void => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  /** 共享立绘贴图是否都已加载（模板材质会在 onLoad 里把 visible 置 true）。 */
  const spritesReady = (): boolean =>
    units.every((unit) => {
      const mats = getSpriteMaterials(unit.typeId);
      return !mats || (mats.front.visible && mats.back.visible);
    });

  /** 重跑 update 以同步克隆材质 visible，并在贴图未齐时继续下一帧。 */
  const paintLoop = (): void => {
    rafId = 0;
    const timeSec = (performance.now() - startedAt) / 1000;
    for (const unit of units) {
      unit.view.update(
        unit.x,
        unit.z,
        0,
        1,
        1,
        UnitState.Idle,
        false,
        false,
        false,
        false,
        timeSec,
        camera,
      );
    }
    renderer.render(scene, camera);
    // 战斗主循环每帧都会 sync；预览无主循环，必须在贴图就绪前自己补帧
    if (!spritesReady()) {
      rafId = requestAnimationFrame(paintLoop);
    }
  };

  /** 依据容器比例调整正交视锥，保持窄屏和横屏都能完整查看阵型。 */
  const resize = (): void => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const aspect = width / height;
    const halfHeight = PREVIEW_ORTHO_HALF_HEIGHT;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  };

  /** 清掉上一阵型的独立材质和节点，防止频繁改表单时泄漏 WebGL 资源。 */
  const clearViews = (): void => {
    for (const unit of units) {
      scene.remove(unit.view.group);
      unit.view.dispose();
    }
    units.length = 0;
  };

  const render = (formation: CardFormation | null): void => {
    cancelPaintLoop();
    clearViews();
    if (formation) {
      const points = resolveFormationSpawns(formation, Faction.Blue, 0, 0);
      startedAt = performance.now();
      for (const point of points) {
        const view = new UnitView(Faction.Blue, point.typeId);
        const x = point.x;
        const z = -point.y;
        view.update(x, z, 0, 1, 1, UnitState.Idle, false, false, false, false, 0, camera);
        units.push({ view, typeId: point.typeId, x, z });
        scene.add(view.group);
      }
    }
    resize();
    // 首次进入时贴图多半尚未就绪；补帧直到立绘 visible，否则会只留下色块/空面片
    if (units.length > 0 && !spritesReady()) {
      rafId = requestAnimationFrame(paintLoop);
    }
  };

  const onResize = (): void => resize();
  window.addEventListener('resize', onResize);
  resize();

  return {
    render,
    resize,
    dispose() {
      window.removeEventListener('resize', onResize);
      cancelPaintLoop();
      clearViews();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      disposeLineObject(grid);
      disposeLineObject(axes);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** 一格一线的参考网格，与战场同刻度，便于对照横向/排间距数值。 */
function createPreviewGrid(halfW: number, halfH: number): THREE.LineSegments {
  const points: number[] = [];
  for (let x = -halfW + 1; x < halfW; x++) {
    points.push(x, 0.01, -halfH, x, 0.01, halfH);
  }
  for (let z = -halfH + 1; z < halfH; z++) {
    points.push(-halfW, 0.01, z, halfW, 0.01, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x4a5a70, transparent: true, opacity: 0.75 }),
  );
}

/** 原点十字轴：横向偏暖、纵深偏冷，帮助分辨左右间距与排间距方向。 */
function createPreviewAxes(halfW: number, halfH: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -halfW, 0.02, 0, halfW, 0.02, 0,
        0, 0.02, -halfH, 0, 0.02, halfH,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(
      [
        0.55, 0.42, 0.28, 0.55, 0.42, 0.28,
        0.32, 0.48, 0.62, 0.32, 0.48, 0.62,
      ],
      3,
    ),
  );
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
  );
}

/** 释放线段网格占用的几何与材质。 */
function disposeLineObject(object: THREE.Line | THREE.LineSegments): void {
  object.geometry.dispose();
  const material = object.material;
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
