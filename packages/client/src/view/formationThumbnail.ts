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

/**
 * 阵型按钮用的 3D 缩略图。
 *
 * 战场单位有独立生命周期且挂在对局 scene 上，不能直接复用；这里改为
 * 「共享 GPU 资源（贴图/几何）+ 单个离屏 Renderer + 图片缓存」：每个阵型只渲染一次，
 * 之后按钮只是一张 <img>，不产生任何逐帧开销。
 */

/** 缩略图像素边长；按钮显示尺寸远小于此值，保证高分屏不糊。 */
const THUMBNAIL_SIZE = 192;
/** 等待共享立绘贴图就绪的最长帧数；超时仍出图，避免按钮一直空着。 */
const MAX_TEXTURE_WAIT_FRAMES = 180;
/** 阵型包围盒外扩的世界单位，给立绘和脚下阴影留边。 */
const FRAME_MARGIN = 1.2;
/** 取景时按最高立绘估算的顶部空间（世界单位）。 */
const FRAME_HEIGHT = 4.5;

interface ThumbnailSession {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
let session: ThumbnailSession | null = null;
/** 渲染串行化：只有一个 Renderer 和一个 scene，并发请求必须排队。 */
let queue: Promise<unknown> = Promise.resolve();
/** 无 WebGL（如 jsdom）时置位，后续请求直接返回 null 不再重试。 */
let unavailable = false;

/** 缓存键带上 rows 与间距，卡组页改完配置后按钮能立刻换新图。 */
export function formationThumbnailKey(formation: CardFormation): string {
  const rows = formation.rows.map((row) => row.join(',')).join('|');
  return `${formation.id}#${formation.colSpacing}#${formation.rowSpacing}#${rows}`;
}

/** 取阵型缩略图 dataURL；同一阵型只渲染一次，无 WebGL 环境返回 null。 */
export function getFormationThumbnail(formation: CardFormation): Promise<string | null> {
  const key = formationThumbnailKey(formation);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  if (unavailable) return Promise.resolve(null);

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const task = queue.then(() => renderThumbnail(formation)).then((url) => {
    pending.delete(key);
    if (url) cache.set(key, url);
    return url;
  });
  queue = task.catch(() => null);
  pending.set(key, task);
  return task;
}

/** 会话结束时释放离屏渲染资源；缓存图片仍保留，下次进局无需重渲。 */
export function disposeFormationThumbnailRenderer(): void {
  if (!session) return;
  session.renderer.dispose();
  session.renderer.domElement.remove();
  session = null;
}

/** 建或复用唯一的离屏 Renderer；创建失败说明环境无 WebGL。 */
function ensureSession(): ThumbnailSession | null {
  if (session) return session;
  if (unavailable) return null;
  try {
    // toDataURL 要在 render 之后读像素，必须保留绘制缓冲。
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xc7dcff, 0x1d2430, 1.8));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    session = { renderer, scene, camera };
    return session;
  } catch {
    unavailable = true;
    return null;
  }
}

/** 摆好一次性单位、等贴图就绪、出图，然后立刻清干净场景。 */
async function renderThumbnail(formation: CardFormation): Promise<string | null> {
  const active = ensureSession();
  if (!active) return null;

  const points = resolveFormationSpawns(formation, Faction.Blue, 0, 0);
  if (points.length === 0) return null;

  // 与战场一致：sim 的 +y 朝向敌方，在场景里是 -z，镜头留在 +z 侧俯视。
  const placed = points.map((point) => ({ typeId: point.typeId, x: point.x, z: -point.y }));
  frameCamera(active.camera, placed);

  const views: UnitView[] = [];
  for (const unit of placed) {
    const view = new UnitView(Faction.Blue, unit.typeId);
    view.update(unit.x, unit.z, 0, 1, 1, UnitState.Idle, false, false, false, false, 0, active.camera);
    active.scene.add(view.group);
    views.push(view);
  }

  try {
    await waitForSprites(placed.map((unit) => unit.typeId));
    for (const [index, view] of views.entries()) {
      const unit = placed[index]!;
      // 贴图 onLoad 只改共享模板材质，必须再跑一次 update 把 visible 同步到克隆材质。
      view.update(unit.x, unit.z, 0, 1, 1, UnitState.Idle, false, false, false, false, 0, active.camera);
    }
    active.renderer.render(active.scene, active.camera);
    return active.renderer.domElement.toDataURL('image/png');
  } finally {
    for (const view of views) {
      active.scene.remove(view.group);
      view.dispose();
    }
  }
}

/** 按阵型包围盒配平正交视锥，让不同规模的阵型都占满按钮且不越界。 */
function frameCamera(
  camera: THREE.OrthographicCamera,
  units: ReadonlyArray<{ x: number; z: number }>,
): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const unit of units) {
    minX = Math.min(minX, unit.x);
    maxX = Math.max(maxX, unit.x);
    minZ = Math.min(minZ, unit.z);
    maxZ = Math.max(maxZ, unit.z);
  }
  minX -= FRAME_MARGIN;
  maxX += FRAME_MARGIN;
  minZ -= FRAME_MARGIN;
  maxZ += FRAME_MARGIN;

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ, 1) * 1.6;
  // 45° 俯视与单机战场一致，抬高的距离只需覆盖包围盒对角线。
  camera.position.set(centerX, radius, centerZ + radius);
  camera.up.set(0, 1, 0);
  camera.lookAt(centerX, FRAME_HEIGHT / 2, centerZ);
  camera.updateMatrixWorld(true);

  // 立绘从地面往上长，取景盒必须连顶部一起投影，否则高个兵种会被切头。
  const corner = new THREE.Vector3();
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const x of [minX, maxX]) {
    for (const y of [0, FRAME_HEIGHT]) {
      for (const z of [minZ, maxZ]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        left = Math.min(left, corner.x);
        right = Math.max(right, corner.x);
        bottom = Math.min(bottom, corner.y);
        top = Math.max(top, corner.y);
      }
    }
  }

  const half = Math.max(right - left, top - bottom) / 2;
  const cx = (left + right) / 2;
  const cy = (bottom + top) / 2;
  camera.left = cx - half;
  camera.right = cx + half;
  camera.top = cy + half;
  camera.bottom = cy - half;
  camera.near = 0.1;
  camera.far = radius * 4;
  camera.updateProjectionMatrix();
}

/** 共享立绘异步加载，出图前补帧等待；超时兜底避免请求悬挂。 */
function waitForSprites(typeIds: readonly UnitTypeId[]): Promise<void> {
  const ready = (): boolean =>
    typeIds.every((typeId) => {
      const materials = getSpriteMaterials(typeId);
      return !materials || (materials.front.visible && materials.back.visible);
    });

  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    let frames = 0;
    const tick = (): void => {
      if (ready() || (frames += 1) >= MAX_TEXTURE_WAIT_FRAMES) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
