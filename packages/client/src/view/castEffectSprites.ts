import * as THREE from 'three';

/**
 * PixelEffects Teleport 序列帧。黑底 + Additive 混合，叠在单位身上当施法特效。
 * 三层并行播放：蓝光收束 / 橙环爆发 / 白火花柱。
 */

export interface CastSheetDef {
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** 相对单位体型高度的面片高度倍率 */
  heightMul: number;
}

export const CAST_SHEETS: readonly CastSheetDef[] = [
  { url: 'effects/Teleport0.png', frameWidth: 48, frameHeight: 48, frames: 7, heightMul: 2.4 },
  { url: 'effects/Teleport1.png', frameWidth: 48, frameHeight: 48, frames: 12, heightMul: 2.8 },
  { url: 'effects/Teleport2.png', frameWidth: 16, frameHeight: 48, frames: 9, heightMul: 2.6 },
];

/** 与原素材 AnimationClip 采样率一致 */
export const CAST_FRAME_RATE = 16;

const geometryCache = new Map<string, THREE.PlaneGeometry>();
const textureCache = new Map<string, THREE.Texture>();
const pendingByUrl = new Map<string, Array<(texture: THREE.Texture) => void>>();

/** 取某层序列帧的共享几何体（宽高比按单帧像素定）。 */
export function getCastSheetGeometry(def: CastSheetDef): THREE.PlaneGeometry {
  const key = `${def.frameWidth}x${def.frameHeight}`;
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  // 底边贴地，和单位精灵一样以脚底为锚点
  geometry = new THREE.PlaneGeometry(def.frameWidth / def.frameHeight, 1).translate(0, 0.5, 0);
  geometryCache.set(key, geometry);
  return geometry;
}

/**
 * 为单次施法视图创建独立材质（各自持有贴图克隆，才能独立滚 UV）。
 * Node 测试无 DOM 时返回不可见图层，避免 ImageLoader。
 */
export function createCastSheetMaterial(def: CastSheetDef): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    visible: false,
  });

  if (typeof document === 'undefined') return material;

  bindCastTexture(def, (shared) => {
    const texture = shared.clone();
    texture.needsUpdate = true;
    applyCastFrame(texture, def, 0);
    material.map = texture;
    material.visible = true;
    material.needsUpdate = true;
  });

  return material;
}

/** 按帧索引设置横向序列帧 UV。 */
export function applyCastFrame(
  texture: THREE.Texture,
  def: CastSheetDef,
  frameIndex: number,
): void {
  const frame = ((frameIndex % def.frames) + def.frames) % def.frames;
  texture.repeat.set(1 / def.frames, 1);
  texture.offset.set(frame / def.frames, 0);
}

/** 加载共享母贴图；就绪后回调，保证克隆体带上真实 image。 */
function bindCastTexture(def: CastSheetDef, onReady: (texture: THREE.Texture) => void): void {
  const cached = textureCache.get(def.url);
  if (cached && isTextureImageReady(cached)) {
    onReady(cached);
    return;
  }

  let waiters = pendingByUrl.get(def.url);
  if (!waiters) {
    waiters = [];
    pendingByUrl.set(def.url, waiters);
  }
  waiters.push(onReady);
  if (cached) return;

  const texture = new THREE.TextureLoader().load(def.url, (loaded) => {
    configureCastTexture(loaded);
    textureCache.set(def.url, loaded);
    const queued = pendingByUrl.get(def.url) ?? [];
    pendingByUrl.delete(def.url);
    for (const cb of queued) cb(loaded);
  });
  configureCastTexture(texture);
  textureCache.set(def.url, texture);
}

function configureCastTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
}

/** 母贴图是否已解码出可克隆的像素尺寸。 */
function isTextureImageReady(texture: THREE.Texture): boolean {
  const image = texture.image as { width?: number } | undefined;
  return (image?.width ?? 0) > 0;
}
