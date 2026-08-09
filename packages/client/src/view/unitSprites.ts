import * as THREE from 'three';
import type { UnitTypeId } from '@pb/sim';

/**
 * 单位精灵资源。参考图是白底像素风立绘，这里在加载时把白色背景抠成透明，
 * 生成的贴图与材质按兵种共享——几百个单位也只占每类一份 GPU 资源。
 */

export interface SpriteDef {
  /** 面向相机与背向相机时使用的透明贴图 */
  frontUrl: string;
  backUrl: string;
  /** 精灵可视高度 = 铁卫基准半径 × 体型 × 此值（图片四周有留白，倍率略大于圆柱时代的 2.6） */
  heightMul: number;
  /** 图片宽高比，避免非正方形素材被横向拉伸 */
  aspect: number;
  /** 原始素材朝屏幕左侧为 -1、右侧为 1，另一侧通过水平镜像获得 */
  sourceFacing: -1 | 1;
}

/** 有立绘的兵种；正背面按朝向相机切换，左右靠镜像补全。 */
export const SPRITE_DEFS: Partial<Record<UnitTypeId, SpriteDef>> = {
  melee_grunt: {
    frontUrl: 'units/warrior-front.png',
    backUrl: 'units/warrior-back.png',
    heightMul: 3.2,
    aspect: 148 / 196,
    sourceFacing: 1,
  },
  ranged_archer: {
    frontUrl: 'units/archer-front.png',
    backUrl: 'units/archer-back.png',
    heightMul: 3.8,
    aspect: 188 / 229,
    sourceFacing: -1,
  },
  melee_cavalry: {
    frontUrl: 'units/knight-front.png',
    backUrl: 'units/knight-back.png',
    // 骑马立绘比步兵高，倍率略大才能压住碰撞圈视觉尺度
    heightMul: 4.4,
    aspect: 199 / 234,
    sourceFacing: 1,
  },
  hero_king: {
    frontUrl: 'units/king-front.png',
    backUrl: 'units/king-back.png',
    heightMul: 3.5,
    aspect: 197 / 200,
    sourceFacing: 1,
  },
  hero_queen: {
    frontUrl: 'units/queen-front.png',
    backUrl: 'units/queen-back.png',
    heightMul: 4.1,
    aspect: 171 / 179,
    sourceFacing: -1,
  },
  hero_mage: {
    frontUrl: 'units/mage-front.png',
    backUrl: 'units/mage-back.png',
    heightMul: 4.1,
    aspect: 181 / 203,
    sourceFacing: 1,
  },
  hero_archmage: {
    frontUrl: 'units/archmage-front.png',
    backUrl: 'units/archmage-back.png',
    heightMul: 4.1,
    aspect: 172 / 202,
    sourceFacing: 1,
  },
  dragon: {
    frontUrl: 'units/dragon-front.png',
    backUrl: 'units/dragon-back.png',
    heightMul: 4.1,
    aspect: 285 / 197,
    sourceFacing: 1,
  },
  summoned_skeleton: {
    frontUrl: 'units/skeleton-front.png',
    backUrl: 'units/skeleton-back.png',
    heightMul: 3.8,
    aspect: 164 / 203,
    sourceFacing: 1,
  },
};

/** 所有精灵共用的面片：单位尺寸、底边锚定在 y=0（脚踩地面），靠 scale 放大 */
export const SPRITE_GEOMETRY = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

/** 脚下软阴影共用资源。公告板精灵不投实时阴影（形状会很怪），用一个黑色圆片压住地面。 */
export const BLOB_SHADOW_GEOMETRY = new THREE.CircleGeometry(1, 20);
export const BLOB_SHADOW_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});

export interface SpriteMaterials {
  front: THREE.MeshBasicMaterial;
  back: THREE.MeshBasicMaterial;
}

const materialCache = new Map<UnitTypeId, SpriteMaterials>();
const textureCache = new Map<string, THREE.Texture>();

/**
 * 取某兵种正面/背面的共享材质；无立绘的兵种返回 null。
 * 新素材自带透明通道，直接加载即可，不再进行白底抠图。
 */
export function getSpriteMaterials(typeId: UnitTypeId): SpriteMaterials | null {
  const def = SPRITE_DEFS[typeId];
  if (!def) return null;

  let materials = materialCache.get(typeId);
  if (materials) return materials;

  materials = {
    front: createSpriteMaterial(def.frontUrl),
    back: createSpriteMaterial(def.backUrl),
  };
  materialCache.set(typeId, materials);
  return materials;
}

/** 创建原色共享材质，透明素材加载完成前保持隐藏，避免出现纯色方片 */
function createSpriteMaterial(url: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    visible: false,
  });

  // Node 测试没有 DOM，不能创建 ImageLoader；视图同步测试只需场景对象存在。
  if (typeof document === 'undefined') return material;

  let texture = textureCache.get(url);
  if (!texture) {
    texture = new THREE.TextureLoader().load(url, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.magFilter = THREE.NearestFilter;
      material.visible = true;
      material.needsUpdate = true;
    });
    textureCache.set(url, texture);
  } else {
    material.visible = true;
  }
  material.map = texture;
  return material;
}
