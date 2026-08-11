import * as THREE from 'three';
import { Faction, type ProjectileVisual, type Snapshot, type UnitSnapshot } from '@pb/sim';
import { toSceneFacingZ, toSceneX, toSceneZ } from './coords.js';
import { UnitView, viewKey } from './unitView.js';
import { HealEffectView } from './healEffectView.js';
import { AoePulseEffectView } from './aoePulseEffectView.js';
import { ExplosionEffectView } from './explosionEffectView.js';

const PROJECTILE_GEOMETRY = new THREE.SphereGeometry(0.13, 10, 8);
const PROJECTILE_MATERIALS: Record<number, THREE.MeshStandardMaterial> = {
  [Faction.Blue]: new THREE.MeshStandardMaterial({ color: 0xa8d8ff, emissive: 0x4f8dfd, emissiveIntensity: 0.9 }),
  [Faction.Red]: new THREE.MeshStandardMaterial({ color: 0xffd0b0, emissive: 0xf2604f, emissiveIntensity: 0.9 }),
};

/** 炸弹弹体贴图面片：底边不锚地，中心对齐弹道高度点 */
const BOMB_PROJECTILE_ASPECT = 138 / 215;
const BOMB_PROJECTILE_HEIGHT = 0.55;
const BOMB_PROJECTILE_GEOMETRY = new THREE.PlaneGeometry(
  BOMB_PROJECTILE_HEIGHT * BOMB_PROJECTILE_ASPECT,
  BOMB_PROJECTILE_HEIGHT,
);
let bombProjectileMaterial: THREE.MeshBasicMaterial | null = null;

/** 箭矢贴图：原图竖直朝上（局部 +Y 为箭头尖），飞行时对齐弹道方向 */
const ARROW_PROJECTILE_ASPECT = 35 / 120;
const ARROW_PROJECTILE_LENGTH = 0.72;
const ARROW_PROJECTILE_GEOMETRY = new THREE.PlaneGeometry(
  ARROW_PROJECTILE_LENGTH * ARROW_PROJECTILE_ASPECT,
  ARROW_PROJECTILE_LENGTH,
);
let arrowProjectileMaterial: THREE.MeshBasicMaterial | null = null;

const _arrowDir = new THREE.Vector3();
const _arrowToCam = new THREE.Vector3();
const _arrowSide = new THREE.Vector3();
const _arrowNormal = new THREE.Vector3();
const _arrowBasis = new THREE.Matrix4();

/** 懒加载共享炸弹材质；测试环境无 DOM 时给占位不可见图 */
function getBombProjectileMaterial(): THREE.MeshBasicMaterial {
  if (bombProjectileMaterial) return bombProjectileMaterial;
  bombProjectileMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    visible: false,
  });
  // Node 测试无 DOM，保持隐藏占位即可
  if (typeof document === 'undefined') return bombProjectileMaterial;
  const texture = new THREE.TextureLoader().load('projectiles/bomb.png', (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.magFilter = THREE.NearestFilter;
    if (bombProjectileMaterial) {
      bombProjectileMaterial.visible = true;
      bombProjectileMaterial.needsUpdate = true;
    }
  });
  bombProjectileMaterial.map = texture;
  return bombProjectileMaterial;
}

/** 懒加载共享箭矢材质；测试环境无 DOM 时给占位不可见图 */
function getArrowProjectileMaterial(): THREE.MeshBasicMaterial {
  if (arrowProjectileMaterial) return arrowProjectileMaterial;
  arrowProjectileMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    visible: false,
  });
  if (typeof document === 'undefined') return arrowProjectileMaterial;
  const texture = new THREE.TextureLoader().load('projectiles/arrow.png', (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.magFilter = THREE.NearestFilter;
    if (arrowProjectileMaterial) {
      arrowProjectileMaterial.visible = true;
      arrowProjectileMaterial.needsUpdate = true;
    }
  });
  arrowProjectileMaterial.map = texture;
  return arrowProjectileMaterial;
}

/**
 * 箭头尖对齐飞行方向，面片尽量朝向相机，避免俯视/斜视时变成一条线。
 * 坐标均为场景空间 (x, height, z)。
 */
function orientArrowMesh(
  mesh: THREE.Mesh,
  fromX: number,
  fromH: number,
  fromZ: number,
  toX: number,
  toH: number,
  toZ: number,
  camera: THREE.Camera,
): void {
  _arrowDir.set(toX - fromX, toH - fromH, toZ - fromZ);
  if (_arrowDir.lengthSq() < 1e-8) {
    // 首帧前后快照重合时复用上次朝向，避免箭尖乱转
    const last = mesh.userData.lastArrowDir as THREE.Vector3 | undefined;
    if (last && last.lengthSq() > 1e-8) _arrowDir.copy(last);
    else {
      mesh.quaternion.copy(camera.quaternion);
      return;
    }
  }
  _arrowDir.normalize();
  const cached = mesh.userData.lastArrowDir as THREE.Vector3 | undefined;
  if (cached) cached.copy(_arrowDir);
  else mesh.userData.lastArrowDir = _arrowDir.clone();
  _arrowToCam.subVectors(camera.position, mesh.position);
  _arrowSide.crossVectors(_arrowDir, _arrowToCam);
  if (_arrowSide.lengthSq() < 1e-8) {
    _arrowSide.set(1, 0, 0).cross(_arrowDir);
    if (_arrowSide.lengthSq() < 1e-8) _arrowSide.set(0, 0, 1).cross(_arrowDir);
  }
  _arrowSide.normalize();
  _arrowNormal.crossVectors(_arrowSide, _arrowDir).normalize();
  // PlaneGeometry：局部 +Y 为图上箭头尖，+Z 为法线
  _arrowBasis.makeBasis(_arrowSide, _arrowDir, _arrowNormal);
  mesh.quaternion.setFromRotationMatrix(_arrowBasis);
}

/**
 * 把 sim 快照同步到场景对象。
 *
 * 逻辑帧只有 20 fps，画面是 60 fps，所以每帧都在前后两个快照之间插值，
 * 否则单位会一顿一顿地跳。插值只影响画面，不会回写任何 sim 状态。
 */
export class BattleView {
  private readonly scene: THREE.Scene;
  private readonly activeUnits = new Map<number, UnitView>();
  private readonly unitPool = new Map<string, UnitView[]>();
  private readonly activeProjectiles = new Map<number, THREE.Mesh>();
  private readonly orbProjectilePool: THREE.Mesh[] = [];
  private readonly bombProjectilePool: THREE.Mesh[] = [];
  private readonly arrowProjectilePool: THREE.Mesh[] = [];
  private readonly activeHealEffects = new Map<number, HealEffectView>();
  private readonly healEffectPool: HealEffectView[] = [];
  private readonly activeAoePulses = new Map<number, AoePulseEffectView>();
  private readonly aoePulsePool: AoePulseEffectView[] = [];
  private readonly activeExplosions = new Map<number, ExplosionEffectView>();
  private readonly explosionPool: ExplosionEffectView[] = [];

  private readonly prevUnits = new Map<number, UnitSnapshot>();
  private prevUnitsTick = -1;
  private readonly seen = new Set<number>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  render(prev: Snapshot, curr: Snapshot, alpha: number, camera: THREE.Camera): void {
    this.syncPrevIndex(prev);
    this.renderUnits(curr, alpha, camera);
    this.renderProjectiles(prev, curr, alpha, camera);
    this.renderHealEffects(curr);
    this.renderAoePulses(curr);
    this.renderExplosions(curr, camera);
  }

  /** 快照换了才重建索引，同一逻辑帧内的多次渲染直接复用 */
  private syncPrevIndex(prev: Snapshot): void {
    if (this.prevUnitsTick === prev.tick) return;
    this.prevUnitsTick = prev.tick;
    this.prevUnits.clear();
    for (const unit of prev.units) this.prevUnits.set(unit.id, unit);
  }

  private renderUnits(curr: Snapshot, alpha: number, camera: THREE.Camera): void {
    this.seen.clear();
    // 程序动画的时钟。用真实时间而不是逻辑 tick，20fps 的逻辑帧下动作依然是 60fps 平滑的
    const timeSec = performance.now() * 0.001;

    for (const unit of curr.units) {
      this.seen.add(unit.id);
      let view = this.activeUnits.get(unit.id);
      if (!view) {
        view = this.obtainUnitView(unit);
        this.activeUnits.set(unit.id, view);
        this.scene.add(view.group);
      }

      // 逻辑血量下降时闪红；同 tick 内 hpRatio 不变，不会每渲染帧重复触发
      if (unit.hpRatio < view.lastHpRatio) view.flashHit(timeSec, unit.aoeHit);
      view.lastHpRatio = unit.hpRatio;

      // 刚出场的单位在上一帧不存在，直接用当前值，不然会从原点飞过来
      const from = this.prevUnits.get(unit.id) ?? unit;
      view.update(
        toSceneX(lerp(from.x, unit.x, alpha)),
        toSceneZ(lerp(from.y, unit.y, alpha)),
        lerp(from.facingX, unit.facingX, alpha),
        toSceneFacingZ(lerp(from.facingY, unit.facingY, alpha)),
        lerp(from.hpRatio, unit.hpRatio, alpha),
        unit.level,
        unit.state,
        unit.attacking,
        unit.charging,
        unit.inspired,
        unit.casting,
        timeSec,
        camera,
      );
    }

    for (const [id, view] of this.activeUnits) {
      if (this.seen.has(id)) continue;
      this.scene.remove(view.group);
      this.activeUnits.delete(id);
      this.pushPool(this.unitPool, view.key, view);
    }
  }

  /** 将模拟层的短寿命治疗事件同步为可池化的扩散光环。 */
  private renderHealEffects(curr: Snapshot): void {
    this.seen.clear();
    for (const effect of curr.healEffects) {
      this.seen.add(effect.id);
      let view = this.activeHealEffects.get(effect.id);
      if (!view) {
        view = this.healEffectPool.pop() ?? new HealEffectView();
        this.activeHealEffects.set(effect.id, view);
        this.scene.add(view.group);
      }
      view.update(effect);
    }
    for (const [id, view] of this.activeHealEffects) {
      if (this.seen.has(id)) continue;
      this.scene.remove(view.group);
      this.activeHealEffects.delete(id);
      this.healEffectPool.push(view);
    }
  }

  /** 将普攻整圆 / 冲刺扇形脉冲同步到场景。 */
  private renderAoePulses(curr: Snapshot): void {
    this.seen.clear();
    for (const effect of curr.aoePulseEffects) {
      this.seen.add(effect.id);
      let view = this.activeAoePulses.get(effect.id);
      if (!view) {
        view = this.aoePulsePool.pop() ?? new AoePulseEffectView();
        this.activeAoePulses.set(effect.id, view);
        this.scene.add(view.group);
      }
      view.update(effect);
    }
    for (const [id, view] of this.activeAoePulses) {
      if (this.seen.has(id)) continue;
      this.scene.remove(view.group);
      this.activeAoePulses.delete(id);
      this.aoePulsePool.push(view);
    }
  }

  /** 将炸弹兵爆炸序列帧同步到场景。 */
  private renderExplosions(curr: Snapshot, camera: THREE.Camera): void {
    this.seen.clear();
    for (const effect of curr.explosionEffects) {
      this.seen.add(effect.id);
      let view = this.activeExplosions.get(effect.id);
      if (!view) {
        view = this.explosionPool.pop() ?? new ExplosionEffectView();
        this.activeExplosions.set(effect.id, view);
        this.scene.add(view.group);
      }
      view.update(effect, camera);
    }
    for (const [id, view] of this.activeExplosions) {
      if (this.seen.has(id)) continue;
      this.scene.remove(view.group);
      this.activeExplosions.delete(id);
      view.reset();
      this.explosionPool.push(view);
    }
  }

  private renderProjectiles(
    prev: Snapshot,
    curr: Snapshot,
    alpha: number,
    camera: THREE.Camera,
  ): void {
    this.seen.clear();

    for (const projectile of curr.projectiles) {
      this.seen.add(projectile.id);
      const visual: ProjectileVisual = projectile.visual ?? 'orb';
      let mesh = this.activeProjectiles.get(projectile.id);
      // 外观变更时换池重建，避免彩色球 / 炸弹 / 箭矢互相污染
      if (mesh && mesh.userData.visual !== visual) {
        this.scene.remove(mesh);
        this.activeProjectiles.delete(projectile.id);
        this.releaseProjectileMesh(mesh);
        mesh = undefined;
      }
      if (!mesh) {
        mesh = this.obtainProjectileMesh(visual);
        this.activeProjectiles.set(projectile.id, mesh);
        this.scene.add(mesh);
      }
      if (visual === 'orb') {
        mesh.material = PROJECTILE_MATERIALS[projectile.faction]!;
      }

      const from = prev.projectiles.find((p) => p.id === projectile.id) ?? projectile;
      const fromX = toSceneX(from.x);
      const fromH = from.height;
      const fromZ = toSceneZ(from.y);
      const toX = toSceneX(projectile.x);
      const toH = projectile.height;
      const toZ = toSceneZ(projectile.y);
      mesh.position.set(
        lerp(fromX, toX, alpha),
        lerp(fromH, toH, alpha),
        lerp(fromZ, toZ, alpha),
      );
      // 炸弹面片始终朝向相机；箭矢尖对齐飞行方向并尽量面向镜头
      if (visual === 'bomb') mesh.quaternion.copy(camera.quaternion);
      else if (visual === 'arrow') {
        orientArrowMesh(mesh, fromX, fromH, fromZ, toX, toH, toZ, camera);
      }
    }

    for (const [id, mesh] of this.activeProjectiles) {
      if (this.seen.has(id)) continue;
      this.scene.remove(mesh);
      this.activeProjectiles.delete(id);
      this.releaseProjectileMesh(mesh);
    }
  }

  /** 按弹道外观取池化网格；炸弹/箭矢用贴图面片，其余用阵营色球 */
  private obtainProjectileMesh(visual: ProjectileVisual): THREE.Mesh {
    if (visual === 'bomb') {
      const mesh = this.bombProjectilePool.pop() ?? new THREE.Mesh(BOMB_PROJECTILE_GEOMETRY);
      mesh.material = getBombProjectileMaterial();
      mesh.userData.visual = 'bomb';
      return mesh;
    }
    if (visual === 'arrow') {
      const mesh = this.arrowProjectilePool.pop() ?? new THREE.Mesh(ARROW_PROJECTILE_GEOMETRY);
      mesh.material = getArrowProjectileMaterial();
      mesh.userData.visual = 'arrow';
      return mesh;
    }
    const mesh = this.orbProjectilePool.pop() ?? new THREE.Mesh(PROJECTILE_GEOMETRY);
    mesh.userData.visual = 'orb';
    return mesh;
  }

  /** 按 userData.visual 归还到对应对象池 */
  private releaseProjectileMesh(mesh: THREE.Mesh): void {
    if (mesh.userData.visual === 'bomb') this.bombProjectilePool.push(mesh);
    else if (mesh.userData.visual === 'arrow') {
      mesh.userData.lastArrowDir = undefined;
      this.arrowProjectilePool.push(mesh);
    } else this.orbProjectilePool.push(mesh);
  }

  private obtainUnitView(unit: UnitSnapshot): UnitView {
    const key = viewKey(unit.faction, unit.typeId);
    const pooled = this.unitPool.get(key);
    const reused = pooled?.pop();
    let view: UnitView;
    if (reused) {
      reused.resetAnimState();
      view = reused;
    } else {
      view = new UnitView(unit.faction, unit.typeId);
    }
    // 出场对齐当前血量，避免首帧被当成「掉血」误闪红
    view.lastHpRatio = unit.hpRatio;
    return view;
  }

  private pushPool(pool: Map<string, UnitView[]>, key: string, view: UnitView): void {
    const bucket = pool.get(key);
    if (bucket) bucket.push(view);
    else pool.set(key, [view]);
  }

  /** 清空战场时调用，把场景对象全部收回池子 */
  reset(): void {
    for (const [id, view] of this.activeUnits) {
      this.scene.remove(view.group);
      this.activeUnits.delete(id);
      this.pushPool(this.unitPool, view.key, view);
    }
    for (const [id, mesh] of this.activeProjectiles) {
      this.scene.remove(mesh);
      this.activeProjectiles.delete(id);
      this.releaseProjectileMesh(mesh);
    }
    for (const [id, view] of this.activeHealEffects) {
      this.scene.remove(view.group);
      this.activeHealEffects.delete(id);
      this.healEffectPool.push(view);
    }
    for (const [id, view] of this.activeAoePulses) {
      this.scene.remove(view.group);
      this.activeAoePulses.delete(id);
      this.aoePulsePool.push(view);
    }
    for (const [id, view] of this.activeExplosions) {
      this.scene.remove(view.group);
      this.activeExplosions.delete(id);
      view.reset();
      this.explosionPool.push(view);
    }
    this.prevUnits.clear();
    this.prevUnitsTick = -1;
  }

  /**
   * 兵种半径等视觉参数变了之后调用。
   * 池里缓存的圆柱是按旧半径建的，必须整批丢掉，否则新兵会穿旧壳。
   */
  invalidateUnitViews(): void {
    for (const [, view] of this.activeUnits) {
      this.scene.remove(view.group);
    }
    this.activeUnits.clear();
    this.unitPool.clear();
    for (const [, mesh] of this.activeProjectiles) {
      this.scene.remove(mesh);
      this.releaseProjectileMesh(mesh);
    }
    this.activeProjectiles.clear();
    for (const [id, view] of this.activeHealEffects) {
      this.scene.remove(view.group);
      this.activeHealEffects.delete(id);
      this.healEffectPool.push(view);
    }
    this.activeHealEffects.clear();
    for (const [id, view] of this.activeAoePulses) {
      this.scene.remove(view.group);
      this.activeAoePulses.delete(id);
      this.aoePulsePool.push(view);
    }
    this.activeAoePulses.clear();
    for (const [id, view] of this.activeExplosions) {
      this.scene.remove(view.group);
      this.activeExplosions.delete(id);
      view.reset();
      this.explosionPool.push(view);
    }
    this.activeExplosions.clear();
    this.prevUnits.clear();
    this.prevUnitsTick = -1;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
