import * as THREE from 'three';
import type { GroundHazardSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';
import { GROUND_FX } from './groundFxStyle.js';

const SEGMENTS = 48;
/** 生成与消失时的淡入 / 淡出占总时长比例，避免燃烧区「啪」地出现或消失 */
const FADE_IN = 0.08;
const FADE_OUT = 0.18;

const BURN_VERTEX_SHADER = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 地面灼烧着色器：
 * - 底层是焦黑的烧痕，越靠中心越深，让人一眼看出「这块地被烧了」；
 * - 中层是随时间翻滚的火焰噪声（fbm），红 → 橙 → 黄按热度渐变；
 * - 顶层是零星闪烁的火星；外缘不画任何边界圈，只靠渐隐自然融进地面。
 * 噪声坐标按真实半径放大，大圈小圈的火苗密度保持一致。
 */
const BURN_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uSeed;
uniform float uOpacity;
uniform vec3 uScorch;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHot;
varying vec2 vLocal;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  float r = length(vLocal);
  vec2 p = vLocal * uRadius + vec2(uSeed);
  float t = uTime;

  // 两层反向流动的噪声叠加，火焰看起来在原地翻腾而不是整体平移
  float flow = fbm(p * 1.6 + vec2(t * 0.35, -t * 0.55));
  float lick = fbm(p * 3.2 - vec2(t * 0.6, t * 0.25) + flow * 1.5);
  float heat = flow * 0.55 + lick * 0.65;
  // 中心更旺、边缘略弱，但边缘仍保留火苗，范围感不丢
  heat *= 1.05 - r * 0.35;
  heat += 0.06 * sin(t * 9.0 + uSeed);

  float fire = smoothstep(0.42, 0.78, heat);
  vec3 fireColor = mix(uDeep, uMid, smoothstep(0.42, 0.62, heat));
  fireColor = mix(fireColor, uHot, smoothstep(0.62, 0.85, heat));

  // 火星：高频格子噪声 + 各自相位闪烁，只取最亮的少数点
  vec2 cell = floor(p * 7.0);
  float spark = step(0.93, hash(cell + uSeed));
  spark *= 0.5 + 0.5 * sin(t * 12.0 + hash(cell) * 40.0);
  spark *= smoothstep(0.12, 0.0, length(fract(p * 7.0) - 0.5) - 0.12);

  float scorchAlpha = 0.5 * (1.0 - smoothstep(0.75, 1.0, r)) + 0.12;
  vec3 color = mix(uScorch, fireColor, fire);
  color = mix(color, uHot, spark);
  float alpha = max(scorchAlpha, fire * 0.9);
  alpha = max(alpha, spark);
  // 没有边环后靠更宽的边缘淡出消隐，避免出现一圈硬切的圆形边界
  alpha *= 1.0 - smoothstep(0.86, 1.0, r);

  gl_FragColor = vec4(color, alpha * uOpacity);
  #include <colorspace_fragment>
}
`;

/**
 * 地面燃烧区：着色器绘制的焦土 + 翻滚火焰 + 火星，不带边界环，边缘渐隐。
 * 动画用墙钟时间驱动（模拟 tick 较粗，靠 progress 驱动会一跳一跳）。
 * 由 BattleView 对象池复用，不持有任何模拟状态。
 */
export class GroundHazardView {
  readonly group = new THREE.Group();

  private readonly burnMat: THREE.ShaderMaterial;
  private readonly burn: THREE.Mesh;

  constructor() {
    this.burnMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: 1 },
        uSeed: { value: 0 },
        uOpacity: { value: 1 },
        uScorch: { value: new THREE.Color(0x2a140c) },
        uDeep: { value: new THREE.Color(GROUND_FX.hazardFill) },
        uMid: { value: new THREE.Color(GROUND_FX.hazardLine) },
        uHot: { value: new THREE.Color(0xffd54a) },
      },
      vertexShader: BURN_VERTEX_SHADER,
      fragmentShader: BURN_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.burn = new THREE.Mesh(new THREE.CircleGeometry(1, SEGMENTS), this.burnMat);
    this.burn.name = 'ground-hazard-burn';
    this.burn.rotation.x = -Math.PI / 2;
    this.burn.position.y = 0.04;
    this.burn.raycast = () => {};

    this.group.name = 'ground-hazard';
    this.group.add(this.burn);
  }

  /** 放到燃烧落点并按半径缩放；progress 控制淡入淡出，墙钟时间驱动火焰翻滚。 */
  update(hazard: GroundHazardSnapshot): void {
    this.group.position.set(toSceneX(hazard.x), 0, toSceneZ(hazard.y));
    const radius = Math.max(0.01, hazard.radius);
    this.burn.scale.setScalar(radius);

    const life = hazardLifeAlpha(hazard.progress);
    const uniforms = this.burnMat.uniforms;
    uniforms.uTime!.value = performance.now() / 1000;
    uniforms.uRadius!.value = radius;
    // 按 id 错开噪声图案，相邻两片火不会长得一模一样
    uniforms.uSeed!.value = (hazard.id * 17.31) % 100;
    uniforms.uOpacity!.value = life;
  }
}

/** 燃烧区生命周期透明度：开头快速燃起，结尾逐渐熄灭（0..1）。 */
export function hazardLifeAlpha(progress: number): number {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const fadeIn = THREE.MathUtils.smoothstep(p, 0, FADE_IN);
  const fadeOut = 1 - THREE.MathUtils.smoothstep(p, 1 - FADE_OUT, 1);
  return Math.min(fadeIn, fadeOut);
}
