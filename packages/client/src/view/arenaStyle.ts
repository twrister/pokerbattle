import * as THREE from 'three';

/**
 * 战斗场景卡通风格（Clash Royale 式）共用的配色、材质、描边、贴图与灯光。
 * 场地格子色等可配项仍走 arena 配置 colors，这里只放不需要配置的固定装饰色。
 */
export const ARENA_STYLE = {
  /** 地面侧面：暖赭土色 */
  dirt: 0xc58a5c,
  /** 河岸浅沙色 */
  bank: 0xf4ddb4,
  /** 河面浪花高光 */
  foam: 0xf2fbf8,
  /** 粗描边色（暖深棕，避免纯黑显脏） */
  outline: 0x6a4030,
  /** 桥栏木色（比桥面略深） */
  rail: 0xa5673f,
  /** 场外沙地（比场内略深，衬出战场） */
  outfield: 0xdcb487,
  /** 树冠：低饱和橄榄绿，避免整体过绿 */
  treeLeaf: 0x86a552,
  /** 树干 */
  treeTrunk: 0x9a6640,
  /** 岩石：暖灰偏粉 */
  rock: 0xcdb9a8,
} as const;

/** 黏土质感的柔和 PBR 材质：高粗糙度、零金属度。 */
export function createToonMaterial(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/** 创建背面渲染的描边材质；随场地一起重建、一起 dispose。 */
function createOutlineMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: ARENA_STYLE.outline, side: THREE.BackSide });
}

/** 按包围盒算出让各轴外扩 thickness 的缩放，圆润几何上描边厚度近似一致。 */
function outlineScale(geometry: THREE.BufferGeometry, thickness: number): THREE.Vector3 {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    1 + (2 * thickness) / Math.max(size.x, 1e-3),
    1 + (2 * thickness) / Math.max(size.y, 1e-3),
    1 + (2 * thickness) / Math.max(size.z, 1e-3),
  );
}

/**
 * 反向外壳描边：挂一个背面渲染的放大副本形成粗轮廓。
 * 副本共享几何体，且不参与射线检测与投影，避免影响点击放兵和阴影。
 */
export function addOutline<T extends THREE.Mesh>(mesh: T, thickness = 0.05): T {
  const scale = outlineScale(mesh.geometry, thickness);
  let hull: THREE.Mesh;
  if (mesh instanceof THREE.InstancedMesh) {
    // 子节点处于父级局部空间，逐实例在原矩阵上再叠加放大即可
    const instanced = new THREE.InstancedMesh(mesh.geometry, createOutlineMaterial(), mesh.count);
    const matrix = new THREE.Matrix4();
    const scaleMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      instanced.setMatrixAt(i, matrix.multiply(scaleMatrix));
    }
    instanced.instanceMatrix.needsUpdate = true;
    hull = instanced;
  } else {
    hull = new THREE.Mesh(mesh.geometry, createOutlineMaterial());
    hull.scale.copy(scale);
  }
  hull.raycast = () => {};
  hull.castShadow = false;
  hull.receiveShadow = false;
  mesh.add(hull);
  return mesh;
}

/**
 * 棋盘格草地贴图：一格一个像素，最近邻采样保证格子边缘清晰。
 * rowOffset 用来让两侧半场的格子奇偶与全局格坐标对齐。
 */
export function createCheckerTexture(
  width: number,
  height: number,
  colorA: string,
  colorB: string,
  rowOffset = 0,
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  // 直接按 sRGB 字节写入，贴图标记为 sRGB，避免 Color 线性化后二次转换变暗
  const a = Number.parseInt(colorA.replace('#', ''), 16);
  const b = Number.parseInt(colorB.replace('#', ''), 16);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = (x + y + rowOffset) % 2 === 0 ? a : b;
      const i = (y * width + x) * 4;
      data[i] = (c >> 16) & 0xff;
      data[i + 1] = (c >> 8) & 0xff;
      data[i + 2] = c & 0xff;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 卡通场景统一灯光：明亮天空半球光 + 暖白主光（可选软阴影）。返回主光便于调阴影范围。 */
export function addArenaLights(scene: THREE.Scene, castShadow = true): THREE.DirectionalLight {
  // 暖天光 + 偏紫地面反光，阴影里带一点薰衣草色，整体亮度比之前收一档
  scene.add(new THREE.HemisphereLight(0xfff0dc, 0xb39aa6, 1.0));
  const sun = new THREE.DirectionalLight(0xffe0b8, 1.5);
  sun.position.set(12, 30, 16);
  if (castShadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  return sun;
}

/** 渲染器卡通化设置：软阴影 + sRGB 输出，不开色调映射以免精灵变色。 */
export function applyArenaRendererStyle(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/** 固定种子的伪随机数（mulberry32），保证场外装饰每次重建位置一致。 */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
