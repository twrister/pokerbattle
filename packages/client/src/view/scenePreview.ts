import * as THREE from 'three';
import { Faction, type ArenaConfigDraft } from '@pb/sim';
import {
  applySoloCameraPose,
  arenaVisualFromDraft,
  calculateSoloOrthoBounds,
  clampSoloCameraFov,
  createArenaVisualGroup,
  hexColorToNumber,
} from './scene.js';

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
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x20242c, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(14, 30, 12);
  scene.add(sun);

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
    arenaGroup = createArenaVisualGroup(arenaVisualFromDraft(draft), true);
    scene.add(arenaGroup);
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
      perspective.fov = clampSoloCameraFov(draft.camera.fov);
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
      { width: draft.width, height: draft.height },
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
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  });
}
