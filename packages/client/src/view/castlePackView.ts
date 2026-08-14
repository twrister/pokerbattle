import * as THREE from 'three';
import { Faction } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';

const PACK_ASPECT = 843 / 1024;
const PACK_HEIGHT = 2.6;
const HOVER_FORWARD = 3.5;
const HOVER_HEIGHT = 2.0;
const FLY_DURATION_SEC = 0.48;
const BOB_AMPLITUDE = 0.32;
const BOB_FREQ = 1.7;

let sharedMaterial: THREE.MeshBasicMaterial | null = null;

/** 懒加载共享卡包材质；测试环境无 DOM 时保持不可见占位。 */
function getPackMaterial(): THREE.MeshBasicMaterial {
  if (sharedMaterial) return sharedMaterial;
  sharedMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    // 素材由黑底烘焙，RGB 已相当于预乘，避免透明边发黑
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    // 不写也不测深度，避免被主堡/单位立绘挡住
    depthWrite: false,
    depthTest: false,
    visible: false,
  });
  if (typeof document === 'undefined') return sharedMaterial;
  const texture = new THREE.TextureLoader().load('effects/castle-pack.png', (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.magFilter = THREE.NearestFilter;
    loaded.premultiplyAlpha = true;
    if (sharedMaterial) {
      sharedMaterial.visible = true;
      sharedMaterial.needsUpdate = true;
    }
  });
  sharedMaterial.map = texture;
  return sharedMaterial;
}

/**
 * 仅本机可见的城堡保护卡包：从主堡飞出后正弦漂浮，始终朝向相机。
 */
export class CastlePackView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;

  private appearAt = 0;
  private fromX = 0;
  private fromZ = 0;
  private fromH = 0.4;
  private toX = 0;
  private toZ = 0;
  private toH = HOVER_HEIGHT;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PACK_HEIGHT * PACK_ASPECT, PACK_HEIGHT),
      getPackMaterial(),
    );
    this.mesh.name = 'castle-pack';
    // 高于爆炸(8)、弹道(7)与单位血条，保证卡包始终画在最前
    this.mesh.renderOrder = 20;
    this.group.add(this.mesh);
  }

  /** 以主堡为起点、朝场地中线前方落点，开始飞出。 */
  appear(castleX: number, castleY: number, faction: Faction, timeSec: number): void {
    const forward = faction === Faction.Blue ? HOVER_FORWARD : -HOVER_FORWARD;
    this.fromX = toSceneX(castleX);
    this.fromZ = toSceneZ(castleY);
    this.fromH = 0.4;
    this.toX = toSceneX(castleX);
    this.toZ = toSceneZ(castleY + forward);
    this.toH = HOVER_HEIGHT;
    this.appearAt = timeSec;
    this.group.position.set(this.fromX, this.fromH, this.fromZ);
  }

  update(timeSec: number, camera: THREE.Camera): void {
    const flyT = Math.min(1, Math.max(0, (timeSec - this.appearAt) / FLY_DURATION_SEC));
    const ease = 1 - (1 - flyT) ** 3;
    const x = this.fromX + (this.toX - this.fromX) * ease;
    const z = this.fromZ + (this.toZ - this.fromZ) * ease;
    const baseH = this.fromH + (this.toH - this.fromH) * ease;
    const bob = flyT >= 1 ? Math.sin(timeSec * BOB_FREQ) * BOB_AMPLITUDE : 0;
    this.group.position.set(x, baseH + bob, z);
    this.group.quaternion.copy(camera.quaternion);
  }
}
