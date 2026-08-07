import * as THREE from 'three';
import type { AoePulseEffectSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';

const RING_COLOR = 0xffb040;
const FAN_COLOR = 0xff6a2b;

/**
 * 伤害范围脉冲视图：普攻整圆扩环 / 冲刺前方半扇冲击波。
 * 由 BattleView 对象池复用，不持有任何模拟状态。
 */
export class AoePulseEffectView {
  readonly group = new THREE.Group();

  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly fanFill: THREE.Mesh;
  private readonly fanEdge: THREE.Mesh;
  private readonly fanFillMat: THREE.MeshBasicMaterial;
  private readonly fanEdgeMat: THREE.MeshBasicMaterial;
  private readonly spokes: THREE.LineSegments;
  private readonly spokeMat: THREE.LineBasicMaterial;

  constructor() {
    this.ringMat = new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;

    // 半圆填充：几何默认弧心朝 +X，落地后用 group.rotation.y 对齐冲刺方向
    this.fanFillMat = new THREE.MeshBasicMaterial({
      color: FAN_COLOR,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fanFill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28, -Math.PI / 2, Math.PI),
      this.fanFillMat,
    );
    this.fanFill.rotation.x = -Math.PI / 2;
    this.fanFill.position.y = 0.045;

    this.fanEdgeMat = new THREE.MeshBasicMaterial({
      color: FAN_COLOR,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fanEdge = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 28, 1, -Math.PI / 2, Math.PI),
      this.fanEdgeMat,
    );
    this.fanEdge.rotation.x = -Math.PI / 2;
    this.fanEdge.position.y = 0.055;

    // 普攻环内侧短辐条，强化「波及整圈」而非单体挥砍
    this.spokeMat = new THREE.LineBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const spokePos = new Float32Array(8 * 2 * 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = i * 6;
      spokePos[o] = c * 0.55;
      spokePos[o + 1] = 0;
      spokePos[o + 2] = s * 0.55;
      spokePos[o + 3] = c * 0.95;
      spokePos[o + 4] = 0;
      spokePos[o + 5] = s * 0.95;
    }
    const spokeGeo = new THREE.BufferGeometry();
    spokeGeo.setAttribute('position', new THREE.BufferAttribute(spokePos, 3));
    this.spokes = new THREE.LineSegments(spokeGeo, this.spokeMat);
    this.spokes.position.y = 0.052;

    this.group.add(this.ring, this.fanFill, this.fanEdge, this.spokes);
  }

  /** 按快照进度扩张并淡出；扇形朝向冲刺方向。 */
  update(effect: AoePulseEffectSnapshot): void {
    const progress = Math.max(0, Math.min(1, effect.progress));
    const grow = 0.35 + progress * 0.65;
    const fade = 1 - progress;

    this.group.position.set(toSceneX(effect.x), 0, toSceneZ(effect.y));

    const isFan = effect.kind === 'charge_fan';
    this.ring.visible = !isFan;
    this.spokes.visible = !isFan;
    this.fanFill.visible = isFan;
    this.fanEdge.visible = isFan;

    if (isFan) {
      // Circle/Ring 半弧心在局部 +X；减 π/2 把 +X 转到冲刺朝向 (dirX, dirY→sceneZ)
      this.group.rotation.y = Math.atan2(effect.dirX, effect.dirY) - Math.PI / 2;
      this.fanFill.scale.setScalar(effect.radius * grow);
      this.fanEdge.scale.setScalar(effect.radius * grow);
      this.fanFillMat.opacity = fade * 0.4;
      this.fanEdgeMat.opacity = fade * 0.95;
      return;
    }

    this.group.rotation.y = 0;
    this.ring.scale.setScalar(effect.radius * grow);
    this.spokes.scale.setScalar(effect.radius * grow);
    this.ringMat.opacity = fade * 0.9;
    this.spokeMat.opacity = fade * 0.55;
  }
}
