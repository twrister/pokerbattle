import * as THREE from 'three';
import { Faction, UNIT_CONFIGS, UnitState, type UnitTypeId, toFloat } from '@pb/sim';
import {
  BLOB_SHADOW_GEOMETRY,
  BLOB_SHADOW_MATERIAL,
  SPRITE_DEFS,
  SPRITE_GEOMETRY,
  getSpriteMaterials,
  type SpriteMaterials,
} from './unitSprites.js';

/**
 * 单位视图。各兵种用参考立绘做成公告板精灵（始终面向相机的面片），
 * 配合程序化的待机/行走/攻击动作；几何体与材质按兵种共享，
 * 单个单位只有一个面片 + 血条，几百个同屏也没有压力。
 * 没有立绘的兵种沿用纯色圆柱占位。
 * 地面上那圈亮环仍是真实碰撞圈，调推挤参数时一眼能看出对不对。
 */
export class UnitView {
  readonly key: string;
  readonly group = new THREE.Group();

  private readonly hpAnchor = new THREE.Group();
  private readonly hpFill: THREE.Mesh;
  private readonly barWidth: number;
  /** 振奋状态的脚下光环，默认隐藏并在快照标记时脉冲显示。 */
  private readonly inspireAura: THREE.Mesh;

  // —— 精灵模式 ——
  /** 公告板挂点：每帧对齐相机朝向，子节点上的动画位移都发生在屏幕平面内 */
  private readonly billboard: THREE.Group | null = null;
  private readonly sprite: THREE.Mesh | null = null;
  private readonly spriteMaterials: SpriteMaterials | null = null;
  /** 精灵可视高度（场景单位） */
  private readonly spriteSize: number = 0;
  private readonly spriteWidth: number = 0;
  private readonly spriteSourceFacing: -1 | 1 = 1;
  /** 随机相位，让同兵种单位的动作错开，不像阅兵 */
  private readonly phase = Math.random() * Math.PI * 2;
  /** 角色在屏幕中朝向：1 为右、-1 为左，带滞回避免接近纵向时来回闪 */
  private screenFacing = 1;
  /** 相对原素材是否镜像，取决于素材原始朝向与当前屏幕朝向 */
  private mirror = 1;
  /** 当前是否使用面向相机的正面图，带滞回避免侧向移动时频繁切图 */
  private showingFront = true;
  /** 上一帧是否在前摇，用来抓「前摇结束 → 出手」边沿 */
  private wasAttacking = false;
  /** 突刺动画结束时刻（秒）；> timeSec 时播放朝面向一侧的前倾突刺 */
  private strikeUntil = 0;

  // —— 圆柱占位模式 ——
  private readonly yaw: THREE.Group | null = null;
  private readonly bodyMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly baseEmissive: number = 0.12;

  /** 出手突刺持续时长（秒），与前摇后仰分开，专管「砍出去」那一下 */
  private static readonly STRIKE_SEC = 0.18;

  constructor(faction: Faction, typeId: UnitTypeId) {
    this.key = viewKey(faction, typeId);

    const radius = toFloat(UNIT_CONFIGS[typeId].radius);
    const color = bodyColor(faction, typeId);
    const spriteMaterials = getSpriteMaterials(typeId);

    let topY: number;
    if (spriteMaterials) {
      const spriteDef = SPRITE_DEFS[typeId]!;
      this.spriteMaterials = spriteMaterials;
      this.spriteSize = radius * spriteDef.heightMul;
      this.spriteWidth = this.spriteSize * spriteDef.aspect;
      this.spriteSourceFacing = spriteDef.sourceFacing;
      topY = this.spriteSize;

      this.sprite = new THREE.Mesh(SPRITE_GEOMETRY, spriteMaterials.front);
      this.sprite.scale.set(this.spriteWidth, this.spriteSize, 1);

      this.billboard = new THREE.Group();
      this.billboard.add(this.sprite);
      this.group.add(this.billboard);

      // 公告板不投实时阴影，脚下放一片软阴影圆片压住地面
      const blob = new THREE.Mesh(BLOB_SHADOW_GEOMETRY, BLOB_SHADOW_MATERIAL);
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.02;
      blob.scale.setScalar(radius * 0.9);
      this.group.add(blob);
    } else {
      const height = radius * 2.6;
      topY = height;

      // 每个视图独立一份材质，才能在出手前摇时单独高亮
      this.bodyMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.05,
        emissive: new THREE.Color(color),
        emissiveIntensity: this.baseEmissive,
      });

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

      this.yaw = new THREE.Group();
      this.yaw.add(body, marker);
      this.group.add(this.yaw);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.86, radius, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;

    this.inspireAura = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.08, radius * 1.22, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffdc6b,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.inspireAura.rotation.x = -Math.PI / 2;
    this.inspireAura.position.y = 0.035;
    this.inspireAura.visible = false;

    this.barWidth = Math.max(0.75, radius * 2.4);
    const barHeight = 0.13;
    // 底/前景几乎共面时，远距深度精度塌缩会让后画的透明底条盖住前景（闪烁→只剩底色）。
    // 两层都走透明队列 + 关掉 depthWrite，靠 renderOrder 保证前景永远后画。
    const hpBack = new THREE.Mesh(
      new THREE.PlaneGeometry(this.barWidth + 0.06, barHeight + 0.06),
      new THREE.MeshBasicMaterial({
        color: 0x11161f,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    hpBack.renderOrder = 2;
    this.hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(this.barWidth, barHeight),
      new THREE.MeshBasicMaterial({
        color: hpColor(faction),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.hpFill.position.z = HP_FILL_Z;
    this.hpFill.renderOrder = 3;
    this.hpAnchor.position.y = topY + 0.35;
    this.hpAnchor.add(hpBack, this.hpFill);

    this.group.add(ring, this.inspireAura, this.hpAnchor);
  }

  update(
    sceneX: number,
    sceneZ: number,
    facingX: number,
    facingZ: number,
    hpRatio: number,
    state: UnitState,
    attacking: boolean,
    charging: boolean,
    inspired: boolean,
    timeSec: number,
    camera: THREE.Camera,
  ): void {
    this.group.position.set(sceneX, 0, sceneZ);

    if (this.billboard && this.sprite) {
      this.billboard.quaternion.copy(camera.quaternion);
      this.updateSpriteDirection(sceneX, sceneZ, facingX, facingZ, camera);
      this.applySpritePose(state, attacking, timeSec);
    } else if (this.yaw) {
      if (facingX !== 0 || facingZ !== 0) {
        // 本地 +Z 转到 (facingX, facingZ)，所以角度是 atan2(x, z) 而不是常见的 atan2(y, x)
        this.yaw.rotation.y = Math.atan2(facingX, facingZ);
      }
      // 冲刺高亮略强于普攻前摇，方便在混战里辨认
      this.bodyMaterial!.emissiveIntensity = charging ? 1.05 : attacking ? 0.75 : this.baseEmissive;
    }

    const ratio = Math.max(0, Math.min(1, hpRatio));
    this.hpFill.scale.x = Math.max(ratio, 0.0001);
    // 缩放是绕中心的，往左挪回去血条才是从右往左掉
    this.hpFill.position.set(-(this.barWidth * (1 - ratio)) / 2, 0, HP_FILL_Z);
    this.hpAnchor.quaternion.copy(camera.quaternion);
    this.inspireAura.visible = inspired;
    if (inspired) {
      const pulse = 1 + Math.sin(timeSec * 7 + this.phase) * 0.08;
      this.inspireAura.scale.setScalar(pulse);
    }
  }

  /**
   * 把世界朝向换算成相机画面中的左右/前后关系。
   * 左右决定是否镜像；单位朝向相机时用正面图，背向相机时用背面图。
   */
  private updateSpriteDirection(
    sceneX: number,
    sceneZ: number,
    facingX: number,
    facingZ: number,
    camera: THREE.Camera,
  ): void {
    CAMERA_RIGHT.setFromMatrixColumn(camera.matrixWorld, 0);
    const rightLen = Math.hypot(CAMERA_RIGHT.x, CAMERA_RIGHT.z);
    const screenDot = rightLen > 0
      ? (facingX * CAMERA_RIGHT.x + facingZ * CAMERA_RIGHT.z) / rightLen
      : 0;
    if (screenDot > DIRECTION_HYSTERESIS) this.screenFacing = 1;
    else if (screenDot < -DIRECTION_HYSTERESIS) this.screenFacing = -1;

    const toCameraX = camera.position.x - sceneX;
    const toCameraZ = camera.position.z - sceneZ;
    const toCameraLen = Math.hypot(toCameraX, toCameraZ);
    const cameraDot = toCameraLen > 0
      ? (facingX * toCameraX + facingZ * toCameraZ) / toCameraLen
      : 0;
    if (cameraDot > DIRECTION_HYSTERESIS) this.showingFront = true;
    else if (cameraDot < -DIRECTION_HYSTERESIS) this.showingFront = false;

    this.mirror = this.screenFacing * this.spriteSourceFacing;
    this.sprite!.material = this.showingFront
      ? this.spriteMaterials!.front
      : this.spriteMaterials!.back;
  }

  /**
   * 按状态摆精灵姿势，全部是廉价的正弦程序动画：
   * - 前摇（含骑兵冲刺蓄力）：向目标反方向后仰蓄力（与面向相反）；
   * - 出手：前摇结束瞬间触发，朝面向一侧快速前倾突刺；
   * - 行走/冲刺位移：上下弹跳 + 左右摇摆，模拟小碎步；
   * - 待机：轻微的呼吸浮动与拉伸。
   */
  private applySpritePose(state: UnitState, attacking: boolean, timeSec: number): void {
    // 前摇刚结束 → 开一段短促突刺；池化复用时 wasAttacking 会跟着实例走，行为正确
    if (this.wasAttacking && !attacking) {
      this.strikeUntil = timeSec + UnitView.STRIKE_SEC;
    }
    this.wasAttacking = attacking;

    const size = this.spriteSize;
    const t = timeSec + this.phase;
    let bob = 0;
    let tilt = 0;
    let lunge = 0;
    let stretch = 1;

    const striking = timeSec < this.strikeUntil;
    if (attacking) {
      // 后仰蓄力：tilt 取正，身体倒向背对目标一侧；轻微后移加强蓄力感
      const windup = 0.5 + 0.5 * Math.sin(t * 6);
      tilt = 0.14 * windup;
      lunge = -size * 0.03 * windup;
    } else if (striking) {
      // 出手突刺：前摇结束到 STRIKE_SEC 内，朝面向快速前倾 + 前冲
      const u = 1 - (this.strikeUntil - timeSec) / UnitView.STRIKE_SEC;
      // 前半段冲到峰值，后半段收回，避免僵在前倾姿势
      const pulse = Math.sin(Math.min(1, u) * Math.PI);
      lunge = pulse * size * 0.08;
      tilt = -0.15 * pulse;
    } else if (state === UnitState.Seek || state === UnitState.Charge) {
      const step = t * 9;
      bob = Math.abs(Math.sin(step)) * size * 0.04;
      tilt = Math.sin(step) * 0.04;
    } else {
      bob = Math.sin(t * 2.4) * size * 0.008;
      stretch = 1 + Math.sin(t * 2.4) * 0.008;
    }

    const sprite = this.sprite!;
    sprite.position.set(this.screenFacing * lunge, bob, 0);
    // rotation 在 scale 之后作用，倾斜方向不会被镜像抵消，乘屏幕朝向让身体始终按面向侧倒
    sprite.rotation.z = this.screenFacing * tilt;
    sprite.scale.set(this.mirror * this.spriteWidth, size * stretch, 1);
  }

  /** 对象池取出复用时清掉攻击动画边沿，避免上一任单位的突刺残帧 */
  resetAnimState(): void {
    this.wasAttacking = false;
    this.strikeUntil = 0;
    this.inspireAura.visible = false;
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // 精灵面片、软阴影用的是全局共享资源，不能跟着单个视图销毁
      if (object === this.sprite || object.geometry === BLOB_SHADOW_GEOMETRY) return;
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
  if (faction === Faction.Blue) {
    if (typeId === 'melee_grunt') return 0x3f7ae0;
    if (typeId === 'melee_cavalry') return 0x1f9d8a;
    return 0x74b7f7;
  }
  if (typeId === 'melee_grunt') return 0xd9503f;
  if (typeId === 'melee_cavalry') return 0xc47a2b;
  return 0xf5926a;
}

function hpColor(faction: Faction): number {
  return faction === Faction.Blue ? 0x63d68a : 0xf0d264;
}

/** 前景相对底条朝相机方向的偏移，拉开深度差减轻远距 Z-fighting */
const HP_FILL_Z = 0.05;
/** 左右/正背判定的滞回阈值，避免接近侧向时因微小朝向变化频繁换图 */
const DIRECTION_HYSTERESIS = 0.12;
/** 每帧复用的相机右向量，避免多单位更新时产生临时对象 */
const CAMERA_RIGHT = new THREE.Vector3();
