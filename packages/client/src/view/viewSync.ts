import * as THREE from 'three';
import { Faction, type Snapshot, type UnitSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';
import { UnitView, viewKey } from './unitView.js';

const PROJECTILE_GEOMETRY = new THREE.SphereGeometry(0.13, 10, 8);
const PROJECTILE_MATERIALS: Record<number, THREE.MeshStandardMaterial> = {
  [Faction.Blue]: new THREE.MeshStandardMaterial({ color: 0xa8d8ff, emissive: 0x4f8dfd, emissiveIntensity: 0.9 }),
  [Faction.Red]: new THREE.MeshStandardMaterial({ color: 0xffd0b0, emissive: 0xf2604f, emissiveIntensity: 0.9 }),
};

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
  private readonly projectilePool: THREE.Mesh[] = [];

  private readonly prevUnits = new Map<number, UnitSnapshot>();
  private prevUnitsTick = -1;
  private readonly seen = new Set<number>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  render(prev: Snapshot, curr: Snapshot, alpha: number, camera: THREE.Camera): void {
    this.syncPrevIndex(prev);
    this.renderUnits(curr, alpha, camera);
    this.renderProjectiles(prev, curr, alpha);
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

    for (const unit of curr.units) {
      this.seen.add(unit.id);
      let view = this.activeUnits.get(unit.id);
      if (!view) {
        view = this.obtainUnitView(unit);
        this.activeUnits.set(unit.id, view);
        this.scene.add(view.group);
      }

      // 刚出场的单位在上一帧不存在，直接用当前值，不然会从原点飞过来
      const from = this.prevUnits.get(unit.id) ?? unit;
      view.update(
        toSceneX(lerp(from.x, unit.x, alpha)),
        toSceneZ(lerp(from.y, unit.y, alpha)),
        lerp(from.facingX, unit.facingX, alpha),
        lerp(from.facingY, unit.facingY, alpha),
        lerp(from.hpRatio, unit.hpRatio, alpha),
        unit.attacking,
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

  private renderProjectiles(prev: Snapshot, curr: Snapshot, alpha: number): void {
    this.seen.clear();

    for (const projectile of curr.projectiles) {
      this.seen.add(projectile.id);
      let mesh = this.activeProjectiles.get(projectile.id);
      if (!mesh) {
        mesh = this.projectilePool.pop() ?? new THREE.Mesh(PROJECTILE_GEOMETRY);
        this.activeProjectiles.set(projectile.id, mesh);
        this.scene.add(mesh);
      }
      mesh.material = PROJECTILE_MATERIALS[projectile.faction]!;

      const from = prev.projectiles.find((p) => p.id === projectile.id) ?? projectile;
      mesh.position.set(
        toSceneX(lerp(from.x, projectile.x, alpha)),
        0.9,
        toSceneZ(lerp(from.y, projectile.y, alpha)),
      );
    }

    for (const [id, mesh] of this.activeProjectiles) {
      if (this.seen.has(id)) continue;
      this.scene.remove(mesh);
      this.activeProjectiles.delete(id);
      this.projectilePool.push(mesh);
    }
  }

  private obtainUnitView(unit: UnitSnapshot): UnitView {
    const key = viewKey(unit.faction, unit.typeId);
    const pooled = this.unitPool.get(key);
    const reused = pooled?.pop();
    return reused ?? new UnitView(unit.faction, unit.typeId);
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
      this.projectilePool.push(mesh);
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
      this.projectilePool.push(mesh);
    }
    this.activeProjectiles.clear();
    this.prevUnits.clear();
    this.prevUnitsTick = -1;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
