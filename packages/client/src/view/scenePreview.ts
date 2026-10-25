import * as THREE from 'three';
import { arenaFullSize, Faction, type ArenaConfigDraft } from '@pb/sim';
import {
  applySoloCameraPose,
  arenaVisualFromDraft,
  calculateSoloOrthoBounds,
  calculateSoloViewFov,
  clampSoloCameraFov,
  createArenaVisualGroup,
  applySunShadowSpan,
  hexColorToNumber,
} from './scene.js';
import { addArenaLights, applyArenaRendererStyle } from './arenaStyle.js';

/** 配置页独立 3D 预览，避免改表单时碰到正在进行的对局场景。 */
export interface ScenePreviewHandle {
  applyDraft(draft: ArenaConfigDraft): void;
  resize(): void;
  dispose(): void;
}

/** 创建只读场景预览；每次草稿变动重建地形与镜头。 */
export function createScenePreview(container: HTMLElement): ScenePreviewHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  applyArenaRendererStyle(renderer);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const sun = addArenaLights(scene);

  let camera: THREE.Camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  let arenaGroup: THREE.Group | null = null;
  let currentDraft: ArenaConfigDraft | null = null;
  let rafId = 0;

  const paint = (): void => {
    rafId = 0;
    renderer.render(scene, camera);
  };

  const schedulePaint = (): void => {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame(paint);
  };

  const resize = (): void => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    if (currentDraft) applyCamera(currentDraft, width / height);
    schedulePaint();
  };

  /** 按草稿重建地面/河桥/颜色，并套用正交或透视镜头。 */
  const applyDraft = (draft: ArenaConfigDraft): void => {
    currentDraft = draft;
    scene.background = new THREE.Color(hexColorToNumber(draft.colors.background));
    if (arenaGroup) {
      scene.remove(arenaGroup);
      disposeObject3D(arenaGroup);
    }
    arenaGroup = createArenaVisualGroup(arenaVisualFromDraft(draft, { showBases: true }), true);
    scene.add(arenaGroup);
    const full = arenaFullSize(draft);
    applySunShadowSpan(sun, full.width, full.height);
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    applyCamera(draft, width / Math.max(height, 1));
    schedulePaint();
  };

  const applyCamera = (draft: ArenaConfigDraft, aspect: number): void => {
    if (draft.camera.mode === 'perspective') {
      const perspective =
        camera instanceof THREE.PerspectiveCamera
          ? camera
          : new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
      // 与局内一致按宽高比补偿 FOV，预览与实机取景才对齐
      perspective.fov = calculateSoloViewFov(clampSoloCameraFov(draft.camera.fov), aspect);
      perspective.aspect = aspect;
      applySoloCameraPose(
        perspective,
        draft.camera.angleDeg,
        Faction.Blue,
        draft.camera.distance,
        draft.camera.offsetY,
      );
      perspective.updateProjectionMatrix();
      camera = perspective;
      return;
    }
    const ortho =
      camera instanceof THREE.OrthographicCamera
        ? camera
        : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(ortho, draft.camera.angleDeg, Faction.Blue);
    const bounds = calculateSoloOrthoBounds(
      aspect,
      draft.camera.angleDeg,
      Faction.Blue,
      draft.camera.bottomExtra,
      arenaFullSize(draft),
    );
    ortho.left = bounds.left;
    ortho.right = bounds.right;
    ortho.top = bounds.top;
    ortho.bottom = bounds.bottom;
    ortho.updateProjectionMatrix();
    camera = ortho;
  };

  window.addEventListener('resize', resize);

  return {
    applyDraft,
    resize,
    dispose() {
      window.removeEventListener('resize', resize);
      if (rafId !== 0) cancelAnimationFrame(rafId);
      if (arenaGroup) disposeObject3D(arenaGroup);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      (item as THREE.MeshStandardMaterial).map?.dispose();
      item.dispose();
    }
  });
}
