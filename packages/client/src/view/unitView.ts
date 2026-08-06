import * as THREE from 'three';
import { Faction, UNIT_CONFIGS, type UnitTypeId, toFloat } from '@pb/sim';

/**
 * 单位视图。MVP 用纯色圆柱占位，关键是尺寸严格取自碰撞半径——
 * 地面上那圈亮环就是真实碰撞圈，调推挤参数时一眼能看出对不对。
 */
export class UnitView {
  readonly key: string;
  readonly group = new THREE.Group();

  private readonly yaw = new THREE.Group();
  private readonly hpAnchor = new THREE.Group();
  private readonly hpFill: THREE.Mesh;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly baseEmissive: number;
  private readonly barWidth: number;

  constructor(faction: Faction, typeId: UnitTypeId) {
    this.key = viewKey(faction, typeId);

    const radius = toFloat(UNIT_CONFIGS[typeId].radius);
    const height = radius * 2.6;
    const color = bodyColor(faction, typeId);

    // 每个视图独立一份材质，才能在出手前摇时单独高亮。
    // 单位数量到几百之后要换成实例化渲染，那时这里会改成共享材质 + 顶点属性。
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.05,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.12,
    });
    this.baseEmissive = 0.12;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.82, radius, height, 20),
      this.bodyMaterial,
    );
    body.position.y = height / 2;
    body.castShadow = true;

    // 朝前的小尖锥，用来看清单位面朝哪个方向
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.4, radius * 0.9, 4),
      new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.4 }),
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.set(0, height * 0.62, radius * 0.95);

    this.yaw.add(body, marker);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.86, radius, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;

    this.barWidth = Math.max(0.75, radius * 2.4);
    const barHeight = 0.13;
    const hpBack = new THREE.Mesh(
      new THREE.PlaneGeometry(this.barWidth + 0.06, barHeight + 0.06),
      new THREE.MeshBasicMaterial({ color: 0x11161f, transparent: true, opacity: 0.85 }),
    );
    this.hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(this.barWidth, barHeight),
      new THREE.MeshBasicMaterial({ color: hpColor(faction) }),
    );
    this.hpFill.position.z = 0.001;
    this.hpAnchor.position.y = height + 0.4;
    this.hpAnchor.add(hpBack, this.hpFill);

    this.group.add(this.yaw, ring, this.hpAnchor);
  }

  update(
    sceneX: number,
    sceneZ: number,
    facingX: number,
    facingZ: number,
    hpRatio: number,
    attacking: boolean,
    camera: THREE.Camera,
  ): void {
    this.group.position.set(sceneX, 0, sceneZ);

    if (facingX !== 0 || facingZ !== 0) {
      // 本地 +Z 转到 (facingX, facingZ)，所以角度是 atan2(x, z) 而不是常见的 atan2(y, x)
      this.yaw.rotation.y = Math.atan2(facingX, facingZ);
    }

    const ratio = Math.max(0, Math.min(1, hpRatio));
    this.hpFill.scale.x = Math.max(ratio, 0.0001);
    // 缩放是绕中心的，往左挪回去血条才是从右往左掉
    this.hpFill.position.x = -(this.barWidth * (1 - ratio)) / 2;
    this.hpAnchor.quaternion.copy(camera.quaternion);

    this.bodyMaterial.emissiveIntensity = attacking ? 0.75 : this.baseEmissive;
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    });
  }
}

/** 对象池的分组键：几何体和材质都由「阵营 + 兵种」决定，同键的视图可以随意复用 */
export function viewKey(faction: Faction, typeId: UnitTypeId): string {
  return `${faction}:${typeId}`;
}

function bodyColor(faction: Faction, typeId: UnitTypeId): number {
  if (faction === Faction.Blue) return typeId === 'melee_grunt' ? 0x3f7ae0 : 0x74b7f7;
  return typeId === 'melee_grunt' ? 0xd9503f : 0xf5926a;
}

function hpColor(faction: Faction): number {
  return faction === Faction.Blue ? 0x63d68a : 0xf0d264;
}
