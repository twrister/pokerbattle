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

export type ExplosionSpriteKind = 'normal' | 'giant_bomb';

export const EXPLOSION_FRAME_COUNT = EXPLOSION_FRAME_URLS.length;
/** 单帧像素尺寸，用于面片宽高比 */
export const EXPLOSION_FRAME_WIDTH = 217;
export const EXPLOSION_FRAME_HEIGHT = 204;

const textureCache = new Map<string, THREE.Texture>();
const pendingByUrl = new Map<string, Array<(texture: THREE.Texture) => void>>();

let sharedGeometry: THREE.PlaneGeometry | null = null;

/** 共享爆炸面片几何（中心锚点，爆炸中心落在地面）。 */
export function getExplosionGeometry(): THREE.PlaneGeometry {
  if (sharedGeometry) return sharedGeometry;
  // 默认中心在原点：公告板立起后爆炸中心对齐地面，上下各一半
  const aspect = EXPLOSION_FRAME_WIDTH / EXPLOSION_FRAME_HEIGHT;
  sharedGeometry = new THREE.PlaneGeometry(aspect, 1);
  return sharedGeometry;
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

/** 按进度（0..1）切换到对应序列帧贴图。 */
export function applyExplosionFrame(
  material: THREE.MeshBasicMaterial,
  progress: number,
  kind: ExplosionSpriteKind = 'normal',
): void {
  if (typeof document === 'undefined') return;
  const frame = Math.min(
    getExplosionFrameUrls(kind).length - 1,
    Math.max(0, Math.floor(progress * getExplosionFrameUrls(kind).length)),
  );
  const url = getExplosionFrameUrls(kind)[frame]!;
  bindExplosionTexture(url, (shared) => {
    const prev = material.map;
    if (prev && prev.image === shared.image) return;
    const texture = shared.clone();
    texture.needsUpdate = true;
    material.map = texture;
    material.visible = true;
    material.needsUpdate = true;
    prev?.dispose();
  });
}

/** 返回指定爆炸效果应加载的序列帧路径。 */
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
