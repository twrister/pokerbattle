import * as THREE from 'three';
import { GROUND_FX, GroundGlowMark, GroundRingMark } from './groundFxStyle.js';

/** 光点数量：固定且很少，多单位同时振奋时也不会过曝 */
const SPARK_COUNT = 5;
/** 光点上升一轮的时长（秒） */
const SPARK_CYCLE_SEC = 1.4;
/** 进入振奋爆闪时长（秒） */
export const INSPIRE_BURST_SEC = 0.4;

/** 所有光点共用的几何、贴图、材质，按需创建一次。 */
let sharedSparkGeometry: THREE.PlaneGeometry | null = null;
let sharedSparkMaterial: THREE.MeshBasicMaterial | null = null;

/** 生成中心亮、边缘透明的圆形光点贴图；无 DOM 环境（测试）下返回 null。 */
function createSparkTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 懒创建共享光点资源。 */
function getSparkResources(): { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial } {
  sharedSparkGeometry ??= new THREE.PlaneGeometry(1, 1);
  sharedSparkMaterial ??= new THREE.MeshBasicMaterial({
    color: GROUND_FX.inspireSpark,
    map: createSparkTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { geometry: sharedSparkGeometry, material: sharedSparkMaterial };
}

/** 判断对象是否使用共享光点资源，dispose 时需要跳过。 */
export function isSharedSparkMesh(object: THREE.Object3D): boolean {
  return object instanceof THREE.Mesh && object.geometry === sharedSparkGeometry;
}

/**
 * 受益单位身上缓慢上升的金色光点，表达"被鼓舞、动作加快"。
 * 淡入淡出用缩放实现，这样材质可以全局共享；挂点每帧对齐相机，光点始终在屏幕平面内上升。
 */
export class InspireSparks {
  readonly group = new THREE.Group();
  private readonly sparks: THREE.Mesh[] = [];
  private readonly phases: number[] = [];
  private readonly offsetsX: number[] = [];

  /** @param width 单位显示宽度；@param height 单位显示高度（光点上升的行程） */
  constructor(private readonly width: number, private readonly height: number) {
    const { geometry, material } = getSparkResources();
    for (let i = 0; i < SPARK_COUNT; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 5;
      mesh.raycast = () => {};
      this.group.add(mesh);
      this.sparks.push(mesh);
      this.phases.push(i / SPARK_COUNT);
      // 横向均匀散开，再随机抖一点，避免排成一列
      this.offsetsX.push(((i + 0.5) / SPARK_COUNT - 0.5) * width * 0.9 + (Math.random() - 0.5) * width * 0.1);
    }
    this.group.name = 'inspire-sparks';
    this.group.visible = false;
  }

  /** 更新光点位置与大小；t 为 0..1 的生命周期，两端缩到 0 实现淡入淡出。 */
  update(timeSec: number, camera: THREE.Camera): void {
    this.group.quaternion.copy(camera.quaternion);
    for (let i = 0; i < this.sparks.length; i++) {
      const t = (timeSec / SPARK_CYCLE_SEC + this.phases[i]!) % 1;
      const fade = Math.sin(t * Math.PI);
      const size = this.width * 0.12 * fade;
      const spark = this.sparks[i]!;
      spark.position.set(
        this.offsetsX[i]! + Math.sin(timeSec * 3 + i * 1.7) * this.width * 0.06,
        this.height * 0.1 + t * this.height * 0.8,
        0.02,
      );
      spark.scale.set(size, size, 1);
    }
  }
}

/**
 * 进入振奋时的一次性金光扩散环：由内向外扩大并淡出。
 */
export class InspireBurst {
  readonly group = new THREE.Group();
  private readonly ring: GroundRingMark;
  private startedAt = -1;

  constructor(private readonly radius: number) {
    this.ring = new GroundRingMark({
      color: GROUND_FX.inspireSpark,
      thickness: 0.14,
      opacity: 0.95,
      segments: 40,
      outline: false,
    });
    this.ring.group.position.y = 0.05;
    this.group.name = 'inspire-burst';
    this.group.add(this.ring.group);
    this.group.visible = false;
  }

  /** 从当前时刻开始播放一次。 */
  start(timeSec: number): void {
    this.startedAt = timeSec;
    this.group.visible = true;
  }

  /** 播放中推进动画，结束后自动隐藏。 */
  update(timeSec: number): void {
    if (this.startedAt < 0) return;
    const t = (timeSec - this.startedAt) / INSPIRE_BURST_SEC;
    if (t >= 1) {
      this.reset();
      return;
    }
    const eased = 1 - (1 - t) * (1 - t);
    this.ring.setRadius(this.radius * (0.6 + eased * 1.2));
    this.ring.setOpacity(1 - t);
  }

  /** 立即停止并隐藏，对象池复用时调用。 */
  reset(): void {
    this.startedAt = -1;
    this.group.visible = false;
  }

  /** 释放独占资源。 */
  dispose(): void {
    this.ring.dispose();
  }
}

/** 国王范围环虚线段数 */
const DASH_COUNT = 14;
/** 国王范围环旋转速度（圈/秒） */
const AURA_TURNS_PER_SEC = 0.08;
/** 国王范围环带宽占外径比例 */
const AURA_BAND_RATIO = 0.035;

const AURA_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURA_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uDashCount;
uniform float uOpacity;
varying vec2 vPos;
void main() {
  // 角度归一到 0..1 后随时间平移，实现虚线缓慢旋转
  float a = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;
  float dash = fract(a * uDashCount - uTime);
  // 每段前 60% 亮、后 40% 空，边缘做一点羽化
  float on = smoothstep(0.0, 0.08, dash) * (1.0 - smoothstep(0.52, 0.6, dash));
  gl_FragColor = vec4(uColor, on * uOpacity);
  #include <colorspace_fragment>
}
`;

/**
 * 国王脚下的振奋范围环：外缘柔光带 + 缓慢旋转的金色虚线。
 * 半径取真实振奋判定半径，玩家能直接看出哪些单位在加成范围内。
 */
export class KingInspireAura {
  readonly group = new THREE.Group();
  private readonly glow: GroundGlowMark;
  private readonly material: THREE.ShaderMaterial;

  constructor(radius: number) {
    this.glow = new GroundGlowMark({
      color: GROUND_FX.inspireGlow,
      innerRatio: 0.82,
      opacity: 0.2,
      falloff: 2,
      segments: 64,
    });
    this.glow.setRadius(radius);
    this.glow.group.position.y = 0.034;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(GROUND_FX.inspire) },
        uTime: { value: 0 },
        uDashCount: { value: DASH_COUNT },
        uOpacity: { value: 0.85 },
      },
      vertexShader: AURA_VERTEX,
      fragmentShader: AURA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1 - AURA_BAND_RATIO, 1, 96, 1),
      this.material,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(radius);
    ring.position.y = 0.037;
    ring.renderOrder = 1;
    ring.raycast = () => {};

    this.group.name = 'king-inspire-aura';
    this.group.add(this.glow.group, ring);
  }

  /** 推进旋转动画，只写 uniform，不产生临时对象。 */
  update(timeSec: number): void {
    this.material.uniforms.uTime!.value = timeSec * AURA_TURNS_PER_SEC * DASH_COUNT;
  }

  /** 释放独占几何与材质。 */
  dispose(): void {
    this.glow.dispose();
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.material === this.material) {
        mesh.geometry.dispose();
        this.material.dispose();
      }
    }
  }
}
