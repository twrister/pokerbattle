import * as THREE from 'three';
import { Faction } from '@pb/sim';

/** 拖尾采样上限：约半秒以上轨迹，拉长后抛物线弧更完整。 */
const TRAIL_MAX_POINTS = 36;
/** 相邻采样最小间距平方；暂停或同帧重复渲染时不堆叠重复点。 */
const TRAIL_MIN_SPACING_SQ = 0.06 * 0.06;
const TRAIL_HEAD_HALF_WIDTH = 0.05;
const TRAIL_TAIL_HALF_WIDTH = 0.005;
/** 尾端全透明，头部半透明，避免叠加混合后过亮。 */
const TRAIL_TAIL_ALPHA = 0;
const TRAIL_HEAD_ALPHA = 0.5;

/** 与弹体 PROJECTILE_MATERIALS 同色相，叠加混合下当光带。 */
export const PROJECTILE_TRAIL_COLORS: Record<number, THREE.Color> = {
  [Faction.Blue]: new THREE.Color(0xa8d8ff),
  [Faction.Red]: new THREE.Color(0xffd0b0),
};

let sharedMaterial: THREE.MeshBasicMaterial | null = null;

/** 蓝红双方共用一个材质，颜色走顶点色。被 dispose 后下次取用重建。 */
function getTrailMaterial(): THREE.MeshBasicMaterial {
  if (sharedMaterial && !sharedMaterial.userData.disposed) return sharedMaterial;
  const created = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  created.addEventListener('dispose', () => {
    created.userData.disposed = true;
    if (sharedMaterial === created) sharedMaterial = null;
  });
  sharedMaterial = created;
  return created;
}

const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fallback = new THREE.Vector3();

/**
 * 弹道阵营色渐隐光带。采样点只存在客户端，不影响 sim 确定性。
 * 由 BattleView 对象池复用，reset() 清掉上一条弹道的残影。
 */
export class ProjectileTrailView {
  readonly mesh: THREE.Mesh;

  private readonly geometry: THREE.BufferGeometry;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly samplesX = new Float32Array(TRAIL_MAX_POINTS);
  private readonly samplesY = new Float32Array(TRAIL_MAX_POINTS);
  private readonly samplesZ = new Float32Array(TRAIL_MAX_POINTS);
  private sampleCount = 0;

  constructor() {
    const positions = new Float32Array(TRAIL_MAX_POINTS * 2 * 3);
    const colors = new Float32Array(TRAIL_MAX_POINTS * 2 * 4);
    const indices = new Uint16Array((TRAIL_MAX_POINTS - 1) * 6);
    for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const o = i * 6;
      indices[o] = a;
      indices[o + 1] = c;
      indices[o + 2] = b;
      indices[o + 3] = b;
      indices[o + 4] = c;
      indices[o + 5] = d;
    }

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.colorAttr = new THREE.BufferAttribute(colors, 4);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(this.geometry, getTrailMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /**
   * 把弹体当前场景坐标记入采样，并按相机朝向重建带状面片。
   * landed 时不再追加点并隐藏，避免落地闪烁的炸弹拖出静止残带。
   */
  update(
    x: number,
    y: number,
    z: number,
    camera: THREE.Camera,
    factionColor: THREE.Color,
    widthScale: number,
    landed: boolean,
  ): void {
    if (landed) {
      this.mesh.visible = false;
      return;
    }
    this.pushSample(x, y, z);
    this.rebuildRibbon(camera, factionColor, widthScale);
  }

  /** 池化复用前清空采样，避免上一条弹道的轨迹残留。 */
  reset(): void {
    this.sampleCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
    this.mesh.material = getTrailMaterial();
  }

  /** 间距足够才追加；太近则只把队尾挪到当前位置，暂停时不会堆重复点。 */
  private pushSample(x: number, y: number, z: number): void {
    if (this.sampleCount > 0) {
      const last = this.sampleCount - 1;
      const dx = x - this.samplesX[last]!;
      const dy = y - this.samplesY[last]!;
      const dz = z - this.samplesZ[last]!;
      if (dx * dx + dy * dy + dz * dz < TRAIL_MIN_SPACING_SQ) {
        this.samplesX[last] = x;
        this.samplesY[last] = y;
        this.samplesZ[last] = z;
        return;
      }
    }
    if (this.sampleCount === TRAIL_MAX_POINTS) {
      for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
        this.samplesX[i] = this.samplesX[i + 1]!;
        this.samplesY[i] = this.samplesY[i + 1]!;
        this.samplesZ[i] = this.samplesZ[i + 1]!;
      }
      this.sampleCount--;
    }
    const i = this.sampleCount;
    this.samplesX[i] = x;
    this.samplesY[i] = y;
    this.samplesZ[i] = z;
    this.sampleCount++;
  }

  /** 相邻点求飞行方向，叉乘指向相机得到带宽；半宽与 alpha 从尾到头线性放大。 */
  private rebuildRibbon(camera: THREE.Camera, color: THREE.Color, widthScale: number): void {
    if (this.sampleCount < 2) {
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    this.mesh.visible = true;
    const positions = this.positionAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;
    const last = this.sampleCount - 1;
    const cam = camera.position;
    const scale = Math.max(0.4, widthScale);

    for (let i = 0; i <= last; i++) {
      const px = this.samplesX[i]!;
      const py = this.samplesY[i]!;
      const pz = this.samplesZ[i]!;
      if (i < last) {
        _dir.set(this.samplesX[i + 1]! - px, this.samplesY[i + 1]! - py, this.samplesZ[i + 1]! - pz);
      } else {
        _dir.set(px - this.samplesX[i - 1]!, py - this.samplesY[i - 1]!, pz - this.samplesZ[i - 1]!);
      }
      if (_dir.lengthSq() < 1e-10) _dir.set(0, 1, 0);
      else _dir.normalize();

      _toCam.set(cam.x - px, cam.y - py, cam.z - pz);
      _side.crossVectors(_dir, _toCam);
      if (_side.lengthSq() < 1e-8) {
        _fallback.set(0, 1, 0).cross(_dir);
        if (_fallback.lengthSq() < 1e-8) _fallback.set(1, 0, 0).cross(_dir);
        _side.copy(_fallback);
      }
      _side.normalize();

      const t = i / last;
      const half =
        (TRAIL_TAIL_HALF_WIDTH + (TRAIL_HEAD_HALF_WIDTH - TRAIL_TAIL_HALF_WIDTH) * t) * scale;
      const vi = i * 2;
      const po = vi * 3;
      positions[po] = px - _side.x * half;
      positions[po + 1] = py - _side.y * half;
      positions[po + 2] = pz - _side.z * half;
      positions[po + 3] = px + _side.x * half;
      positions[po + 4] = py + _side.y * half;
      positions[po + 5] = pz + _side.z * half;

      const alpha = TRAIL_TAIL_ALPHA + (TRAIL_HEAD_ALPHA - TRAIL_TAIL_ALPHA) * t;
      const co = vi * 4;
      colors[co] = color.r;
      colors[co + 1] = color.g;
      colors[co + 2] = color.b;
      colors[co + 3] = alpha;
      colors[co + 4] = color.r;
      colors[co + 5] = color.g;
      colors[co + 6] = color.b;
      colors[co + 7] = alpha;
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, last * 6);
  }
}
