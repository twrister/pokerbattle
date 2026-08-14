import * as THREE from 'three';

/** 爆炸1 序列帧（独立 PNG），按进度切帧播放。 */
export const EXPLOSION_FRAME_URLS = [
  'effects/explode1/1.png',
  'effects/explode1/2.png',
  'effects/explode1/3.png',
  'effects/explode1/4.png',
  'effects/explode1/5.png',
  'effects/explode1/6.png',
  'effects/explode1/7.png',
  'effects/explode1/8.png',
] as const;
/** 巨型炸弹专用的爆炸2 序列帧。 */
export const GIANT_BOMB_EXPLOSION_FRAME_URLS = [
  'effects/giant-explode2/1.png',
  'effects/giant-explode2/2.png',
  'effects/giant-explode2/3.png',
  'effects/giant-explode2/4.png',
  'effects/giant-explode2/5.png',
  'effects/giant-explode2/6.png',
  'effects/giant-explode2/7.png',
  'effects/giant-explode2/8.png',
] as const;

/** PixelEffects 横向 sheet：Explode2 / Explode4（单帧 16×16，共 12 帧）。 */
export interface ExplosionSheetDef {
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

export const EXPLODE2_SHEET: ExplosionSheetDef = {
  url: 'effects/Explode2.png',
  frameWidth: 16,
  frameHeight: 16,
  frames: 12,
};

export const EXPLODE4_SHEET: ExplosionSheetDef = {
  url: 'effects/Explode4.png',
  frameWidth: 16,
  frameHeight: 16,
  frames: 12,
};

/** PixelEffects Blood3：命中非建筑单位的溅血序列帧（单帧 32×32，共 7 帧）。 */
export const BLOOD3_SHEET: ExplosionSheetDef = {
  url: 'effects/Blood3.png',
  frameWidth: 32,
  frameHeight: 32,
  frames: 7,
};

export type ExplosionSpriteKind =
  | 'normal'
  | 'giant_bomb'
  | 'explode2'
  | 'explode4'
  | 'blood3';

export type ExplosionSheetKind = 'explode2' | 'explode4' | 'blood3';

export const EXPLOSION_FRAME_COUNT = EXPLOSION_FRAME_URLS.length;
/** 多 PNG 爆炸的单帧像素尺寸，用于面片宽高比 */
export const EXPLOSION_FRAME_WIDTH = 217;
export const EXPLOSION_FRAME_HEIGHT = 204;

const textureCache = new Map<string, THREE.Texture>();
const pendingByUrl = new Map<string, Array<(texture: THREE.Texture) => void>>();
const geometryCache = new Map<string, THREE.PlaneGeometry>();

/** 是否为横向 sheet 型爆炸（UV 切帧）。 */
export function isExplosionSheetKind(kind: ExplosionSpriteKind): kind is ExplosionSheetKind {
  return kind === 'explode2' || kind === 'explode4' || kind === 'blood3';
}

/** 返回该 kind 的序列帧总数，供视图按进度取帧索引。 */
export function getExplosionFrameCount(kind: ExplosionSpriteKind): number {
  if (isExplosionSheetKind(kind)) return getExplosionSheet(kind).frames;
  return getExplosionFrameUrls(kind).length;
}

/** 取 sheet 型爆炸的定义。 */
export function getExplosionSheet(kind: ExplosionSheetKind): ExplosionSheetDef {
  if (kind === 'explode2') return EXPLODE2_SHEET;
  if (kind === 'explode4') return EXPLODE4_SHEET;
  return BLOOD3_SHEET;
}

/** 共享爆炸面片几何（中心锚点，爆炸中心落在地面）；按 kind 宽高比缓存。 */
export function getExplosionGeometry(kind: ExplosionSpriteKind = 'normal'): THREE.PlaneGeometry {
  const aspect = isExplosionSheetKind(kind)
    ? getExplosionSheet(kind).frameWidth / getExplosionSheet(kind).frameHeight
    : EXPLOSION_FRAME_WIDTH / EXPLOSION_FRAME_HEIGHT;
  const key = aspect.toFixed(4);
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  geometry = new THREE.PlaneGeometry(aspect, 1);
  geometryCache.set(key, geometry);
  return geometry;
}

/**
 * 为单次爆炸视图创建材质；Node 测试无 DOM 时返回不可见材质。
 */
export function createExplosionMaterial(kind: ExplosionSpriteKind = 'normal'): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    // 中心锚地时下半面片会穿进地面；关掉深度测试避免被地面截掉
    depthTest: false,
    // 爆炸带不透明像素，用 Normal 混合避免白底发糊
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    visible: false,
  });

  if (typeof document === 'undefined') return material;

  if (isExplosionSheetKind(kind)) {
    const sheet = getExplosionSheet(kind);
    bindExplosionTexture(sheet.url, (shared) => {
      const texture = shared.clone();
      texture.needsUpdate = true;
      applySheetFrame(texture, sheet, 0);
      material.map = texture;
      material.visible = true;
      material.needsUpdate = true;
    });
    return material;
  }

  // 预热全部帧，首帧就绪后立刻可见
  const frameUrls = getExplosionFrameUrls(kind);
  for (const url of frameUrls) {
    bindExplosionTexture(url, () => {});
  }
  bindExplosionTexture(frameUrls[0]!, (shared) => {
    const texture = shared.clone();
    texture.needsUpdate = true;
    material.map = texture;
    material.visible = true;
    material.needsUpdate = true;
  });

  return material;
}

/** 按进度（0..1）切换到对应序列帧贴图或 sheet UV。 */
export function applyExplosionFrame(
  material: THREE.MeshBasicMaterial,
  progress: number,
  kind: ExplosionSpriteKind = 'normal',
): void {
  if (typeof document === 'undefined') return;

  if (isExplosionSheetKind(kind)) {
    const sheet = getExplosionSheet(kind);
    const frame = Math.min(
      sheet.frames - 1,
      Math.max(0, Math.floor(progress * sheet.frames)),
    );
    const map = material.map;
    if (map) {
      applySheetFrame(map, sheet, frame);
      material.visible = true;
      return;
    }
    bindExplosionTexture(sheet.url, (shared) => {
      const texture = shared.clone();
      texture.needsUpdate = true;
      applySheetFrame(texture, sheet, frame);
      material.map = texture;
      material.visible = true;
      material.needsUpdate = true;
    });
    return;
  }

  const frame = Math.min(
    getExplosionFrameUrls(kind).length - 1,
    Math.max(0, Math.floor(progress * getExplosionFrameUrls(kind).length)),
  );
  const url = getExplosionFrameUrls(kind)[frame]!;
  bindExplosionTexture(url, (shared) => {
    // 多 PNG 帧不改 UV，直接引用共享贴图，避免每帧 clone/dispose
    if (material.map === shared) return;
    material.map = shared;
    material.visible = true;
    material.needsUpdate = true;
  });
}

/** 横向序列帧：按帧索引设置 UV repeat/offset。 */
function applySheetFrame(
  texture: THREE.Texture,
  sheet: ExplosionSheetDef,
  frameIndex: number,
): void {
  const frame = ((frameIndex % sheet.frames) + sheet.frames) % sheet.frames;
  texture.repeat.set(1 / sheet.frames, 1);
  texture.offset.set(frame / sheet.frames, 0);
}

/** 返回指定爆炸效果应加载的多 PNG 序列帧路径。 */
function getExplosionFrameUrls(kind: ExplosionSpriteKind): readonly string[] {
  return kind === 'giant_bomb' ? GIANT_BOMB_EXPLOSION_FRAME_URLS : EXPLOSION_FRAME_URLS;
}

/** 加载共享母贴图；就绪后回调。 */
function bindExplosionTexture(url: string, onReady: (texture: THREE.Texture) => void): void {
  const cached = textureCache.get(url);
  if (cached && isTextureImageReady(cached)) {
    onReady(cached);
    return;
  }

  let waiters = pendingByUrl.get(url);
  if (!waiters) {
    waiters = [];
    pendingByUrl.set(url, waiters);
  }
  waiters.push(onReady);
  if (cached) return;

  const texture = new THREE.TextureLoader().load(url, (loaded) => {
    configureExplosionTexture(loaded);
    textureCache.set(url, loaded);
    const queued = pendingByUrl.get(url) ?? [];
    pendingByUrl.delete(url);
    for (const cb of queued) cb(loaded);
  });
  configureExplosionTexture(texture);
  textureCache.set(url, texture);
}

function configureExplosionTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
}

function isTextureImageReady(texture: THREE.Texture): boolean {
  const image = texture.image as { width?: number } | undefined;
  return (image?.width ?? 0) > 0;
}
