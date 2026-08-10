import * as THREE from 'three';
import type { ExplosionEffectSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';
import {
  applyExplosionFrame,
  createExplosionMaterial,
  getExplosionGeometry,
} from './explosionEffectSprites.js';

/**
 * 炸弹兵爆炸序列帧视图：竖立公告板，爆炸中心落在地面高度。
 * 可由 BattleView 对象池复用，不持有任何模拟状态。
 */
export class ExplosionEffectView {
  readonly group = new THREE.Group();

  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private lastFrame = -1;

  constructor() {
    this.material = createExplosionMaterial();
    this.mesh = new THREE.Mesh(getExplosionGeometry(), this.material);
    // 高于地面与单位，配合 depthTest:false 保证穿地半边仍完整可见
    this.mesh.renderOrder = 8;
    this.group.add(this.mesh);
  }

  /** 根据快照进度切帧；面片立在落点、中心贴地，并始终面向相机。 */
  update(effect: ExplosionEffectSnapshot, camera: THREE.Camera): void {
    const progress = Math.max(0, Math.min(1, effect.progress));
    // group.y=0：几何中心锚在地面，爆炸核心落在地面高度
    this.group.position.set(toSceneX(effect.x), 0, toSceneZ(effect.y));
    this.group.quaternion.copy(camera.quaternion);

    // 高度略大于 AOE 半径即可，过大容易在斜视镜头里显得「飞起来」
    const height = Math.max(1.1, effect.radius * 1.6);
    this.mesh.scale.setScalar(height);

    const frame = Math.min(7, Math.max(0, Math.floor(progress * 8)));
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      applyExplosionFrame(this.material, progress);
    }

    // 末段略淡出，避免硬切消失
    this.material.opacity = progress > 0.85 ? (1 - progress) / 0.15 : 1;
  }

  /** 回收进池前复位帧缓存，避免复用时跳帧。 */
  reset(): void {
    this.lastFrame = -1;
    this.material.opacity = 1;
  }
}
