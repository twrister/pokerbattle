import * as THREE from 'three';
import { Faction, type UnitTypeId } from '@pb/sim';

/**
 * 单位精灵资源。参考图是白底像素风立绘，这里在加载时把白色背景抠成透明，
 * 生成的贴图与材质按兵种共享——几百个单位也只占每类一份 GPU 资源。
 */

export interface SpriteDef {
  /** 面向相机与背向相机时使用的透明贴图（默认/蓝方） */
  frontUrl: string;
  backUrl: string;
  /** 红方正背面贴图；缺省则与蓝方共用 */
  frontUrlRed?: string;
  backUrlRed?: string;
  /** 精灵可视高度 = 民兵基准半径 × 体型 × 此值（图片四周有留白，倍率略大于圆柱时代的 2.6） */
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
  melee_guard: {
    frontUrl: 'units/guard-front.png',
    backUrl: 'units/guard-back.png',
    heightMul: 3.2,
    aspect: 175 / 214,
    sourceFacing: -1,
  },
  melee_golem: {
    frontUrl: 'units/golem-front.png',
    backUrl: 'units/golem-back.png',
    // 石头人体型偏宽，倍率略高于卫士以压住碰撞圈
    heightMul: 3.4,
    aspect: 241 / 218,
    sourceFacing: 1,
  },
  ranged_archer: {
    frontUrl: 'units/archer-front.png',
    backUrl: 'units/archer-back.png',
    heightMul: 3.8,
    aspect: 188 / 229,
    sourceFacing: -1,
  },
  ranged_ballista: {
    frontUrl: 'units/ballista-front.png',
    backUrl: 'units/ballista-back.png',
    // 正面朝右下、背面朝右上；倍率对齐战车。宽高比取正面贴图，避免图鉴缩略被压扁。
    heightMul: 4.0,
    aspect: 269 / 246,
    sourceFacing: 1,
  },
  ranged_chariot: {
    frontUrl: 'units/chariot-front.png',
    backUrl: 'units/chariot-back.png',
    // 战车立绘偏宽，倍率略低于骑士以免视觉上过大
    heightMul: 4.0,
    aspect: 899 / 825,
    sourceFacing: 1,
  },
  melee_charge_wagon: {
    frontUrl: 'units/charge-wagon-front.png',
    backUrl: 'units/charge-wagon-back.png',
    // 木车立绘偏宽，倍率对齐战车/连弩车；宽高比取正面贴图
    heightMul: 4.0,
    aspect: 248 / 236,
    sourceFacing: 1,
  },
  giant_bomb: {
    frontUrl: 'projectiles/bomb.png',
    backUrl: 'projectiles/bomb.png',
    heightMul: 2.8,
    aspect: 138 / 215,
    sourceFacing: 1,
  },
  small_bomb: {
    frontUrl: 'projectiles/bomb.png',
    backUrl: 'projectiles/bomb.png',
    // 图鉴缩略比巨型炸弹更小，体现体量差异
    heightMul: 1.6,
    aspect: 138 / 215,
    sourceFacing: 1,
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
  summoned_bomber: {
    frontUrl: 'units/bomber-front.png',
    backUrl: 'units/bomber-back.png',
    heightMul: 3.8,
    aspect: 92 / 209,
    sourceFacing: 1,
  },
  // 建筑正背同图，无朝向切换；尺寸由 unitView 按 footprint 铺满，底边对齐画面近端格边
  building_base: {
    frontUrl: 'buildings/base.png',
    backUrl: 'buildings/base.png',
    frontUrlRed: 'buildings/base_red.png',
    backUrlRed: 'buildings/base_red.png',
    heightMul: 1,
    // 与 buildings/base.png / base_red.png 像素尺寸一致，避免按旧图宽高比拉伸
    aspect: 235 / 291,
    sourceFacing: 1,
  },
  building_tower: {
    frontUrl: 'buildings/tower.png',
    backUrl: 'buildings/tower.png',
    frontUrlRed: 'buildings/tower_red.png',
    backUrlRed: 'buildings/tower_red.png',
    heightMul: 1,
    aspect: 177 / 222,
    sourceFacing: 1,
  },
  // 高级箭塔暂复用普通塔贴图；塔顶双弓手由 unitView garrison 表现
  building_tower_advanced: {
    frontUrl: 'buildings/tower.png',
    backUrl: 'buildings/tower.png',
    frontUrlRed: 'buildings/tower_red.png',
    backUrlRed: 'buildings/tower_red.png',
    heightMul: 1,
    aspect: 177 / 222,
    sourceFacing: 1,
  },
  // 三射手箭塔同样复用塔体贴图；三人立绘由 garrison 排布
  building_tower_triple: {
    frontUrl: 'buildings/tower.png',
    backUrl: 'buildings/tower.png',
    frontUrlRed: 'buildings/tower_red.png',
    backUrlRed: 'buildings/tower_red.png',
    heightMul: 1,
    aspect: 177 / 222,
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

const materialCache = new Map<string, SpriteMaterials>();
const textureCache = new Map<string, THREE.Texture>();
/** 已加载完成的贴图 URL；同一张图被多个兵种引用时不必重复等待 */
const loadedTextureUrls = new Set<string>();
/** 贴图未就绪前创建的材质，加载完成后统一转为可见 */
const pendingMaterials = new Map<string, THREE.MeshBasicMaterial[]>();
const textureLoadListeners = new Set<() => void>();

/**
 * 订阅「有贴图加载完成」。
 * 只画一帧的静态视图（如搭配对比定格帧）必须借此补一次重绘，
 * 否则贴图晚于那一次 render 到达，立绘会永远停在隐藏状态。
 * 返回取消订阅的函数。
 */
export function onSpriteTextureLoaded(listener: () => void): () => void {
  textureLoadListeners.add(listener);
  return () => {
    textureLoadListeners.delete(listener);
  };
}

/** 按阵营解析正背面贴图 URL；无红方专属图时回退蓝方。 */
function resolveSpriteUrls(
  def: SpriteDef,
  faction: Faction,
): { frontUrl: string; backUrl: string } {
  if (faction === Faction.Red && def.frontUrlRed) {
    return {
      frontUrl: def.frontUrlRed,
      backUrl: def.backUrlRed ?? def.frontUrlRed,
    };
  }
  return { frontUrl: def.frontUrl, backUrl: def.backUrl };
}

/** 材质缓存键：有红方专属贴图时按阵营拆分，否则蓝红共用一份。 */
function spriteMaterialCacheKey(typeId: UnitTypeId, faction: Faction): string {
  const def = SPRITE_DEFS[typeId];
  if (def?.frontUrlRed && faction === Faction.Red) return `${typeId}:red`;
  return `${typeId}:blue`;
}

/**
 * 取某兵种正面/背面的共享材质；无立绘的兵种返回 null。
 * 建筑可按阵营换皮；普通单位蓝红共用同一套立绘。
 */
export function getSpriteMaterials(
  typeId: UnitTypeId,
  faction: Faction = Faction.Blue,
): SpriteMaterials | null {
  const def = SPRITE_DEFS[typeId];
  if (!def) return null;

  const cacheKey = spriteMaterialCacheKey(typeId, faction);
  let materials = materialCache.get(cacheKey);
  if (materials) return materials;

  const urls = resolveSpriteUrls(def, faction);
  materials = {
    front: createSpriteMaterial(urls.frontUrl),
    back: createSpriteMaterial(urls.backUrl),
  };
  materialCache.set(cacheKey, materials);
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
      markTextureLoaded(url);
    });
    textureCache.set(url, texture);
  }
  material.map = texture;

  if (loadedTextureUrls.has(url)) {
    material.visible = true;
  } else {
    // 同一 URL 可能被多个兵种（如三种箭塔）各建一份材质，都要等这张图
    const waiting = pendingMaterials.get(url);
    if (waiting) waiting.push(material);
    else pendingMaterials.set(url, [material]);
  }
  return material;
}

/** 贴图就绪：把等这张图的材质全部转可见，并通知静态视图重绘。 */
function markTextureLoaded(url: string): void {
  loadedTextureUrls.add(url);
  for (const material of pendingMaterials.get(url) ?? []) {
    material.visible = true;
    material.needsUpdate = true;
  }
  pendingMaterials.delete(url);
  for (const listener of textureLoadListeners) listener();
}
