import * as THREE from 'three';
import type { HealEffectSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';

const HEAL_COLOR = 0x7dffb8;

/**
 * 单体受疗反馈：脚底柔光 + 向上飘起的光环与十字高光。
 * 刻意不做范围扩环，避免被读成群体治疗。可由 BattleView 对象池复用。
 */
export class HealEffectView {
  readonly group = new THREE.Group();

  private readonly glow: THREE.Mesh;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly riseRing: THREE.Mesh;
  private readonly riseMat: THREE.MeshBasicMaterial;
  private readonly cross: THREE.LineSegments;
  private readonly crossMat: THREE.LineBasicMaterial;

  constructor() {
    this.glowMat = new THREE.MeshBasicMaterial({
      color: HEAL_COLOR,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.04;

    this.riseMat = new THREE.MeshBasicMaterial({
      color: HEAL_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.riseRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 28), this.riseMat);
    this.riseRing.rotation.x = -Math.PI / 2;

    this.crossMat = new THREE.LineBasicMaterial({
      color: 0xd8ffe8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const crossPos = new Float32Array([
      -0.35, 0, 0, 0.35, 0, 0,
      0, 0, -0.35, 0, 0, 0.35,
    ]);
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.BufferAttribute(crossPos, 3));
    this.cross = new THREE.LineSegments(crossGeo, this.crossMat);

    this.group.add(this.glow, this.riseRing, this.cross);
  }

  /** 根据快照进度把光柱抬起并淡出，不持有任何模拟状态。 */
  update(effect: HealEffectSnapshot): void {
    const progress = Math.max(0, Math.min(1, effect.progress));
    const size = Math.max(0.35, effect.radius * 1.35);
    this.group.position.set(toSceneX(effect.x), 0, toSceneZ(effect.y));

    // 脚底柔光先胀一下再收回，强调「点在这个单位上」
    const glowPulse = 1 + Math.sin(progress * Math.PI) * 0.25;
    this.glow.scale.setScalar(size * 0.55 * glowPulse);
    this.glowMat.opacity = (1 - progress) * 0.5;

    // 水平光环沿 Y 抬升，看起来像治疗光从身上散出
    const lift = progress * 1.35;
    const ringScale = size * (0.55 + progress * 0.35);
    this.riseRing.position.y = 0.12 + lift;
    this.riseRing.scale.setScalar(ringScale);
    this.riseMat.opacity = (1 - progress) * 0.85;

    // 十字高光略滞后升起，峰值更亮
    const crossU = Math.min(1, progress * 1.35);
    this.cross.position.y = 0.35 + crossU * 1.1;
    this.cross.scale.setScalar(size * (0.9 + crossU * 0.4));
    this.crossMat.opacity = (1 - crossU) * 0.95;
  }
}
