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

/** 缩略图像素宽高，比例与按钮 128×98 一致，保证高分屏不糊。 */
const THUMBNAIL_WIDTH = 256;
const THUMBNAIL_HEIGHT = Math.round((THUMBNAIL_WIDTH * 98) / 128);
/** 按钮内兵种相对「刚好装进取景」再放大的倍率。 */
export const DEFAULT_UNIT_DISPLAY_SCALE = 2;
/** 阵型包围盒外扩的世界单位。 */
export const DEFAULT_FRAME_MARGIN = 2;
/** 等待共享立绘贴图就绪的最长帧数；超时仍出图，避免按钮一直空着。 */
const MAX_TEXTURE_WAIT_FRAMES = 180;
/** 取景时按最高立绘估算的顶部空间（世界单位）。 */
const FRAME_HEIGHT = 4.5;
/** 阵型地面中心在按钮画面中的竖直锚点：自下而上 1/4，上方留给立绘。 */
const FRAME_ANCHOR_Y_FROM_BOTTOM = 1 / 4;

/** 当前取景放大倍率；写入缓存键，改参后旧图自动失效。 */
let unitDisplayScale = DEFAULT_UNIT_DISPLAY_SCALE;
/** 当前包围盒外扩边距。 */
let frameMargin = DEFAULT_FRAME_MARGIN;

/** 读取阵型缩略图取景参数（供测试或外部调试覆盖）。 */
export function getFormationThumbnailFrameSettings(): {
  unitDisplayScale: number;
  frameMargin: number;
} {
  return { unitDisplayScale, frameMargin };
}

/** 覆盖取景参数；非法值夹到可调范围。 */
export function setFormationThumbnailFrameSettings(settings: {
  unitDisplayScale?: number;
  frameMargin?: number;
}): void {
  if (settings.unitDisplayScale !== undefined) {
    unitDisplayScale = clamp(settings.unitDisplayScale, 1, 3);
  }
  if (settings.frameMargin !== undefined) {
    frameMargin = clamp(settings.frameMargin, 0, 2);
  }
}

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

/** 阵型自身放大 × 全局相对倍率，得到最终按钮取景放大。 */
function effectiveUnitDisplayScale(formation: CardFormation): number {
  return clamp(
    formation.thumbScale * (unitDisplayScale / DEFAULT_UNIT_DISPLAY_SCALE),
    1,
    3,
  );
}

/** 缓存键带上 slots、间距与取景参数，同兵种不同站位不会串图。 */
export function formationThumbnailKey(formation: CardFormation): string {
  const slots = formation.slots
    .map((slot) => `${slot.typeId}@${slot.row},${slot.col}`)
    .join('|');
  const scale = effectiveUnitDisplayScale(formation);
  return `${formation.id}#${formation.colSpacing}#${formation.rowSpacing}#${slots}#s${scale.toFixed(2)}#m${frameMargin.toFixed(2)}`;
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
    renderer.setSize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, false);

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
  // 热更新或比例调整后仍沿用旧 session 时，强制对齐当前缩略图尺寸。
  active.renderer.setSize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, false);

  const points = resolveFormationSpawns(formation, Faction.Blue, 0, 0);
  if (points.length === 0) return null;

  // 与战场一致：sim 的 +y 朝向敌方，在场景里是 -z，镜头留在 +z 侧俯视。
  const placed = points.map((point) => ({
    typeId: point.typeId,
    x: point.x,
    z: -point.y,
  }));
  frameCamera(active.camera, placed, effectiveUnitDisplayScale(formation));

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

/**
 * 按阵型包围盒配正交视锥：水平钉阵型地面中心，竖直锚在按钮自下而上 1/4。
 * 放大以该锚点为中心裁切，优先保证脚底落点稳定，上方留给立绘。
 */
function frameCamera(
  camera: THREE.OrthographicCamera,
  units: ReadonlyArray<{ x: number; z: number }>,
  displayScale: number,
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
  minX -= frameMargin;
  maxX += frameMargin;
  minZ -= frameMargin;
  maxZ += frameMargin;

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ, 1) * 1.6;
  // 45° 俯视与单机战场一致，抬高的距离只需覆盖包围盒对角线。
  camera.position.set(centerX, radius, centerZ + radius);
  camera.up.set(0, 1, 0);
  camera.lookAt(centerX, FRAME_HEIGHT / 2, centerZ);
  camera.updateMatrixWorld(true);

  // 立绘从地面往上长，取景盒必须连顶部一起投影，用来估算刚好装下的范围。
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

  // 阵型地面中心投影到相机空间，作为按钮取景锚点（不跟立绘顶部 AABB 偏移）。
  const formationCenter = corner.set(centerX, 0, centerZ).applyMatrix4(camera.matrixWorldInverse);
  const cx = formationCenter.x;
  const cy = formationCenter.y;
  const below = Math.max(cy - bottom, 0.5);
  const above = Math.max(top - cy, 0.5);
  const halfWNeeded = Math.max(cx - left, right - cx, 0.5);
  const aspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT;
  // 竖直按「下 1/4 / 上 3/4」装下内容，再套按钮宽高比。
  const neededH = Math.max(
    below / FRAME_ANCHOR_Y_FROM_BOTTOM,
    above / (1 - FRAME_ANCHOR_Y_FROM_BOTTOM),
  );
  let height = Math.max(neededH, (halfWNeeded * 2) / aspect);
  let width = height * aspect;
  // 以锚点为中心整体缩小视锥，实现兵种放大。
  height /= displayScale;
  width /= displayScale;
  const halfW = width / 2;
  camera.left = cx - halfW;
  camera.right = cx + halfW;
  camera.bottom = cy - height * FRAME_ANCHOR_Y_FROM_BOTTOM;
  camera.top = cy + height * (1 - FRAME_ANCHOR_Y_FROM_BOTTOM);
  camera.near = 0.1;
  camera.far = radius * 4;
  camera.updateProjectionMatrix();
}

/** 把数值夹到合法区间。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
