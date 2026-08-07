import * as THREE from 'three';
import type { HealEffectSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';

/** 女王治疗触发时的短暂范围扩散效果，可由 BattleView 对象池复用。 */
export class HealEffectView {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;

  constructor() {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 40),
      new THREE.MeshBasicMaterial({
        color: 0x6dffb2,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.group.add(this.ring);
  }

  /** 根据快照进度扩张并淡出，避免效果对象持有任何模拟状态。 */
  update(effect: HealEffectSnapshot): void {
    const progress = Math.max(0, Math.min(1, effect.progress));
    this.group.position.set(toSceneX(effect.x), 0, toSceneZ(effect.y));
    this.ring.scale.setScalar(effect.radius * (0.25 + progress * 0.75));
    (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
  }
}
