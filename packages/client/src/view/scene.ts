import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ARENA_H, ARENA_W } from './coords.js';

/** 单机正交斜视角默认俯仰角（相对水平面，度） */
export const DEFAULT_SOLO_CAMERA_ANGLE_DEG = 45;
/** 单机镜头允许的俯仰角范围 */
export const SOLO_CAMERA_ANGLE_MIN_DEG = 15;
export const SOLO_CAMERA_ANGLE_MAX_DEG = 90;

const SOLO_CAMERA_DISTANCE = 50;
const SOLO_VIEW_PADDING = 1;
/**
 * 战场近端（画面下方）额外留白的世界单位。
 * 取景时把这块空区算进视锥，战场会略上移并略缩小，给底部手牌腾操作空间。
 */
const SOLO_VIEW_BOTTOM_EXTRA = 5;
/** 接近 90° 时改用正上方位姿，避免 lookAt 与 up 平行产生万向节锁 */
const SOLO_TOP_DOWN_ANGLE_DEG = 89.5;

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
  setMode(mode: SceneMode): void;
  /** 读取单机正交镜头俯仰角（度） */
  getSoloCameraAngle(): number;
  /** 运行时调整单机正交镜头俯仰角；沙盒模式下只记值，切回单机时生效 */
  setSoloCameraAngle(degrees: number): void;
  dispose(): void;
}

export type SceneMode = 'sandbox' | 'solo';

export interface SceneOptions {
  mode?: SceneMode;
}

/** 搭好 3D 场景；沙盒使用可操作的透视镜头，单机使用固定的正交斜视角镜头。 */
export function createScene(container: HTMLElement, options: SceneOptions = {}): SceneContext {
  let mode = options.mode ?? 'sandbox';
  let soloCameraAngleDeg = DEFAULT_SOLO_CAMERA_ANGLE_DEG;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  let { camera, controls } = createCamera(mode, renderer.domElement, soloCameraAngleDeg);

  scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x20242c, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(14, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowSpan = Math.max(ARENA_W, ARENA_H) * 0.75;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.far = 90;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_W, ARENA_H),
    new THREE.MeshStandardMaterial({ color: 0x2b3444, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(createArenaGrid());
  scene.add(createArenaBorder());
  scene.add(createHalfCourtLine());

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    resizeCamera(camera, width / height, soloCameraAngleDeg);
  };
  resize();
  window.addEventListener('resize', resize);

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
    setMode(next) {
      // 每次进战局都重建镜头位姿，避免沙盒拖过的视角残留到下一局
      controls?.dispose();
      controls = null;
      mode = next;
      ({ camera, controls } = createCamera(mode, renderer.domElement, soloCameraAngleDeg));
      resize();
    },
    getSoloCameraAngle() {
      return soloCameraAngleDeg;
    },
    setSoloCameraAngle(degrees) {
      soloCameraAngleDeg = clampSoloCameraAngle(degrees);
      if (mode === 'solo' && camera instanceof THREE.OrthographicCamera) {
        applySoloCameraPose(camera, soloCameraAngleDeg);
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
  soloCameraAngleDeg: number,
): {
  camera: THREE.Camera;
  controls: OrbitControls | null;
} {
  if (mode === 'solo') {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, soloCameraAngleDeg);
    return { camera, controls: null };
  }

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
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

/**
 * 设置单机正交镜头位姿：从 +Z 侧俯视战场中心。
 * 角度为相对水平面的俯仰角，45° 为默认斜视，90° 为正上俯视。
 */
export function applySoloCameraPose(camera: THREE.Camera, angleDeg: number): void {
  const elevDeg = clampSoloCameraAngle(angleDeg);
  if (elevDeg >= SOLO_TOP_DOWN_ANGLE_DEG) {
    camera.position.set(0, SOLO_CAMERA_DISTANCE, 0);
    // 正上方俯视时，用 -Z 作为画面上方，与斜视时「蓝方在上」一致
    camera.up.set(0, 0, -1);
  } else {
    const elev = (elevDeg * Math.PI) / 180;
    camera.position.set(
      0,
      SOLO_CAMERA_DISTANCE * Math.sin(elev),
      SOLO_CAMERA_DISTANCE * Math.cos(elev),
    );
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}

/**
 * 按当前斜视角把战场四角投到相机空间，再配平宽高比，保证 18×32 场地始终完整可见。
 */
export function calculateSoloOrthoBounds(
  aspect: number,
  angleDeg: number = DEFAULT_SOLO_CAMERA_ANGLE_DEG,
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  applySoloCameraPose(camera, angleDeg);

  const halfW = ARENA_W / 2 + SOLO_VIEW_PADDING;
  const halfH = ARENA_H / 2 + SOLO_VIEW_PADDING;
  // +Z 为镜头近端，对应画面底部；多包一段空区即可把战场整体上移。
  const corners = [
    new THREE.Vector3(-halfW, 0, -halfH),
    new THREE.Vector3(halfW, 0, -halfH),
    new THREE.Vector3(halfW, 0, halfH + SOLO_VIEW_BOTTOM_EXTRA),
    new THREE.Vector3(-halfW, 0, halfH + SOLO_VIEW_BOTTOM_EXTRA),
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

/** 容器变化时更新投影；正交镜头始终按宽高比例完整包住 18×32 战场。 */
function resizeCamera(camera: THREE.Camera, aspect: number, soloCameraAngleDeg: number): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const bounds = calculateSoloOrthoBounds(aspect, soloCameraAngleDeg);
    camera.left = bounds.left;
    camera.right = bounds.right;
    camera.top = bounds.top;
    camera.bottom = bounds.bottom;
    camera.updateProjectionMatrix();
  }
}

/** 一格一线的参考网格。GridHelper 只能画正方形，场地是 18x32 所以自己拼。 */
function createArenaGrid(): THREE.LineSegments {
  const halfW = ARENA_W / 2;
  const halfH = ARENA_H / 2;
  const points: number[] = [];
  for (let x = 1; x < ARENA_W; x++) {
    points.push(x - halfW, 0.01, -halfH, x - halfW, 0.01, halfH);
  }
  for (let z = 1; z < ARENA_H; z++) {
    points.push(-halfW, 0.01, z - halfH, halfW, 0.01, z - halfH);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x3b4557, transparent: true, opacity: 0.6 }),
  );
}

function createArenaBorder(): THREE.Line {
  const halfW = ARENA_W / 2;
  const halfH = ARENA_H / 2;
  const points = [
    new THREE.Vector3(-halfW, 0.02, -halfH),
    new THREE.Vector3(halfW, 0.02, -halfH),
    new THREE.Vector3(halfW, 0.02, halfH),
    new THREE.Vector3(-halfW, 0.02, halfH),
    new THREE.Vector3(-halfW, 0.02, -halfH),
  ];
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x8394ad }),
  );
}

/** 中线，只用来标记两边半场 */
function createHalfCourtLine(): THREE.Line {
  const points = [
    new THREE.Vector3(-ARENA_W / 2, 0.02, 0),
    new THREE.Vector3(ARENA_W / 2, 0.02, 0),
  ];
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x6b7a92 }),
  );
}
