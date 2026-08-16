import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  arenaFullSize,
  dumpArenaConfigDraft,
  Faction,
  type ArenaCameraMode,
  type ArenaColorsDraft,
  type ArenaConfigDraft,
} from '@pb/sim';
import { ARENA_H, ARENA_W, syncArenaCoords } from './coords.js';

/** 单机正交斜视角默认俯仰角（相对水平面，度） */
export const DEFAULT_SOLO_CAMERA_ANGLE_DEG = 46;
/** 单机镜头允许的俯仰角范围 */
export const SOLO_CAMERA_ANGLE_MIN_DEG = 15;
export const SOLO_CAMERA_ANGLE_MAX_DEG = 90;
/** 透视镜头默认 FOV */
export const DEFAULT_SOLO_CAMERA_FOV = 45;
export const SOLO_CAMERA_FOV_MIN = 20;
export const SOLO_CAMERA_FOV_MAX = 90;
/** 透视镜头到场地中心的默认距离 */
export const DEFAULT_SOLO_CAMERA_DISTANCE = 50;
export const SOLO_CAMERA_DISTANCE_MIN = 8;
export const SOLO_CAMERA_DISTANCE_MAX = 120;
/** 透视镜头沿画面竖直方向的默认位移（正值场景上移） */
export const DEFAULT_SOLO_CAMERA_OFFSET_Y = 0;
export const SOLO_CAMERA_OFFSET_Y_MIN = -30;
export const SOLO_CAMERA_OFFSET_Y_MAX = 30;
const SOLO_VIEW_PADDING = 1;
/**
 * 战场近端（画面下方）额外留白的默认世界单位。
 * 取景时把这块空区算进视锥，战场会略上移并略缩小，给底部手牌腾操作空间。
 */
export const DEFAULT_SOLO_VIEW_BOTTOM_EXTRA = 8;
/** 运行控制可调的底部留白范围 */
export const SOLO_VIEW_BOTTOM_EXTRA_MIN = 0;
export const SOLO_VIEW_BOTTOM_EXTRA_MAX = 15;
/** 接近 90° 时改用正上方位姿，避免 lookAt 与 up 平行产生万向节锁 */
const SOLO_TOP_DOWN_ANGLE_DEG = 89.5;
/** lookAt 之后从矩阵取画面竖直方向，避免误用 Object3D.up（那只是 lookAt 的参考轴）。 */
const _cameraScreenUp = new THREE.Vector3();
/** 地面盒总厚度，略大于河面下沉，侧面不会露出河挂在地图底下。 */
const ARENA_GROUND_THICKNESS = 0.65;
/** 河面相对地面顶下沉半格。 */
const ARENA_RIVER_DROP = 0.5;
/** 河水自身厚度。 */
const ARENA_RIVER_THICKNESS = 0.15;
/** 桥板厚度。 */
const ARENA_BRIDGE_THICKNESS = 0.15;
/** 桥面略高于地面，避免与网格/单位阴影 z-fighting。 */
const ARENA_BRIDGE_DECK_Y = 0.02;

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls: OrbitControls | null;
  /** 地面所在平面，点击放兵时用它做射线求交 */
  groundPlane: THREE.Plane;
  /** 从大厅重新进入时按容器尺寸刷新画布，避免 display:none 期间尺寸为 0 */
  resize(): void;
  /**
   * 在已有 WebGL 上下文上切换单机/沙盒镜头。
   * 进出大厅时复用 renderer，避免反复 dispose 造成卡顿。
   */
  setMode(mode: SceneMode, viewFaction?: Faction): void;
  /** 按当前 arena 配置重建地面/河桥/颜色/镜头，供下一局生效。 */
  rebuildArena(): void;
  /** 读取单机镜头俯仰角（度） */
  getSoloCameraAngle(): number;
  /** 运行时调整单机镜头俯仰角；沙盒模式下只记值，切回单机时生效 */
  setSoloCameraAngle(degrees: number): void;
  /** 读取战场近端（画面下方）额外留白 */
  getSoloViewBottomExtra(): number;
  /** 运行时调整下方留白；正交镜头会立刻重算视锥 */
  setSoloViewBottomExtra(value: number): void;
  getSoloCameraFov(): number;
  /** 运行时调整透视 FOV；正交镜头只记值。 */
  setSoloCameraFov(fov: number): void;
  getSoloCameraDistance(): number;
  /** 运行时调整透视镜头距离；正交位姿仍用默认距离。 */
  setSoloCameraDistance(distance: number): void;
  getSoloCameraOffsetY(): number;
  /** 运行时调整透视画面上下位置；正交镜头忽略。 */
  setSoloCameraOffsetY(offsetY: number): void;
  getSoloCameraMode(): ArenaCameraMode;
  /** 切换单机正交/透视；沙盒模式只记值。 */
  setSoloCameraMode(mode: ArenaCameraMode): void;
  /** 切换视角阵营（红方镜像，保证己方永远在画面下方） */
  setViewFaction(faction: Faction): void;
  dispose(): void;
}

export type SceneMode = 'sandbox' | 'solo';

export interface SceneOptions {
  mode?: SceneMode;
  /** 正交镜头所属阵营；红方从 -Z 侧俯视。 */
  viewFaction?: Faction;
  /** 单机镜头初始俯仰角；缺省用场景配置。 */
  soloCameraAngle?: number;
  /** 单机下方留白初始值；缺省用场景配置。 */
  soloViewBottomExtra?: number;
  soloCameraFov?: number;
  soloCameraDistance?: number;
  /** 透视画面上下偏移；缺省用场景配置。 */
  soloCameraOffsetY?: number;
  soloCameraMode?: ArenaCameraMode;
}

/** 预览与战斗场景共用的场地视觉参数。 */
export interface ArenaVisualLayout {
  width: number;
  height: number;
  riverMinY: number;
  riverMaxY: number;
  bridges: ReadonlyArray<{ minX: number; maxX: number }>;
  colors: ArenaColorsDraft;
}

/** 把 CSS #rrggbb 转成 Three 整数色。 */
export function hexColorToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/** 从当前运行时草稿取出场地视觉布局；草稿宽高是单边，这里展开成全场。 */
export function arenaVisualFromDraft(
  draft: ArenaConfigDraft = dumpArenaConfigDraft(),
): ArenaVisualLayout {
  const full = arenaFullSize(draft);
  return {
    width: full.width,
    height: full.height,
    riverMinY: draft.height,
    riverMaxY: draft.height + draft.riverWidth,
    bridges: draft.bridges,
    colors: draft.colors,
  };
}

/** 搭好 3D 场景；沙盒使用可操作的透视镜头，单机按配置在正交/透视间切换。 */
export function createScene(container: HTMLElement, options: SceneOptions = {}): SceneContext {
  syncArenaCoords();
  const initial = dumpArenaConfigDraft();
  let mode = options.mode ?? 'sandbox';
  let viewFaction = options.viewFaction ?? Faction.Blue;
  let soloCameraAngleDeg = clampSoloCameraAngle(
    options.soloCameraAngle ?? initial.camera.angleDeg,
  );
  let soloViewBottomExtra = clampSoloViewBottomExtra(
    options.soloViewBottomExtra ?? initial.camera.bottomExtra,
  );
  let soloCameraFov = clampSoloCameraFov(options.soloCameraFov ?? initial.camera.fov);
  let soloCameraDistance = clampSoloCameraDistance(
    options.soloCameraDistance ?? initial.camera.distance ?? DEFAULT_SOLO_CAMERA_DISTANCE,
  );
  let soloCameraOffsetY = clampSoloCameraOffsetY(
    options.soloCameraOffsetY ?? initial.camera.offsetY ?? DEFAULT_SOLO_CAMERA_OFFSET_Y,
  );
  let soloCameraMode: ArenaCameraMode = options.soloCameraMode ?? initial.camera.mode;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hexColorToNumber(initial.colors.background));

  let { camera, controls } = createCamera(
    mode,
    renderer.domElement,
    soloCameraMode,
    soloCameraAngleDeg,
    soloCameraFov,
    soloCameraDistance,
    viewFaction,
    soloCameraOffsetY,
  );

  scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x20242c, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(14, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  applySunShadowSpan(sun, ARENA_W, ARENA_H);
  scene.add(sun);

  const arenaRoot = new THREE.Group();
  scene.add(arenaRoot);
  let sandboxMarkers: THREE.Group;
  let arenaTerrain: THREE.Group;
  ({ sandboxMarkers, arenaTerrain } = mountArenaVisuals(arenaRoot, arenaVisualFromDraft(initial)));
  setArenaTerrainVisibility(mode, sandboxMarkers, arenaTerrain);

  const resize = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    resizeCamera(
      camera,
      width / Math.max(height, 1),
      soloCameraAngleDeg,
      viewFaction,
      soloViewBottomExtra,
      { width: ARENA_W, height: ARENA_H },
    );
  };
  resize();
  window.addEventListener('resize', resize);

  /** 按当前配置重建地形与单机镜头，不销毁 WebGL 上下文。 */
  const rebuildArena = (): void => {
    syncArenaCoords();
    const draft = dumpArenaConfigDraft();
    soloCameraMode = draft.camera.mode;
    soloCameraFov = clampSoloCameraFov(draft.camera.fov);
    soloCameraDistance = clampSoloCameraDistance(
      draft.camera.distance ?? DEFAULT_SOLO_CAMERA_DISTANCE,
    );
    soloCameraOffsetY = clampSoloCameraOffsetY(
      draft.camera.offsetY ?? DEFAULT_SOLO_CAMERA_OFFSET_Y,
    );
    soloCameraAngleDeg = clampSoloCameraAngle(draft.camera.angleDeg);
    soloViewBottomExtra = clampSoloViewBottomExtra(draft.camera.bottomExtra);
    scene.background = new THREE.Color(hexColorToNumber(draft.colors.background));
    applySunShadowSpan(sun, ARENA_W, ARENA_H);
    clearGroup(arenaRoot);
    ({ sandboxMarkers, arenaTerrain } = mountArenaVisuals(arenaRoot, arenaVisualFromDraft(draft)));
    controls?.dispose();
    controls = null;
    ({ camera, controls } = createCamera(
      mode,
      renderer.domElement,
      soloCameraMode,
      soloCameraAngleDeg,
      soloCameraFov,
      soloCameraDistance,
      viewFaction,
      soloCameraOffsetY,
    ));
    setArenaTerrainVisibility(mode, sandboxMarkers, arenaTerrain);
    resize();
  };

  /** 透视用配置距离，正交保持默认距离以免改变包场视锥。 */
  const poseDistance = (): number =>
    soloCameraMode === 'perspective' ? soloCameraDistance : DEFAULT_SOLO_CAMERA_DISTANCE;

  const context: SceneContext = {
    renderer,
    scene,
    get camera() {
      return camera;
    },
    get controls() {
      return controls;
    },
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    resize,
    rebuildArena,
    setMode(next, nextFaction = Faction.Blue) {
      controls?.dispose();
      controls = null;
      mode = next;
      viewFaction = nextFaction;
      ({ camera, controls } = createCamera(
        mode,
        renderer.domElement,
        soloCameraMode,
        soloCameraAngleDeg,
        soloCameraFov,
        soloCameraDistance,
        viewFaction,
        soloCameraOffsetY,
      ));
      setArenaTerrainVisibility(mode, sandboxMarkers, arenaTerrain);
      resize();
    },
    getSoloCameraAngle() {
      return soloCameraAngleDeg;
    },
    setSoloCameraAngle(degrees) {
      soloCameraAngleDeg = clampSoloCameraAngle(degrees);
      if (mode === 'solo') {
        applySoloCameraPose(camera, soloCameraAngleDeg, viewFaction, poseDistance(), soloCameraOffsetY);
        resize();
      }
    },
    getSoloViewBottomExtra() {
      return soloViewBottomExtra;
    },
    setSoloViewBottomExtra(value) {
      soloViewBottomExtra = clampSoloViewBottomExtra(value);
      if (mode === 'solo' && camera instanceof THREE.OrthographicCamera) {
        resize();
      }
    },
    getSoloCameraFov() {
      return soloCameraFov;
    },
    setSoloCameraFov(fov) {
      soloCameraFov = clampSoloCameraFov(fov);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = soloCameraFov;
        camera.updateProjectionMatrix();
      }
    },
    getSoloCameraDistance() {
      return soloCameraDistance;
    },
    setSoloCameraDistance(distance) {
      soloCameraDistance = clampSoloCameraDistance(distance);
      if (mode === 'solo' && soloCameraMode === 'perspective') {
        applySoloCameraPose(
          camera,
          soloCameraAngleDeg,
          viewFaction,
          soloCameraDistance,
          soloCameraOffsetY,
        );
        resize();
      }
    },
    getSoloCameraOffsetY() {
      return soloCameraOffsetY;
    },
    setSoloCameraOffsetY(offsetY) {
      soloCameraOffsetY = clampSoloCameraOffsetY(offsetY);
      if (mode === 'solo' && soloCameraMode === 'perspective') {
        applySoloCameraPose(
          camera,
          soloCameraAngleDeg,
          viewFaction,
          soloCameraDistance,
          soloCameraOffsetY,
        );
        resize();
      }
    },
    getSoloCameraMode() {
      return soloCameraMode;
    },
    setSoloCameraMode(nextMode) {
      soloCameraMode = nextMode;
      if (mode !== 'solo') return;
      controls?.dispose();
      controls = null;
      ({ camera, controls } = createCamera(
        mode,
        renderer.domElement,
        soloCameraMode,
        soloCameraAngleDeg,
        soloCameraFov,
        soloCameraDistance,
        viewFaction,
        soloCameraOffsetY,
      ));
      resize();
    },
    setViewFaction(faction) {
      viewFaction = faction;
      if (mode === 'solo') {
        applySoloCameraPose(
          camera,
          soloCameraAngleDeg,
          viewFaction,
          poseDistance(),
          soloCameraOffsetY,
        );
        resize();
      }
    },
    dispose() {
      window.removeEventListener('resize', resize);
      controls?.dispose();
      controls = null;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return context;
}

/** 按场景模式创建镜头，单机镜头不安装控制器以避免任何手势改变视野。 */
function createCamera(
  mode: SceneMode,
  domElement: HTMLElement,
  soloCameraMode: ArenaCameraMode,
  soloCameraAngleDeg: number,
  soloCameraFov: number,
  soloCameraDistance: number,
  viewFaction: Faction,
  soloCameraOffsetY = 0,
): {
  camera: THREE.Camera;
  controls: OrbitControls | null;
} {
  if (mode === 'solo') {
    const distance =
      soloCameraMode === 'perspective' ? soloCameraDistance : DEFAULT_SOLO_CAMERA_DISTANCE;
    if (soloCameraMode === 'perspective') {
      const camera = new THREE.PerspectiveCamera(clampSoloCameraFov(soloCameraFov), 1, 0.1, 500);
      applySoloCameraPose(camera, soloCameraAngleDeg, viewFaction, distance, soloCameraOffsetY);
      return { camera, controls: null };
    }
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, soloCameraAngleDeg, viewFaction, distance);
    return { camera, controls: null };
  }

  const camera = new THREE.PerspectiveCamera(clampSoloCameraFov(soloCameraFov), 1, 0.1, 500);
  camera.position.set(0, 27, 27);
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 8;
  controls.maxDistance = 70;
  controls.update();
  return { camera, controls };
}

/** 把俯仰角限制在可调范围内。 */
export function clampSoloCameraAngle(degrees: number): number {
  return Math.min(SOLO_CAMERA_ANGLE_MAX_DEG, Math.max(SOLO_CAMERA_ANGLE_MIN_DEG, degrees));
}

/** 把下方留白限制在可调范围内。 */
export function clampSoloViewBottomExtra(value: number): number {
  return Math.min(SOLO_VIEW_BOTTOM_EXTRA_MAX, Math.max(SOLO_VIEW_BOTTOM_EXTRA_MIN, value));
}

/** 把透视 FOV 限制在可调范围内。 */
export function clampSoloCameraFov(fov: number): number {
  return Math.min(SOLO_CAMERA_FOV_MAX, Math.max(SOLO_CAMERA_FOV_MIN, fov));
}

/** 把透视镜头距离限制在可调范围内。 */
export function clampSoloCameraDistance(distance: number): number {
  return Math.min(SOLO_CAMERA_DISTANCE_MAX, Math.max(SOLO_CAMERA_DISTANCE_MIN, distance));
}

/** 把透视画面上下偏移限制在可调范围内。 */
export function clampSoloCameraOffsetY(offsetY: number): number {
  return Math.min(SOLO_CAMERA_OFFSET_Y_MAX, Math.max(SOLO_CAMERA_OFFSET_Y_MIN, offsetY));
}

/**
 * 设置单机/联机镜头位姿。
 * 蓝方从 +Z 侧俯视（己方在画面下方）；红方从 -Z 侧镜像，保证「自己永远在下方」。
 * 角度为相对水平面的俯仰角，46° 为默认斜视，90° 为正上俯视。
 * distance 为到场地中心的距离；透视可配，正交缺省用 50。
 * offsetY 仅透视使用：沿画面竖直方向平移镜头且保持朝向，正值让场景上移。
 */
export function applySoloCameraPose(
  camera: THREE.Camera,
  angleDeg: number,
  viewFaction: Faction = Faction.Blue,
  distance: number = DEFAULT_SOLO_CAMERA_DISTANCE,
  offsetY: number = DEFAULT_SOLO_CAMERA_OFFSET_Y,
): void {
  const elevDeg = clampSoloCameraAngle(angleDeg);
  const towardNear = viewFaction === Faction.Blue ? 1 : -1;
  const radius = clampSoloCameraDistance(distance);
  if (elevDeg >= SOLO_TOP_DOWN_ANGLE_DEG) {
    camera.position.set(0, radius, 0);
    camera.up.set(0, 0, -towardNear);
  } else {
    const elev = (elevDeg * Math.PI) / 180;
    camera.position.set(
      0,
      radius * Math.sin(elev),
      towardNear * radius * Math.cos(elev),
    );
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const shift = clampSoloCameraOffsetY(offsetY);
  if (shift !== 0) {
    // 朝画面下方挪镜头，原点出现在画面更上方，给底部 HUD 腾空。
    _cameraScreenUp.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.position.addScaledVector(_cameraScreenUp, -shift);
    camera.updateMatrixWorld(true);
  }
}

/**
 * 按当前斜视角把战场四角投到相机空间，再配平宽高比，保证场地始终完整可见。
 */
export function calculateSoloOrthoBounds(
  aspect: number,
  angleDeg: number = DEFAULT_SOLO_CAMERA_ANGLE_DEG,
  viewFaction: Faction = Faction.Blue,
  bottomExtra: number = DEFAULT_SOLO_VIEW_BOTTOM_EXTRA,
  size: { width: number; height: number } = { width: ARENA_W, height: ARENA_H },
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  applySoloCameraPose(camera, angleDeg, viewFaction);

  const halfW = size.width / 2 + SOLO_VIEW_PADDING;
  const halfH = size.height / 2 + SOLO_VIEW_PADDING;
  const nearSign = viewFaction === Faction.Blue ? 1 : -1;
  const nearExtra = clampSoloViewBottomExtra(bottomExtra);
  const corners = [
    new THREE.Vector3(-halfW, 0, -halfH),
    new THREE.Vector3(halfW, 0, -halfH),
    new THREE.Vector3(halfW, 0, halfH),
    new THREE.Vector3(-halfW, 0, halfH),
    new THREE.Vector3(-halfW, 0, nearSign * (halfH + nearExtra)),
    new THREE.Vector3(halfW, 0, nearSign * (halfH + nearExtra)),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const inv = camera.matrixWorldInverse;
  for (const corner of corners) {
    corner.applyMatrix4(inv);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  let width = maxX - minX;
  let height = maxY - minY;
  if (width / height < aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  return {
    left: centerX - width / 2,
    right: centerX + width / 2,
    top: centerY + height / 2,
    bottom: centerY - height / 2,
  };
}

/** 容器变化时更新投影；正交镜头始终按宽高比例完整包住战场。 */
function resizeCamera(
  camera: THREE.Camera,
  aspect: number,
  soloCameraAngleDeg: number,
  viewFaction: Faction,
  bottomExtra: number,
  size: { width: number; height: number },
): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const bounds = calculateSoloOrthoBounds(
      aspect,
      soloCameraAngleDeg,
      viewFaction,
      bottomExtra,
      size,
    );
    camera.left = bounds.left;
    camera.right = bounds.right;
    camera.top = bounds.top;
    camera.bottom = bounds.bottom;
    camera.updateProjectionMatrix();
  }
}

/** 把地面、网格、河桥挂到同一组，便于 rebuild 时整组替换。 */
function mountArenaVisuals(
  root: THREE.Group,
  layout: ArenaVisualLayout,
): { sandboxMarkers: THREE.Group; arenaTerrain: THREE.Group } {
  root.add(createArenaGround(layout));
  root.add(createArenaGrid(layout));
  root.add(createArenaBorder(layout));
  const sandboxMarkers = createSandboxMarkers(layout);
  const arenaTerrain = createArenaTerrain(layout);
  root.add(sandboxMarkers);
  root.add(arenaTerrain);
  return { sandboxMarkers, arenaTerrain };
}

/** 供配置页预览复用的整场地视觉；默认显示河桥而不是沙盒中线。 */
export function createArenaVisualGroup(layout: ArenaVisualLayout, showRiver = true): THREE.Group {
  const root = new THREE.Group();
  const { sandboxMarkers, arenaTerrain } = mountArenaVisuals(root, layout);
  sandboxMarkers.visible = !showRiver;
  arenaTerrain.visible = showRiver;
  return root;
}

/** layout 的 sim Y → scene Z；预览可能与全局 ARENA_H 不同，不能用 coords.toSceneZ。 */
function layoutToSceneZ(layout: ArenaVisualLayout, simY: number): number {
  return layout.height / 2 - simY;
}

/** 河道在 scene Z 上的范围，minZ 靠红方、maxZ 靠蓝方。 */
function riverSceneZBand(layout: ArenaVisualLayout): {
  minZ: number;
  maxZ: number;
  centerZ: number;
  depth: number;
} {
  const depth = layout.riverMaxY - layout.riverMinY;
  const minZ = layoutToSceneZ(layout, layout.riverMaxY);
  const maxZ = layoutToSceneZ(layout, layout.riverMinY);
  return { minZ, maxZ, centerZ: (minZ + maxZ) / 2, depth };
}

/** 顶面贴齐 topY 的竖直盒子，便于地面/河/桥共用。 */
function createVolumeBox(
  width: number,
  thickness: number,
  depth: number,
  material: THREE.Material,
  topY: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), material);
  mesh.position.y = topY - thickness / 2;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function createGroundMaterial(layout: ArenaVisualLayout): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hexColorToNumber(layout.colors.ground),
    roughness: 0.95,
    metalness: 0,
  });
}

/** 两侧半场地面盒，中间留出河槽。 */
function createArenaGround(layout: ArenaVisualLayout): THREE.Group {
  const group = new THREE.Group();
  const material = createGroundMaterial(layout);
  const river = riverSceneZBand(layout);
  const halfH = layout.height / 2;

  const blueDepth = halfH - river.maxZ;
  if (blueDepth > 0) {
    const blue = createVolumeBox(layout.width, ARENA_GROUND_THICKNESS, blueDepth, material, 0);
    blue.position.z = (halfH + river.maxZ) / 2;
    group.add(blue);
  }

  const redDepth = river.minZ + halfH;
  if (redDepth > 0) {
    const red = createVolumeBox(layout.width, ARENA_GROUND_THICKNESS, redDepth, material, 0);
    red.position.z = (-halfH + river.minZ) / 2;
    group.add(red);
  }

  return group;
}

/** 沙盒用中线 + 河道缺口的地面色填充，对局时整组隐藏以露出河槽。 */
function createSandboxMarkers(layout: ArenaVisualLayout): THREE.Group {
  const group = new THREE.Group();
  group.add(createHalfCourtLine(layout));
  const river = riverSceneZBand(layout);
  if (river.depth > 0) {
    const fill = createVolumeBox(
      layout.width,
      ARENA_GROUND_THICKNESS,
      river.depth,
      createGroundMaterial(layout),
      0,
    );
    fill.position.z = river.centerZ;
    group.add(fill);
  }
  return group;
}

/** 一格一线的参考网格。河道带内不画，避免线悬在河槽上。 */
function createArenaGrid(layout: ArenaVisualLayout): THREE.LineSegments {
  const halfW = layout.width / 2;
  const halfH = layout.height / 2;
  const river = riverSceneZBand(layout);
  const points: number[] = [];
  const y = 0.01;
  for (let x = 1; x < layout.width; x++) {
    const sx = x - halfW;
    if (river.minZ > -halfH) points.push(sx, y, -halfH, sx, y, river.minZ);
    if (river.maxZ < halfH) points.push(sx, y, river.maxZ, sx, y, halfH);
  }
  for (let z = 1; z < layout.height; z++) {
    const sz = z - halfH;
    if (sz > river.minZ && sz < river.maxZ) continue;
    points.push(-halfW, y, sz, halfW, y, sz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: hexColorToNumber(layout.colors.grid),
      transparent: true,
      opacity: 0.6,
    }),
  );
}

function createArenaBorder(layout: ArenaVisualLayout): THREE.Line {
  const halfW = layout.width / 2;
  const halfH = layout.height / 2;
  const points = [
    new THREE.Vector3(-halfW, 0.02, -halfH),
    new THREE.Vector3(halfW, 0.02, -halfH),
    new THREE.Vector3(halfW, 0.02, halfH),
    new THREE.Vector3(-halfW, 0.02, halfH),
    new THREE.Vector3(-halfW, 0.02, -halfH),
  ];
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: hexColorToNumber(layout.colors.border) }),
  );
}

/** 中线，只用来标记两边半场 */
function createHalfCourtLine(layout: ArenaVisualLayout): THREE.Line {
  const points = [
    new THREE.Vector3(-layout.width / 2, 0.02, 0),
    new THREE.Vector3(layout.width / 2, 0.02, 0),
  ];
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: hexColorToNumber(layout.colors.grid) }),
  );
}

/** 单机/联机对局的中线河道与双桥；沙盒保留原有空场地中线。 */
function createArenaTerrain(layout: ArenaVisualLayout): THREE.Group {
  const terrain = new THREE.Group();
  const river = riverSceneZBand(layout);
  const riverMesh = createVolumeBox(
    layout.width,
    ARENA_RIVER_THICKNESS,
    river.depth,
    new THREE.MeshStandardMaterial({
      color: hexColorToNumber(layout.colors.river),
      roughness: 0.72,
      metalness: 0.08,
    }),
    -ARENA_RIVER_DROP,
  );
  riverMesh.position.z = river.centerZ;
  terrain.add(riverMesh);

  const bridgeMaterial = new THREE.MeshStandardMaterial({
    color: hexColorToNumber(layout.colors.bridge),
    roughness: 0.82,
    metalness: 0,
  });
  for (const bridge of layout.bridges) {
    const bridgeWidth = bridge.maxX - bridge.minX;
    const bridgeDeck = createVolumeBox(
      bridgeWidth,
      ARENA_BRIDGE_THICKNESS,
      river.depth,
      bridgeMaterial,
      ARENA_BRIDGE_DECK_Y,
    );
    bridgeDeck.position.x = bridge.minX + bridgeWidth / 2 - layout.width / 2;
    bridgeDeck.position.z = river.centerZ;
    terrain.add(bridgeDeck);
  }
  return terrain;
}

/** 按场景模式切换对局河桥与沙盒中线，避免沙盒地形发生变化。 */
function setArenaTerrainVisibility(
  mode: SceneMode,
  sandboxMarkers: THREE.Group,
  arenaTerrain: THREE.Group,
): void {
  const isSolo = mode === 'solo';
  sandboxMarkers.visible = !isSolo;
  arenaTerrain.visible = isSolo;
}

function applySunShadowSpan(sun: THREE.DirectionalLight, width: number, height: number): void {
  const shadowSpan = Math.max(width, height) * 0.75;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.far = 90;
}

function clearGroup(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0]!;
    group.remove(child);
    disposeObject3D(child);
  }
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  });
}
