import * as THREE from 'three';

/**
 * 地面提示统一配色。
 * 场地改成浅沙色卡通风（ground ≈ #ecca98）后，原来给深色地板调的暖黄/橙色提示
 * 与地面色相、明度都太接近，混在一起分不清。这里统一换成高饱和、色相拉开的颜色，
 * 所有地面圈都从这里取色，将来场景再改色只动这一处。
 */
export const GROUND_FX = {
  /** 垫在所有彩色环下面的深棕描边：亮底上负责把边界「压」出来 */
  outline: 0x3a1f14,
  /** 爆炸落点 / 出牌预瞄的警戒红（比沙地红得多，一眼能认出是危险区） */
  warnFill: 0xff2d2d,
  /** 地面燃烧：更深的橙红，与预警红区分开 */
  hazardFill: 0xe0300f,
  hazardLine: 0xff5a1e,
  /** 普攻伤害范围脉冲外环 */
  pulseRing: 0xff3b30,
  /** 冲刺前方扇形：用品红与圆形脉冲区分 */
  pulseFan: 0xd81b60,
  /** 单位脚下的阵营圈：饱和蓝/红，不再跟兵种肤色走，红蓝双方都压得住沙地 */
  factionBlue: 0x1e6bff,
  factionRed: 0xe02424,
  /** 国王振奋光环：金色细线，与沙地拉开明度 */
  inspire: 0xffb703,
  /** 振奋光点与爆闪环：亮白金，靠明度在沙地上突出 */
  inspireSpark: 0xfff1a8,
  /** 振奋柔光晕：更暗一点的金，垫在细线内侧做体积感 */
  inspireGlow: 0xffa726,
  /** 治疗脚底光 */
  heal: 0x18c964,
  /** 治疗十字高光：亮白绿，靠明度而不是靠色相取胜 */
  healCross: 0xe8fff2,
  /** 施法法阵：青蓝渐隐柔光，比原来的紫色实心圆盘更通透，不会盖住单位贴图 */
  castGround: 0x36d6ff,
  /** 选中单位 / 放置预览的攻击范围圈 */
  range: 0xffffff,
} as const;

/** 环宽占外径的默认比例：0.1 相当于直径 10% 的粗线，远景也能看清 */
const DEFAULT_THICKNESS = 0.1;
/**
 * 描边环宽度占外径的比例。
 * 描边整圈画在主环内侧，外缘与主环完全重合——范围圈的外径必须等于真实半径，
 * 往外扩哪怕 10% 也会让玩家误判爆炸边界。
 */
const OUTLINE_WIDTH_RATIO = 0.1;
/** 描边透明度占主环的比例；太实会把彩色环压成一圈黑框 */
const OUTLINE_OPACITY_RATIO = 0.5;

export interface GroundRingOptions {
  color: number;
  /** 环宽占外径比例，默认 0.1；越小越像细描边 */
  thickness?: number;
  /**
   * 环宽的绝对世界宽度。设置后忽略 thickness，setRadius 时按半径换算比例，
   * 保证不同半径的圈线粗细一致（如各兵种攻击范围圈）。
   */
  width?: number;
  /** 主环满透明度，默认 0.95 */
  opacity?: number;
  segments?: number;
  /** 是否在下面垫深色描边环，默认 true */
  outline?: boolean;
  /** 弧形起止角（弧度）；冲刺扇形等半圆弧靠这两个值裁出来，默认整圆 */
  thetaStart?: number;
  thetaLength?: number;
}

/**
 * 平躺在地面的圆环提示：按单位半径建模，用 setRadius 缩放到目标半径。
 *
 * WebGL 的 LineLoop 恒为 1px，在浅沙地面上基本不可见，所以这里改成有宽度的环面；
 * 同时在环带内侧叠一圈深色描边，让圈在沙地、河面、桥面等不同底色上都能分辨。
 * 外径始终等于传入半径——提示圈就是玩家的判定依据，不能画大画小。
 */
export class GroundRingMark {
  readonly group = new THREE.Group();

  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly outlineMat: THREE.MeshBasicMaterial | null;
  private readonly ring: THREE.Mesh;
  private readonly outline: THREE.Mesh | null;
  /** 构造时给的主环透明度，作为 setOpacity(1) 的基准 */
  private readonly baseOpacity: number;
  private readonly segments: number;
  private readonly thetaStart: number;
  private readonly thetaLength: number;
  /** 绝对环宽（世界单位）；null 表示按比例画 */
  private readonly width: number | null;
  /** 当前几何使用的环宽比例，避免每帧重建 */
  private builtRatio: number;
  /** 描边宽度比例：比例模式为固定值，绝对宽度模式与主环等宽 */
  private builtOutlineRatio: number;

  constructor(options: GroundRingOptions) {
    const thickness = THREE.MathUtils.clamp(options.thickness ?? DEFAULT_THICKNESS, 0.01, 0.9);
    this.segments = options.segments ?? 48;
    this.thetaStart = options.thetaStart ?? 0;
    this.thetaLength = options.thetaLength ?? Math.PI * 2;
    this.width = options.width != null && options.width > 0 ? options.width : null;
    this.builtRatio = thickness;
    this.builtOutlineRatio = OUTLINE_WIDTH_RATIO;
    this.baseOpacity = THREE.MathUtils.clamp(options.opacity ?? 0.95, 0, 1);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: options.color,
      transparent: true,
      opacity: this.baseOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(this.createRing(1 - thickness, 1), this.ringMat);
    this.ring.name = 'ground-ring';
    this.ring.rotation.x = -Math.PI / 2;
    // 与描边同层共面，靠 renderOrder 明确「先描边、后主环」，避免透明队列按距离排序时穿插
    this.ring.renderOrder = 1;
    this.ring.raycast = () => {};

    if (options.outline !== false) {
      this.outlineMat = new THREE.MeshBasicMaterial({
        color: GROUND_FX.outline,
        transparent: true,
        opacity: this.baseOpacity * OUTLINE_OPACITY_RATIO,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.outline = new THREE.Mesh(this.createOutlineRing(), this.outlineMat);
      this.outline.name = 'ground-ring-outline';
      this.outline.rotation.x = -Math.PI / 2;
      // 与主环共面：靠 renderOrder 先画描边，主环叠在上面才不会被压暗
      this.outline.renderOrder = 0;
      this.outline.raycast = () => {};
      this.group.add(this.outline);
    } else {
      this.outlineMat = null;
      this.outline = null;
    }

    this.group.name = 'ground-ring-mark';
    this.group.add(this.ring);
  }

  /**
   * 缩放到目标半径。比例模式下环宽随半径等比；
   * 绝对宽度模式下按半径换算比例并在必要时重建几何，世界环宽保持不变。
   */
  setRadius(radius: number): void {
    const size = Math.max(0.001, radius);
    if (this.width !== null) {
      const ratio = THREE.MathUtils.clamp(this.width / size, 0.001, 0.9);
      if (Math.abs(ratio - this.builtRatio) > 1e-4) this.rebuild(ratio);
    }
    this.group.scale.setScalar(size);
  }

  /** 按当前分段与弧度创建单位半径下的环几何。 */
  private createRing(inner: number, outer: number): THREE.RingGeometry {
    return new THREE.RingGeometry(inner, outer, this.segments, 1, this.thetaStart, this.thetaLength);
  }

  /** 描边贴在主环内缘再向内延伸，外缘与主环重合，圈的外径仍是真实半径。 */
  private createOutlineRing(): THREE.RingGeometry {
    const outer = 1 - this.builtRatio;
    const inner = Math.max(0.01, outer - this.builtOutlineRatio);
    return this.createRing(inner, outer);
  }

  /** 绝对宽度模式：换成新比例的主环与描边几何。 */
  private rebuild(ratio: number): void {
    this.builtRatio = ratio;
    this.builtOutlineRatio = ratio;
    this.ring.geometry.dispose();
    this.ring.geometry = this.createRing(1 - ratio, 1);
    if (this.outline) {
      this.outline.geometry.dispose();
      this.outline.geometry = this.createOutlineRing();
    }
  }

  /** 统一设置两层透明度（0..1）；描边按固定比例跟随，淡出时不会只剩一圈黑边。 */
  setOpacity(alpha: number): void {
    const value = THREE.MathUtils.clamp(alpha, 0, 1);
    this.ringMat.opacity = this.baseOpacity * value;
    if (this.outlineMat) {
      this.outlineMat.opacity = this.baseOpacity * OUTLINE_OPACITY_RATIO * value;
    }
  }

  /** 释放本标记独占的几何与材质；对象池复用时不要调用。 */
  dispose(): void {
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}

/**
 * 柔光晕着色器。
 * 顶点只把本地半径（0=圆心，1=外缘）传给片元，片元再按半径算出透明度：
 * 外缘最亮、向内平滑衰减，形成没有硬边的「光晕」，比一圈实心圆盘通透得多。
 */
const GLOW_VERTEX_SHADER = /* glsl */ `
varying float vRadius;
void main() {
  vRadius = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uInner;
uniform float uFalloff;
uniform float uOpacity;
varying float vRadius;
void main() {
  // 把几何内缘映射成 0、外缘映射成 1，这样同一套着色器能画整圆也能画外圈灯带
  float t = clamp((vRadius - uInner) / max(1.0 - uInner, 0.001), 0.0, 1.0);
  gl_FragColor = vec4(uColor, pow(t, uFalloff) * uOpacity);
  #include <colorspace_fragment>
}
`;

export interface GroundGlowOptions {
  color: number;
  /** 内缘起点占外径比例，默认 0.05（近似整圆）；调大只保留外侧一段光带 */
  innerRatio?: number;
  /** 外缘满透明度，默认 0.5 */
  opacity?: number;
  /** 由内向外增亮的曲线指数，越大光越贴外缘，默认 1.8 */
  falloff?: number;
  segments?: number;
}

/**
 * 平躺在地面的柔光晕：中心淡、外缘亮，用来代替「实心圆盘 + 粗描边」的旧底盘。
 *
 * 圆盘式底盘会整片压暗地面，叠在浅沙色卡通场上像贴了一张紫色纸；
 * 光晕只在外缘聚色，既能圈出范围，又不遮挡脚下的单位与贴图。
 * 与 GroundRingMark 一样按单位半径建模，用 setRadius 缩放，外径始终等于传入半径。
 */
export class GroundGlowMark {
  readonly group = new THREE.Group();

  private readonly material: THREE.ShaderMaterial;
  /** 构造时给的满透明度，作为 setOpacity(1) 的基准 */
  private readonly baseOpacity: number;

  constructor(options: GroundGlowOptions) {
    const inner = THREE.MathUtils.clamp(options.innerRatio ?? 0.05, 0, 0.98);
    this.baseOpacity = THREE.MathUtils.clamp(options.opacity ?? 0.5, 0, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        // THREE.Color 会把 sRGB 输入转成线性工作空间，配合 colorspace_fragment 才是正确色
        uColor: { value: new THREE.Color(options.color) },
        uInner: { value: inner },
        uFalloff: { value: options.falloff ?? 1.8 },
        uOpacity: { value: this.baseOpacity },
      },
      vertexShader: GLOW_VERTEX_SHADER,
      fragmentShader: GLOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(inner, 1, options.segments ?? 48, 1),
      this.material,
    );
    mesh.name = 'ground-glow';
    mesh.rotation.x = -Math.PI / 2;
    // 光晕垫在亮环下面：先画光，细环叠上去边界才清楚
    mesh.renderOrder = 0;
    mesh.raycast = () => {};

    this.group.name = 'ground-glow-mark';
    this.group.add(mesh);
  }

  /** 缩放到目标半径 */
  setRadius(radius: number): void {
    this.group.scale.setScalar(Math.max(0.001, radius));
  }

  /** 设置整体透明度（0..1），按构造时的基准等比缩 */
  setOpacity(alpha: number): void {
    const value = THREE.MathUtils.clamp(alpha, 0, 1);
    this.material.uniforms.uOpacity!.value = this.baseOpacity * value;
  }

  /** 释放本标记独占的几何与材质；对象池复用时不要调用。 */
  dispose(): void {
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
