import * as THREE from 'three';
import {
  AIR_UNIT_HOVER_HEIGHT,
  BODY_SCALE_REFERENCE,
  CASTLE_PROTECT_HP_RATIO,
  Faction,
  UNIT_CONFIGS,
  UnitState,
  isArcherTowerId,
  type UnitTypeId,
  toFloat,
} from '@pb/sim';
import {
  BLOB_SHADOW_GEOMETRY,
  BLOB_SHADOW_MATERIAL,
  SPRITE_DEFS,
  SPRITE_GEOMETRY,
  getSpriteMaterials,
  type SpriteMaterials,
} from './unitSprites.js';
import {
  CAST_FRAME_RATE,
  CAST_SHEETS,
  applyCastFrame,
  createCastSheetMaterial,
  getCastSheetGeometry,
} from './castEffectSprites.js';
import { viewNearSign } from './coords.js';

/**
 * 单位视图。各兵种用参考立绘做成公告板精灵（始终面向相机的面片），
 * 配合程序化的待机/行走/攻击动作；贴图按兵种共享，材质按视图克隆以便单独受击染色。
 * 没有立绘的兵种沿用纯色圆柱占位。
 * 地面上那圈亮环仍是真实碰撞圈；精灵/圆柱大小只看体型（相对民兵=1），与碰撞半径无关。
 */
export class UnitView {
  readonly key: string;
  readonly group = new THREE.Group();
  /** 上次同步的血量比例，供视图层检测掉血并触发受击闪红 */
  lastHpRatio = 1;

  private readonly hpAnchor = new THREE.Group();
  private readonly hpFill: THREE.Mesh;
  /** 主堡保护线刻度；仅 building_base 有，与 HUD 同一阈值。 */
  private readonly protectMark: THREE.Mesh | null = null;
  /** 保护线占最大血量的比例，供掉血后高亮刻度。 */
  private readonly protectRatio: number = 0;
  /** 已写入网格的血量比例；未变化则跳过 scale/刻度写入 */
  private displayedHpRatio = -1;
  private displayedInspired = false;
  private displayedProtectAlert: boolean | null = null;
  private readonly barWidth: number;
  private readonly hpBaseY: number;
  /** 空中单位只抬高角色与血条，碰撞圈和阴影仍留在地面标示落点。 */
  private readonly isAir: boolean;
  /** 有占地的建筑：无朝向切换、贴图宽铺满占地、底边对齐画面近端格边。 */
  private readonly isBuilding: boolean;
  /** 防御塔塔顶弓手纯表现（非独立单位）。 */
  private readonly hasTowerGarrison: boolean;
  /** 塔顶弓手数：普通塔 1、双射手 2、三射手 3。 */
  private readonly garrisonCount: number;
  /** 炸弹兵：引信期间播闪烁警示，不挂 Teleport 施法特效。 */
  private readonly isDetonator: boolean;
  /**
   * 建筑贴图相对逻辑中心的底边偏移幅度（= footprint/2）。
   * 实际 Z 符号随镜头近端翻转：蓝方视角 +Z，红方视角 -Z。
   */
  private readonly buildingBaseOffsetMag: number = 0;
  /** 振奋状态的脚下光环，默认隐藏并在快照标记时脉冲显示。 */
  private readonly inspireAura: THREE.Mesh;

  // —— 精灵模式 ——
  /** 公告板挂点：每帧对齐相机朝向，子节点上的动画位移都发生在屏幕平面内 */
  private readonly billboard: THREE.Group | null = null;
  private readonly sprite: THREE.Mesh | null = null;
  /** 本视图独立材质，用于受击染色 */
  private readonly spriteMaterials: SpriteMaterials | null = null;
  /** 共享模板材质；贴图异步就绪后只改模板的 visible，克隆体每帧同步 */
  private readonly sharedSpriteMaterials: SpriteMaterials | null = null;
  /** 塔顶弓手精灵（普通塔 1 人、双射手 2 人、三射手 3 人） */
  private readonly garrisonSprites: THREE.Mesh[] = [];
  /** 各弓手相对塔中心的屏幕 X / Y 锚点（三人塔前排更低、后排抬高） */
  private readonly garrisonBaseXs: number[] = [];
  private readonly garrisonBaseYs: number[] = [];
  private readonly garrisonMaterials: SpriteMaterials | null = null;
  private readonly sharedGarrisonMaterials: SpriteMaterials | null = null;
  private readonly garrisonSize: number = 0;
  private readonly garrisonWidth: number = 0;
  private readonly garrisonSourceFacing: -1 | 1 = 1;
  private readonly garrisonBaseY: number = 0;
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
  /** 受击闪红结束时刻（秒） */
  private hitUntil = 0;
  /** 范围受击轻抖结束时刻（秒） */
  private shakeUntil = 0;
  /** 本次闪红是否来自范围伤害（更长、略亮） */
  private aoeHitFlash = false;
  /** 上一帧是否在施法，用来抓边沿并重开动效 */
  private wasCasting = false;
  /** 本次施法动画起始时刻（秒） */
  private castAnimStartedAt = 0;

  // —— 圆柱占位模式 ——
  private readonly yaw: THREE.Group | null = null;
  private readonly bodyMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly baseBodyColor = new THREE.Color();
  private readonly baseEmissive: number = 0.12;

  /**
   * 有技能兵种挂的 Teleport 施法特效挂点；无技能兵种为 null。
   * 子节点是三层 Additive 序列帧，始终面向相机。
   */
  private readonly castFx: THREE.Group | null = null;
  private readonly castLayers: Array<{
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    frames: number;
  }> = [];

  /** 出手突刺持续时长（秒），与前摇后仰分开，专管「砍出去」那一下 */
  private static readonly STRIKE_SEC = 0.18;
  /** 受击材质变红持续时长（秒） */
  private static readonly HIT_FLASH_SEC = 0.15;
  /** 范围受击闪红更长，方便同帧多目标对齐辨认 */
  private static readonly HIT_FLASH_AOE_SEC = 0.24;
  /** 范围受击轻抖时长（秒） */
  private static readonly HIT_SHAKE_SEC = 0.12;

  constructor(faction: Faction, typeId: UnitTypeId) {
    this.key = viewKey(faction, typeId);
    // 供同步层/测试读取画面阵营，不参与逻辑判定
    this.group.userData.visualFaction = faction;

    const config = UNIT_CONFIGS[typeId];
    this.isAir = config.movementLayer === 'air';
    this.isBuilding = config.footprint > 0;
    this.hasTowerGarrison = isArcherTowerId(typeId);
    // 普通塔 1 人、双射手 2 人、三射手 3 人；仅客户端立绘，逻辑仍是单塔
    this.garrisonCount =
      typeId === 'building_tower_triple' ? 3
        : typeId === 'building_tower_advanced' ? 2
          : this.hasTowerGarrison ? 1 : 0;
    this.isDetonator = !!config.detonate;
    // 碰撞圈用真实半径；显示半径 = 民兵基准 × 体型，与碰撞完全解耦
    const radius = toFloat(config.radius);
    const bodyRadius = BODY_SCALE_REFERENCE * Math.max(0.05, toFloat(config.bodyScale));
    const footprint = config.footprint;
    // 幅度固定；首帧 update 再按镜头近端决定 +Z / -Z
    this.buildingBaseOffsetMag = this.isBuilding ? footprint / 2 : 0;
    const color = bodyColor(faction, typeId);
    // 建筑按阵营取红/蓝专属贴图；普通单位仍共用一套立绘
    const sharedSprites = getSpriteMaterials(typeId, faction);

    let topY: number;
    if (sharedSprites) {
      const spriteDef = SPRITE_DEFS[typeId]!;
      this.sharedSpriteMaterials = sharedSprites;
      // 克隆材质，避免同兵种共享 tint 时全体一起变红
      this.spriteMaterials = {
        front: sharedSprites.front.clone(),
        back: sharedSprites.back.clone(),
      };
      if (this.isBuilding) {
        // 贴图宽度铺满占地，高度按素材宽高比推算；底边落到画面近端格边
        this.spriteWidth = footprint;
        this.spriteSize = footprint / Math.max(0.05, spriteDef.aspect);
      } else {
        this.spriteSize = bodyRadius * spriteDef.heightMul;
        this.spriteWidth = this.spriteSize * spriteDef.aspect;
      }
      this.spriteSourceFacing = spriteDef.sourceFacing;
      topY = this.spriteSize;

      this.sprite = new THREE.Mesh(SPRITE_GEOMETRY, this.spriteMaterials.front);
      this.sprite.scale.set(this.spriteWidth, this.spriteSize, 1);

      this.billboard = new THREE.Group();
      // 初始按蓝方近端占位；update 里随镜头翻转
      this.billboard.position.z = this.buildingBaseOffsetMag;
      this.billboard.add(this.sprite);

      // 防御塔：塔顶挂弓手立绘作攻击表现，逻辑本体仍是塔
      if (this.hasTowerGarrison) {
        const archerDef = SPRITE_DEFS.ranged_archer!;
        const sharedGarrison = getSpriteMaterials('ranged_archer', faction)!;
        this.sharedGarrisonMaterials = sharedGarrison;
        this.garrisonMaterials = {
          front: sharedGarrison.front.clone(),
          back: sharedGarrison.back.clone(),
        };
        // 略小于地面弓手，脚踩在塔身上半段平台
        this.garrisonSize = BODY_SCALE_REFERENCE * 0.75 * archerDef.heightMul;
        this.garrisonWidth = this.garrisonSize * archerDef.aspect;
        this.garrisonSourceFacing = archerDef.sourceFacing;
        this.garrisonBaseY = this.spriteSize * 0.62;
        // 1 居中、2 左右；三人前 1 后 2，后排略收间距并抬高，避免挤出塔顶
        const sideGap = this.spriteWidth * (this.garrisonCount >= 3 ? 0.18 : 0.22);
        const backRowLift = this.garrisonCount >= 3 ? this.garrisonSize * 0.18 : 0;
        for (let i = 0; i < this.garrisonCount; i++) {
          let baseX = (i - (this.garrisonCount - 1) / 2) * sideGap;
          let baseY = this.garrisonBaseY;
          let renderOrder = 1;
          if (this.garrisonCount === 3) {
            if (i === 0) {
              // 前排居中，压在后排之上
              baseX = 0;
              renderOrder = 2;
            } else {
              baseX = i === 1 ? -sideGap : sideGap;
              baseY = this.garrisonBaseY + backRowLift;
            }
          }
          const mesh = new THREE.Mesh(SPRITE_GEOMETRY, this.garrisonMaterials.front);
          mesh.scale.set(this.garrisonWidth, this.garrisonSize, 1);
          mesh.position.set(baseX, baseY, 0);
          mesh.renderOrder = renderOrder;
          this.billboard.add(mesh);
          this.garrisonSprites.push(mesh);
          this.garrisonBaseXs.push(baseX);
          this.garrisonBaseYs.push(baseY);
        }
        topY = Math.max(topY, ...this.garrisonBaseYs.map((y) => y + this.garrisonSize));
      }

      this.group.add(this.billboard);

      // 建筑不投影子；普通单位用软阴影圆片压住地面
      // 高度须高于河桥薄片（约 0.028），否则过桥时会被深度挡住。
      if (!this.isBuilding) {
        const blob = new THREE.Mesh(BLOB_SHADOW_GEOMETRY, BLOB_SHADOW_MATERIAL);
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.031;
        blob.scale.setScalar(bodyRadius * 0.9);
        this.group.add(blob);
      }
    } else {
      const height = bodyRadius * 2.6;
      topY = height;

      this.baseBodyColor.set(color);
      // 每个视图独立一份材质，才能在出手前摇/受击时单独高亮
      this.bodyMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.05,
        emissive: new THREE.Color(color),
        emissiveIntensity: this.baseEmissive,
      });

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(bodyRadius * 0.82, bodyRadius, height, 20),
        this.bodyMaterial,
      );
      body.position.y = height / 2;
      body.castShadow = true;

      // 朝前的小尖锥，用来看清单位面朝哪个方向
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(bodyRadius * 0.4, bodyRadius * 0.9, 4),
        new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.4 }),
      );
      marker.rotation.x = Math.PI / 2;
      marker.position.set(0, height * 0.62, bodyRadius * 0.95);

      this.yaw = new THREE.Group();
      this.yaw.add(body, marker);
      this.group.add(this.yaw);
    }

    // 普通单位画碰撞圈；建筑放置后不画占地格，只靠贴图表达位置
    if (!this.isBuilding) {
      const groundMark = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.86, radius, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
      );
      groundMark.rotation.x = -Math.PI / 2;
      // 叠在软阴影之上，并高于桥面。
      groundMark.position.y = 0.033;
      this.group.add(groundMark);
    }

    this.inspireAura = new THREE.Mesh(
      new THREE.RingGeometry(
        this.isBuilding ? footprint * 0.52 : radius * 1.08,
        this.isBuilding ? footprint * 0.58 : radius * 1.22,
        32,
      ),
      new THREE.MeshBasicMaterial({
        color: 0xffdc6b,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.inspireAura.rotation.x = -Math.PI / 2;
    this.inspireAura.position.y = 0.036;
    this.inspireAura.visible = false;

    // 仅主动技能挂施法特效；国王光环是持续效果，不需要瞬间施法动画
    if (config.charge || config.heal || config.summon) {
      this.castFx = new THREE.Group();
      this.castFx.visible = false;
      for (const sheet of CAST_SHEETS) {
        const material = createCastSheetMaterial(sheet);
        const mesh = new THREE.Mesh(getCastSheetGeometry(sheet), material);
        const height = bodyRadius * sheet.heightMul;
        mesh.scale.set(height, height, 1);
        mesh.renderOrder = 4;
        this.castFx.add(mesh);
        this.castLayers.push({ mesh, material, frames: sheet.frames });
      }
      this.group.add(this.castFx);
    }

    this.barWidth = this.isBuilding
      ? Math.max(1.2, footprint * 0.85)
      : Math.max(0.75, bodyRadius * 2.4);
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
    if (typeId === 'building_base') {
      this.protectRatio = CASTLE_PROTECT_HP_RATIO;
      // 略高于血条，与 HUD 刻度一样上下探出，避免被前景条盖住
      this.protectMark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.06, barHeight + 0.1),
        new THREE.MeshBasicMaterial({
          color: HP_PROTECT_MARK_COLOR,
          transparent: true,
          depthWrite: false,
        }),
      );
      this.protectMark.name = 'hp-protect-mark';
      this.protectMark.position.set((this.protectRatio - 0.5) * this.barWidth, 0, HP_FILL_Z + 0.02);
      this.protectMark.renderOrder = 5;
    }
    this.hpBaseY = topY + (this.isBuilding ? 0.45 : 0.35);
    // 血条跟建筑贴图一起落到近端格边上方；符号在 update 里与贴图同步
    this.hpAnchor.position.set(0, this.hpBaseY, this.buildingBaseOffsetMag);
    this.hpAnchor.add(hpBack, this.hpFill);
    if (this.protectMark) this.hpAnchor.add(this.protectMark);

    this.group.add(this.inspireAura, this.hpAnchor);
  }

  /** 把建筑贴图与血条锚到当前镜头的画面下方格边（蓝 +Z / 红 -Z）。 */
  private applyBuildingNearEdge(camera: THREE.Camera): void {
    if (!this.isBuilding || !this.billboard) return;
    const offsetZ = this.buildingBaseOffsetMag * viewNearSign(camera);
    this.billboard.position.z = offsetZ;
    this.hpAnchor.position.z = offsetZ;
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
    casting: boolean,
    timeSec: number,
    camera: THREE.Camera,
  ): void {
    this.group.position.set(sceneX, 0, sceneZ);
    // 范围受击时在落点上叠短促抖动，多目标同帧掉血更易成组辨认
    if (timeSec < this.shakeUntil) {
      const u = (this.shakeUntil - timeSec) / UnitView.HIT_SHAKE_SEC;
      const amp = 0.07 * u * u;
      this.group.position.x += Math.sin(timeSec * 68 + this.phase) * amp;
      this.group.position.z += Math.cos(timeSec * 52 + this.phase) * amp;
    }

    if (this.billboard && this.sprite) {
      this.billboard.quaternion.copy(camera.quaternion);
      if (this.isBuilding) {
        // 塔本体固定正面；塔顶弓手才跟朝向/攻击姿势走
        this.sprite.material = this.spriteMaterials!.front;
        this.sprite.position.set(0, 0, 0);
        this.sprite.rotation.z = 0;
        this.sprite.scale.set(this.spriteWidth, this.spriteSize, 1);
        this.applyBuildingNearEdge(camera);
        if (this.garrisonSprites.length > 0) {
          this.updateGarrisonDirection(sceneX, sceneZ, facingX, facingZ, camera);
          this.applyGarrisonPose(state, attacking, timeSec);
        }
      } else {
        this.updateSpriteDirection(sceneX, sceneZ, facingX, facingZ, camera);
        this.applySpritePose(state, attacking, timeSec);
      }
    } else if (this.yaw) {
      if (facingX !== 0 || facingZ !== 0) {
        // 本地 +Z 转到 (facingX, facingZ)，所以角度是 atan2(x, z) 而不是常见的 atan2(y, x)
        this.yaw.rotation.y = Math.atan2(facingX, facingZ);
      }
      // 冲刺高亮略强于普攻前摇，方便在混战里辨认
      this.bodyMaterial!.emissiveIntensity = charging ? 1.05 : attacking ? 0.75 : this.baseEmissive;
    }
    this.updateFlightHeight(timeSec);

    const ratio = Math.max(0, Math.min(1, hpRatio));
    if (ratio !== this.displayedHpRatio) {
      this.displayedHpRatio = ratio;
      this.hpFill.scale.x = Math.max(ratio, 0.0001);
      // 缩放是绕中心的，往左挪回去血条才是从右往左掉
      this.hpFill.position.set(-(this.barWidth * (1 - ratio)) / 2, 0, HP_FILL_Z);
      this.syncProtectMark(ratio);
    }
    this.hpAnchor.quaternion.copy(camera.quaternion);
    if (inspired !== this.displayedInspired) {
      this.displayedInspired = inspired;
      this.inspireAura.visible = inspired;
    }
    if (inspired) {
      const pulse = 1 + Math.sin(timeSec * 7 + this.phase) * 0.08;
      this.inspireAura.scale.setScalar(pulse);
    }

    this.updateCastFx(casting, timeSec, camera);
    // 炸弹兵引信用 attacking 标记；闪烁盖过普通受击 tint
    this.applyHitTint(timeSec, this.isDetonator && attacking);
  }

  /** 主堡低于保护线时加亮刻度，与 HUD is-protect 高亮对齐。 */
  private syncProtectMark(hpRatio: number): void {
    if (!this.protectMark) return;
    const material = this.protectMark.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    const alert = hpRatio < this.protectRatio;
    if (this.displayedProtectAlert === alert) return;
    this.displayedProtectAlert = alert;
    material.color.setHex(alert ? HP_PROTECT_MARK_ALERT : HP_PROTECT_MARK_COLOR);
  }

  /** 让空中角色缓慢悬浮，同时保持地面圈和阴影不离地，便于判断实际战斗位置。 */
  private updateFlightHeight(timeSec: number): void {
    const hover = this.isAir
      ? AIR_UNIT_HOVER_HEIGHT + Math.sin(timeSec * AIR_HOVER_SPEED + this.phase) * AIR_HOVER_AMPLITUDE
      : 0;
    if (this.billboard) this.billboard.position.y = hover;
    if (this.yaw) this.yaw.position.y = hover;
    this.hpAnchor.position.y = this.hpBaseY + hover;
  }

  /** 施法边沿重启 Teleport 序列帧；持续施法时播完循环，结束则隐藏。 */
  private updateCastFx(casting: boolean, timeSec: number, camera: THREE.Camera): void {
    if (!this.castFx) return;

    if (casting && !this.wasCasting) this.castAnimStartedAt = timeSec;
    this.wasCasting = casting;
    if (!casting) {
      this.castFx.visible = false;
      return;
    }

    this.castFx.visible = true;
    this.castFx.quaternion.copy(camera.quaternion);
    const elapsed = Math.max(0, timeSec - this.castAnimStartedAt);
    for (let i = 0; i < this.castLayers.length; i++) {
      const layer = this.castLayers[i]!;
      const sheet = CAST_SHEETS[i]!;
      const frame = Math.floor(elapsed * CAST_FRAME_RATE) % layer.frames;
      const map = layer.material.map;
      if (map) applyCastFrame(map, sheet, frame);
    }
  }

  /** 血量下降时由视图层调用，开启短时材质变红；aoe 时加长并触发轻抖 */
  flashHit(timeSec: number, aoe = false): void {
    this.aoeHitFlash = aoe;
    this.hitUntil = timeSec + (aoe ? UnitView.HIT_FLASH_AOE_SEC : UnitView.HIT_FLASH_SEC);
    if (aoe) this.shakeUntil = timeSec + UnitView.HIT_SHAKE_SEC;
  }

  /**
   * 按受击剩余时间把材质色拉向红再复原；强度 1→0。
   * 炸弹兵引信期间改播橙红硬闪，提示即将自爆。
   */
  private applyHitTint(timeSec: number, detonating = false): void {
    const duration = this.aoeHitFlash ? UnitView.HIT_FLASH_AOE_SEC : UnitView.HIT_FLASH_SEC;
    const raw = timeSec < this.hitUntil ? (this.hitUntil - timeSec) / duration : 0;
    // 范围受击峰值更亮，同波次多目标闪红更容易齐步被看见
    let t = this.aoeHitFlash ? Math.min(1, raw * 1.15) : raw;
    let flashColor = HIT_FLASH_COLOR;
    if (detonating) {
      // 约 8Hz 硬闪：亮橙 ↔ 近白，比平滑呼吸更像引信警示
      const on = Math.sin(timeSec * Math.PI * 16 + this.phase) >= 0;
      t = on ? 1 : 0.2;
      flashColor = DETONATE_FLASH_COLOR;
    }

    if (this.spriteMaterials && this.sharedSpriteMaterials) {
      // 共享材质在贴图加载完成后才 visible；克隆体需跟着同步，否则会永远隐形
      this.spriteMaterials.front.visible = this.sharedSpriteMaterials.front.visible;
      this.spriteMaterials.back.visible = this.sharedSpriteMaterials.back.visible;
      HIT_TINT_COLOR.lerpColors(WHITE_COLOR, flashColor, t);
      this.spriteMaterials.front.color.copy(HIT_TINT_COLOR);
      this.spriteMaterials.back.color.copy(HIT_TINT_COLOR);
      if (this.garrisonMaterials && this.sharedGarrisonMaterials) {
        this.garrisonMaterials.front.visible = this.sharedGarrisonMaterials.front.visible;
        this.garrisonMaterials.back.visible = this.sharedGarrisonMaterials.back.visible;
        this.garrisonMaterials.front.color.copy(HIT_TINT_COLOR);
        this.garrisonMaterials.back.color.copy(HIT_TINT_COLOR);
      }
      return;
    }

    if (this.bodyMaterial) {
      this.bodyMaterial.color.lerpColors(this.baseBodyColor, flashColor, t);
      this.bodyMaterial.emissive.lerpColors(this.baseBodyColor, flashColor, t);
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
    this.updateFacingFromCamera(sceneX, sceneZ, facingX, facingZ, camera);
    this.mirror = this.screenFacing * this.spriteSourceFacing;
    this.sprite!.material = this.showingFront
      ? this.spriteMaterials!.front
      : this.spriteMaterials!.back;
  }

  /** 塔顶弓手朝向：复用同一套屏幕左右/正背判定，材质用弓手贴图。 */
  private updateGarrisonDirection(
    sceneX: number,
    sceneZ: number,
    facingX: number,
    facingZ: number,
    camera: THREE.Camera,
  ): void {
    this.updateFacingFromCamera(sceneX, sceneZ, facingX, facingZ, camera);
    this.mirror = this.screenFacing * this.garrisonSourceFacing;
    const material = this.showingFront
      ? this.garrisonMaterials!.front
      : this.garrisonMaterials!.back;
    for (const sprite of this.garrisonSprites) {
      sprite.material = material;
    }
  }

  /** 根据相机与世界朝向更新 screenFacing / showingFront。 */
  private updateFacingFromCamera(
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
  }

  /**
   * 按状态摆精灵姿势，全部是廉价的正弦程序动画：
   * - 前摇（含皇家骑士冲刺蓄力）：向目标反方向后仰蓄力（与面向相反）；
   * - 出手：前摇结束瞬间触发，朝面向一侧快速前倾突刺；
   * - 行走/冲刺位移：上下弹跳 + 左右摇摆，模拟小碎步；
   * - 待机：轻微的呼吸浮动与拉伸。
   */
  private applySpritePose(state: UnitState, attacking: boolean, timeSec: number): void {
    this.applyPoseToSprite(
      this.sprite!,
      this.spriteSize,
      this.spriteWidth,
      0,
      state,
      attacking,
      timeSec,
      true,
    );
  }

  /** 塔顶弓手攻击/待机姿势；脚底锚在各自 baseY，多弓手保留各自 baseX。 */
  private applyGarrisonPose(state: UnitState, attacking: boolean, timeSec: number): void {
    for (let i = 0; i < this.garrisonSprites.length; i++) {
      this.applyPoseToSprite(
        this.garrisonSprites[i]!,
        this.garrisonSize,
        this.garrisonWidth,
        this.garrisonBaseYs[i] ?? this.garrisonBaseY,
        state,
        attacking,
        timeSec,
        false,
        this.garrisonBaseXs[i] ?? 0,
      );
    }
  }

  /**
   * 按状态摆精灵姿势，全部是廉价的正弦程序动画：
   * - 前摇：向目标反方向后仰蓄力；
   * - 出手：前摇结束瞬间朝面向前倾突刺；
   * - 行走/冲刺：上下弹跳 + 左右摇摆；
   * - 待机：轻微呼吸浮动与拉伸。
   */
  private applyPoseToSprite(
    sprite: THREE.Mesh,
    size: number,
    width: number,
    baseY: number,
    state: UnitState,
    attacking: boolean,
    timeSec: number,
    allowWalkBob: boolean,
    baseX = 0,
  ): void {
    // 前摇刚结束 → 开一段短促突刺；池化复用时 wasAttacking 会跟着实例走，行为正确
    if (this.wasAttacking && !attacking) {
      this.strikeUntil = timeSec + UnitView.STRIKE_SEC;
    }
    this.wasAttacking = attacking;

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
    } else if (allowWalkBob && (state === UnitState.Seek || state === UnitState.Charge)) {
      const step = t * 9;
      bob = Math.abs(Math.sin(step)) * size * 0.04;
      tilt = Math.sin(step) * 0.04;
    } else {
      bob = Math.sin(t * 2.4) * size * 0.008;
      stretch = 1 + Math.sin(t * 2.4) * 0.008;
    }

    sprite.position.set(baseX + this.screenFacing * lunge, baseY + bob, 0);
    // rotation 在 scale 之后作用，倾斜方向不会被镜像抵消，乘屏幕朝向让身体始终按面向侧倒
    sprite.rotation.z = this.screenFacing * tilt;
    sprite.scale.set(this.mirror * width, size * stretch, 1);
  }

  /** 对象池取出复用时清掉攻击/受击动画边沿，避免上一任单位的残帧 */
  resetAnimState(): void {
    this.wasAttacking = false;
    this.strikeUntil = 0;
    this.hitUntil = 0;
    this.shakeUntil = 0;
    this.aoeHitFlash = false;
    this.wasCasting = false;
    this.castAnimStartedAt = 0;
    this.lastHpRatio = 1;
    this.displayedHpRatio = -1;
    this.displayedInspired = false;
    this.displayedProtectAlert = null;
    this.inspireAura.visible = false;
    if (this.castFx) this.castFx.visible = false;
    this.applyHitTint(0);
  }

  dispose(): void {
    // 精灵贴图共享、几何体共享，只销毁本视图克隆的材质
    this.spriteMaterials?.front.dispose();
    this.spriteMaterials?.back.dispose();
    this.garrisonMaterials?.front.dispose();
    this.garrisonMaterials?.back.dispose();
    for (const layer of this.castLayers) {
      layer.material.map?.dispose();
      layer.material.dispose();
    }

    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // 精灵面片、软阴影、施法序列帧用的是全局共享几何，不能跟着单个视图销毁
      if (
        object === this.sprite
        || this.garrisonSprites.includes(object)
        || object.geometry === BLOB_SHADOW_GEOMETRY
      ) {
        return;
      }
      if (this.castLayers.some((layer) => layer.mesh === object)) return;
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

/**
 * 把仿真阵营映射成画面阵营：己方永远按蓝方皮，对阵方按红方皮。
 * 与顶部 HUD「己方蓝 / 对阵红」一致，避免红方视角下近端主堡仍是红屋顶。
 */
export function visualFaction(simFaction: Faction, localFaction: Faction): Faction {
  return simFaction === localFaction ? Faction.Blue : Faction.Red;
}

function bodyColor(faction: Faction, typeId: UnitTypeId): number {
  if (faction === Faction.Blue) {
    if (typeId === 'melee_grunt' || typeId === 'melee_guard') return 0x3f7ae0;
    if (typeId === 'melee_cavalry') return 0x1f9d8a;
    return 0x74b7f7;
  }
  if (typeId === 'melee_grunt' || typeId === 'melee_guard') return 0xd9503f;
  if (typeId === 'melee_cavalry') return 0xc47a2b;
  return 0xf5926a;
}

/** 画面己方（蓝皮）用绿色，对阵方用红色；颜色跟仿真阵营无关，只看映射后的画面阵营。 */
function hpColor(faction: Faction): number {
  return faction === Faction.Blue ? 0x63d68a : 0xf2604f;
}

/** 前景相对底条朝相机方向的偏移，拉开深度差减轻远距 Z-fighting */
const HP_FILL_Z = 0.05;
/** 与 HUD `.battle-hp-protect-mark` 同色，方便对照保护线位置。 */
const HP_PROTECT_MARK_COLOR = 0xf4d27a;
/** 血量跌破保护线后略提亮，对应 HUD track 的 is-protect 描边。 */
const HP_PROTECT_MARK_ALERT = 0xffe9a8;
/** 左右/正背判定的滞回阈值，避免接近侧向时因微小朝向变化频繁换图 */
const DIRECTION_HYSTERESIS = 0.12;
/** 每帧复用的相机右向量，避免多单位更新时产生临时对象 */
const CAMERA_RIGHT = new THREE.Vector3();
const WHITE_COLOR = new THREE.Color(0xffffff);
const HIT_FLASH_COLOR = new THREE.Color(0xff3a3a);
/** 炸弹兵引信警示色：偏橙，区别于普通受击闪红 */
const DETONATE_FLASH_COLOR = new THREE.Color(0xff6a18);
/** 受击 tint 插值临时色，避免每帧 new Color */
const HIT_TINT_COLOR = new THREE.Color();
/** 飞行单位轻微浮动参数；基准离地高度与 sim 弹道出生点共用 AIR_UNIT_HOVER_HEIGHT。 */
const AIR_HOVER_AMPLITUDE = 0.08;
const AIR_HOVER_SPEED = 2.2;
