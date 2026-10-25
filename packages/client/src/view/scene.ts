import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  addArenaLights,
  addOutline,
  applyArenaRendererStyle,
  ARENA_STYLE,
  createCheckerTexture,
  createToonMaterial,
  seededRandom,
} from './arenaStyle.js';
import {
  arenaFullSize,
  dumpArenaConfigDraft,
  Faction,
  resolveActiveBridges,
  UNIT_CONFIGS,
  type ArenaBasePos,
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
  /** 配置页预览用的单边基地；对局场景不传，避免和真实单位叠两层。 */
  bases?: readonly ArenaBasePos[];
}

/** 把 CSS #rrggbb 转成 Three 整数色。 */
export function hexColorToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/** 从当前运行时草稿取出场地视觉布局；草稿宽高是单边，这里展开成全场。 */
export function arenaVisualFromDraft(
  draft: ArenaConfigDraft = dumpArenaConfigDraft(),
  options: { showBases?: boolean } = {},
): ArenaVisualLayout {
  const full = arenaFullSize(draft);
  return {
    width: full.width,
    height: full.height,
    riverMinY: draft.height,
    riverMaxY: draft.height + draft.riverWidth,
    bridges: resolveActiveBridges(draft),
    colors: draft.colors,
    bases: options.showBases ? draft.bases : undefined,
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
  applyArenaRendererStyle(renderer);
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

  const sun = addArenaLights(scene);
  applySunShadowSpan(sun, ARENA_W, ARENA_H);

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
  root.add(createArenaBorder(layout));
  root.add(createOutfield(layout));
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
  const bases = createBaseMarkers(layout);
  if (bases) root.add(bases);
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
  material: THREE.Material | THREE.Material[],
  topY: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), material);
  mesh.position.y = topY - thickness / 2;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/**
 * 半场地面盒的六面材质：顶面棋盘草地，其余为泥土侧面。
 * BoxGeometry 顶面 v=0 在 +Z 侧，正好对应 sim 行号小的一边，rowOffset 对齐全局格奇偶。
 */
function createGroundMaterials(
  layout: ArenaVisualLayout,
  rows: number,
  rowOffset: number,
): THREE.Material[] {
  const grass = createToonMaterial(0xffffff, 0.9);
  grass.map = createCheckerTexture(
    layout.width,
    Math.max(1, rows),
    layout.colors.ground,
    layout.colors.grid,
    rowOffset,
  );
  const dirt = createToonMaterial(ARENA_STYLE.dirt);
  return [dirt, dirt, grass, dirt, dirt, dirt];
}

/** 两侧半场地面盒，中间留出河槽。 */
function createArenaGround(layout: ArenaVisualLayout): THREE.Group {
  const group = new THREE.Group();
  const river = riverSceneZBand(layout);
  const halfH = layout.height / 2;

  const blueDepth = halfH - river.maxZ;
  if (blueDepth > 0) {
    const blue = createVolumeBox(
      layout.width,
      ARENA_GROUND_THICKNESS,
      blueDepth,
      createGroundMaterials(layout, blueDepth, 0),
      0,
    );
    blue.position.z = (halfH + river.maxZ) / 2;
    group.add(blue);
  }

  const redDepth = river.minZ + halfH;
  if (redDepth > 0) {
    // 红方半场贴图首行（+Z 侧）紧挨河道，对应 sim 行号 riverMaxY
    const red = createVolumeBox(
      layout.width,
      ARENA_GROUND_THICKNESS,
      redDepth,
      createGroundMaterials(layout, redDepth, layout.riverMaxY),
      0,
    );
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
      createGroundMaterials(layout, river.depth, layout.riverMinY),
      0,
    );
    fill.position.z = river.centerZ;
    group.add(fill);
  }
  return group;
}

/** 场边石沿宽度（世界单位），完全落在场地边界之外。 */
export const ARENA_RIM_WIDTH = 0.55;
/** 石块高出地面的平均高度（压低后不再像一堵墙）。 */
const ARENA_RIM_HEIGHT = 0.22;
/** 石块沿边排布的平均间距。 */
const ARENA_RIM_STONE_STEP = 0.62;
/** 石沿外侧的渐变过渡带宽度，把场地边缘柔和地融进场外沙地。 */
const ARENA_APRON_WIDTH = 1.4;
/** 场外草坪向四周延伸的距离，需盖住任意镜头下的可见范围。 */
const ARENA_OUTFIELD_EXTENT = 40;
/** 场外装饰离石沿外缘的最小间距，避免贴着场地显得拥挤。 */
const ARENA_DECOR_MIN_GAP = 0.6;
/** 场外装饰分布带宽度。 */
const ARENA_DECOR_BAND = 7;

/**
 * 场地外沿：贴地矮基座 + 一圈大小、高度、朝向略有差异的圆角石块，
 * 打破连续直墙的生硬感；全部落在 |x|>W/2 或 |z|>H/2 外，不占可走格子。
 */
function createArenaBorder(layout: ArenaVisualLayout): THREE.Group {
  const group = new THREE.Group();
  const halfW = layout.width / 2;
  const halfH = layout.height / 2;
  const rim = ARENA_RIM_WIDTH;
  const color = hexColorToNumber(layout.colors.border);

  // 矮基座：从河底到略高于地面，挡住河道两端截面；颜色比石块深，读作阴影底座
  const baseMaterial = createToonMaterial(
    new THREE.Color(color).multiplyScalar(0.78).getHex(),
    0.9,
  );
  const baseH = ARENA_GROUND_THICKNESS + 0.06;
  const outerW = layout.width + rim * 2;
  const bases: Array<{ w: number; d: number; x: number; z: number }> = [
    { w: outerW, d: rim, x: 0, z: -halfH - rim / 2 },
    { w: outerW, d: rim, x: 0, z: halfH + rim / 2 },
    { w: rim, d: layout.height, x: -halfW - rim / 2, z: 0 },
    { w: rim, d: layout.height, x: halfW + rim / 2, z: 0 },
  ];
  for (const seg of bases) {
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(seg.w, baseH, seg.d, 2, 0.08),
      baseMaterial,
    );
    base.position.set(seg.x, 0.06 - baseH / 2, seg.z);
    base.receiveShadow = true;
    group.add(base);
  }

  group.add(createRimStones(layout, color));
  return group;
}

/** 沿场地四周生成错落的圆角石块（Instanced），尺寸/高度/旋转由固定种子决定。 */
function createRimStones(layout: ArenaVisualLayout, color: number): THREE.InstancedMesh {
  const random = seededRandom(layout.width * 53 + layout.height * 29 + 7);
  const halfW = layout.width / 2;
  const halfH = layout.height / 2;
  const center = ARENA_RIM_WIDTH / 2;
  const items: Array<{ x: number; z: number; alongX: boolean }> = [];
  /** 在一条边上按近似等距撒石块，留出随机缝隙。 */
  const placeEdge = (length: number, at: (t: number) => { x: number; z: number }, alongX: boolean) => {
    const count = Math.max(2, Math.round(length / ARENA_RIM_STONE_STEP));
    for (let i = 0; i < count; i++) {
      if (random() < 0.12) continue;
      const t = (i + 0.5) / count - 0.5 + (random() - 0.5) * 0.3 / count;
      items.push({ ...at(t * length), alongX });
    }
  };
  const spanW = layout.width + ARENA_RIM_WIDTH * 2;
  placeEdge(spanW, (s) => ({ x: s, z: -halfH - center }), true);
  placeEdge(spanW, (s) => ({ x: s, z: halfH + center }), true);
  placeEdge(layout.height, (s) => ({ x: -halfW - center, z: s }), false);
  placeEdge(layout.height, (s) => ({ x: halfW + center, z: s }), false);

  const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.3);
  const stones = new THREE.InstancedMesh(geometry, createToonMaterial(color, 0.85), items.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tint = new THREE.Color();
  items.forEach((item, i) => {
    const long = ARENA_RIM_STONE_STEP * (0.75 + random() * 0.35);
    // 宽度不超过石沿，保证不伸进场地
    const wide = ARENA_RIM_WIDTH * (0.65 + random() * 0.2);
    const tall = ARENA_RIM_HEIGHT * (0.7 + random() * 0.7);
    scale.set(item.alongX ? long : wide, tall, item.alongX ? wide : long);
    euler.set((random() - 0.5) * 0.12, (random() - 0.5) * 0.12, (random() - 0.5) * 0.12);
    quat.setFromEuler(euler);
    pos.set(item.x, tall / 2 - 0.02, item.z);
    stones.setMatrixAt(i, matrix.compose(pos, quat, scale));
    // 每块石头亮度轻微浮动，像手工砌的
    stones.setColorAt(i, tint.set(0xffffff).multiplyScalar(0.88 + random() * 0.14));
  });
  stones.instanceMatrix.needsUpdate = true;
  if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.raycast = () => {};
  return addOutline(stones, 0.03);
}

/** 场外装饰点：kind 区分树/岩石，scale 为整体缩放。 */
export interface OutfieldDecor {
  kind: 'tree' | 'rock';
  x: number;
  z: number;
  scale: number;
}

/**
 * 用固定种子在石沿外的环带里撒树丛和岩石。
 * 只保留落在场地+石沿+间隙矩形之外的点，保证不会遮挡战场。
 */
export function createOutfieldDecorPositions(layout: ArenaVisualLayout): OutfieldDecor[] {
  const random = seededRandom(layout.width * 131 + layout.height * 17);
  const innerHalfW = layout.width / 2 + ARENA_RIM_WIDTH + ARENA_DECOR_MIN_GAP;
  const innerHalfH = layout.height / 2 + ARENA_RIM_WIDTH + ARENA_DECOR_MIN_GAP;
  const outerHalfW = innerHalfW + ARENA_DECOR_BAND;
  const outerHalfH = innerHalfH + ARENA_DECOR_BAND;
  const count = Math.round((layout.width + layout.height) * 2.2);
  const result: OutfieldDecor[] = [];
  for (let attempt = 0; attempt < count * 6 && result.length < count; attempt++) {
    const x = (random() * 2 - 1) * outerHalfW;
    const z = (random() * 2 - 1) * outerHalfH;
    if (Math.abs(x) < innerHalfW && Math.abs(z) < innerHalfH) continue;
    const kind = random() < 0.72 ? 'tree' : 'rock';
    result.push({ kind, x, z, scale: 0.75 + random() * 0.6 });
  }
  return result;
}

/**
 * 石沿外的渐变过渡带：内缘用场地地面色，外缘过渡到场外沙地色，
 * 用顶点色插值消除场内外两种颜色的硬边。
 */
function createOutfieldApron(
  layout: ArenaVisualLayout,
  innerHalfW: number,
  innerHalfH: number,
): THREE.Mesh {
  const outerHalfW = innerHalfW + ARENA_APRON_WIDTH;
  const outerHalfH = innerHalfH + ARENA_APRON_WIDTH;
  // 内外各 4 个角点，按 0..3 顺时针，组成 4 个梯形
  const inner = [
    [-innerHalfW, -innerHalfH],
    [innerHalfW, -innerHalfH],
    [innerHalfW, innerHalfH],
    [-innerHalfW, innerHalfH],
  ];
  const outer = [
    [-outerHalfW, -outerHalfH],
    [outerHalfW, -outerHalfH],
    [outerHalfW, outerHalfH],
    [-outerHalfW, outerHalfH],
  ];
  const innerColor = new THREE.Color(layout.colors.ground).multiplyScalar(0.92);
  const outerColor = new THREE.Color(ARENA_STYLE.outfield);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [x, z] of inner) {
    positions.push(x!, 0, z!);
    colors.push(innerColor.r, innerColor.g, innerColor.b);
  }
  for (const [x, z] of outer) {
    positions.push(x!, 0, z!);
    colors.push(outerColor.r, outerColor.g, outerColor.b);
  }
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    // 两个三角形，绕序保证法线朝上
    indices.push(i, 4 + i, 4 + next, i, 4 + next, next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = createToonMaterial(0xffffff, 0.95);
  material.vertexColors = true;
  material.side = THREE.DoubleSide;
  const apron = new THREE.Mesh(geometry, material);
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  apron.raycast = () => {};
  return apron;
}

/** 场外：中间挖空的草坪环 + Instanced 树丛和岩石，一次绘制、无每帧开销。 */
function createOutfield(layout: ArenaVisualLayout): THREE.Group {
  const group = new THREE.Group();
  const rimHalfW = layout.width / 2 + ARENA_RIM_WIDTH;
  const rimHalfH = layout.height / 2 + ARENA_RIM_WIDTH;
  group.add(createOutfieldApron(layout, rimHalfW, rimHalfH));
  // 草坪从过渡带外缘开始铺
  const holeHalfW = rimHalfW + ARENA_APRON_WIDTH;
  const holeHalfH = rimHalfH + ARENA_APRON_WIDTH;
  const outerHalfW = holeHalfW + ARENA_OUTFIELD_EXTENT;
  const outerHalfH = holeHalfH + ARENA_OUTFIELD_EXTENT;
  const shape = new THREE.Shape()
    .moveTo(-outerHalfW, -outerHalfH)
    .lineTo(outerHalfW, -outerHalfH)
    .lineTo(outerHalfW, outerHalfH)
    .lineTo(-outerHalfW, outerHalfH)
    .closePath();
  shape.holes.push(
    new THREE.Path()
      .moveTo(-holeHalfW, -holeHalfH)
      .lineTo(-holeHalfW, holeHalfH)
      .lineTo(holeHalfW, holeHalfH)
      .lineTo(holeHalfW, -holeHalfH)
      .closePath(),
  );
  const lawn = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    createToonMaterial(ARENA_STYLE.outfield, 0.95),
  );
  lawn.rotation.x = -Math.PI / 2;
  // 略低于场地顶面，避免与石沿底边 z-fighting
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  lawn.raycast = () => {};
  group.add(lawn);

  const decor = createOutfieldDecorPositions(layout);
  const trees = decor.filter((item) => item.kind === 'tree');
  const rocks = decor.filter((item) => item.kind === 'rock');
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  /** 按装饰点批量写入实例矩阵；yOffset 为模型底部抬高量。 */
  const fill = (
    mesh: THREE.InstancedMesh,
    items: OutfieldDecor[],
    yOffset: number,
    squash = 1,
  ): THREE.InstancedMesh => {
    items.forEach((item, i) => {
      quat.setFromAxisAngle(yAxis, (item.x * 7.3 + item.z * 3.1) % (Math.PI * 2));
      scale.set(item.scale, item.scale * squash, item.scale);
      pos.set(item.x, yOffset * item.scale * squash, item.z);
      mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    return mesh;
  };

  if (trees.length > 0) {
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.5, 8),
      createToonMaterial(ARENA_STYLE.treeTrunk),
      trees.length,
    );
    group.add(fill(trunk, trees, 0.25));
    const leaf = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      createToonMaterial(ARENA_STYLE.treeLeaf, 0.8),
      trees.length,
    );
    group.add(addOutline(fill(leaf, trees, 0.95), 0.05));
  }
  if (rocks.length > 0) {
    const rock = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.38, 0),
      createToonMaterial(ARENA_STYLE.rock, 0.9),
      rocks.length,
    );
    group.add(addOutline(fill(rock, rocks, 0.2, 0.7), 0.04));
  }
  return group;
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

/** 配置页预览：蓝方半场基地 + 对岸镜像，方便对照坐标。 */
function createBaseMarkers(layout: ArenaVisualLayout): THREE.Group | null {
  if (!layout.bases?.length) return null;
  const group = new THREE.Group();
  const size = UNIT_CONFIGS.building_base.footprint;
  for (const base of layout.bases) {
    group.add(createBaseMarkerBox(layout, base.x, base.y, 0x4a90d9, size));
    group.add(createBaseMarkerBox(layout, base.x, layout.height - base.y, 0xc45c5c, size));
  }
  return group;
}

function createBaseMarkerBox(
  layout: ArenaVisualLayout,
  simX: number,
  simY: number,
  color: number,
  size: number,
): THREE.Mesh {
  const height = 1.2;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, height, size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 }),
  );
  mesh.position.set(simX - layout.width / 2, height / 2, layoutToSceneZ(layout, simY));
  return mesh;
}

/** 单机/联机对局的中线河道与桥面；沙盒保留原有空场地中线。 */
function createArenaTerrain(layout: ArenaVisualLayout): THREE.Group {
  const terrain = new THREE.Group();
  const river = riverSceneZBand(layout);
  if (river.depth <= 0) return terrain;
  // 水面略带光泽，比草地更"亮"一些，呈现卡通水体
  const riverMesh = createVolumeBox(
    layout.width,
    ARENA_RIVER_THICKNESS,
    river.depth,
    createToonMaterial(hexColorToNumber(layout.colors.river), 0.35),
    -ARENA_RIVER_DROP,
  );
  riverMesh.position.z = river.centerZ;
  riverMesh.castShadow = false;
  terrain.add(riverMesh);
  terrain.add(createRiverBanks(layout, river));

  const deckMaterial = createToonMaterial(hexColorToNumber(layout.colors.bridge), 0.8);
  const railMaterial = createToonMaterial(ARENA_STYLE.rail, 0.8);
  for (const bridge of layout.bridges) {
    terrain.add(createBridge(layout, river, bridge, deckMaterial, railMaterial));
  }
  return terrain;
}

/** 河道两岸：沙色斜坡条 + 水面浪花条，都在河道带内，不占可走格子。 */
function createRiverBanks(
  layout: ArenaVisualLayout,
  river: ReturnType<typeof riverSceneZBand>,
): THREE.Group {
  const group = new THREE.Group();
  const bankWidth = Math.min(0.22, river.depth * 0.15);
  const bankHeight = ARENA_RIVER_DROP + 0.02;
  const bankMaterial = createToonMaterial(ARENA_STYLE.bank, 0.9);
  const foamMaterial = new THREE.MeshBasicMaterial({
    color: ARENA_STYLE.foam,
    transparent: true,
    opacity: 0.75,
  });
  for (const side of [-1, 1] as const) {
    const edgeZ = side < 0 ? river.minZ : river.maxZ;
    const bank = new THREE.Mesh(
      new RoundedBoxGeometry(layout.width, bankHeight, bankWidth, 2, bankWidth * 0.45),
      bankMaterial,
    );
    bank.position.set(0, -bankHeight / 2 + 0.01, edgeZ - side * (bankWidth / 2));
    bank.receiveShadow = true;
    group.add(bank);

    const foam = new THREE.Mesh(new THREE.PlaneGeometry(layout.width, bankWidth * 0.8), foamMaterial);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, -ARENA_RIVER_DROP + 0.01, edgeZ - side * bankWidth * 1.3);
    foam.raycast = () => {};
    group.add(foam);
  }
  return group;
}

/**
 * 圆角木板拼成的卡通木桥：桥面宽度严格等于配置桥宽，两端略搭到岸上；
 * 矮栏放在桥面 x 边缘内侧，带粗描边。
 */
function createBridge(
  layout: ArenaVisualLayout,
  river: ReturnType<typeof riverSceneZBand>,
  bridge: { minX: number; maxX: number },
  deckMaterial: THREE.Material,
  railMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const bridgeWidth = bridge.maxX - bridge.minX;
  group.position.set(bridge.minX + bridgeWidth / 2 - layout.width / 2, 0, river.centerZ);

  const overhang = 0.25;
  const deckDepth = river.depth + overhang * 2;
  const plankCount = Math.max(2, Math.round(deckDepth / 0.45));
  const gap = 0.05;
  const plankDepth = deckDepth / plankCount - gap;
  const plankGeometry = new RoundedBoxGeometry(
    bridgeWidth,
    ARENA_BRIDGE_THICKNESS,
    plankDepth,
    2,
    Math.min(0.05, plankDepth * 0.3),
  );
  for (let i = 0; i < plankCount; i++) {
    const plank = new THREE.Mesh(plankGeometry, deckMaterial);
    plank.position.set(
      0,
      ARENA_BRIDGE_DECK_Y - ARENA_BRIDGE_THICKNESS / 2,
      -deckDepth / 2 + (i + 0.5) * (plankDepth + gap),
    );
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(addOutline(plank, 0.025));
  }

  const railWidth = Math.min(0.16, bridgeWidth * 0.08);
  const railHeight = 0.28;
  for (const side of [-1, 1] as const) {
    const rail = new THREE.Mesh(
      new RoundedBoxGeometry(railWidth, railHeight, deckDepth, 2, railWidth * 0.45),
      railMaterial,
    );
    rail.position.set(
      side * (bridgeWidth / 2 - railWidth / 2),
      ARENA_BRIDGE_DECK_Y + railHeight / 2,
      0,
    );
    rail.castShadow = true;
    rail.raycast = () => {};
    group.add(addOutline(rail, 0.03));
  }
  return group;
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

/** 按场地尺寸设置主光阴影视锥，覆盖场地与场外装饰带。 */
export function applySunShadowSpan(sun: THREE.DirectionalLight, width: number, height: number): void {
  const shadowSpan = Math.max(width, height) * 0.75 + 4;
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
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      // 棋盘草地等贴图随材质一起释放
      (item as THREE.MeshStandardMaterial).map?.dispose();
      item.dispose();
    }
  });
}
