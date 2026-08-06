import { toFloat } from './math/fixed.js';
import type { UnitTypeId } from './config/units.js';
import { UnitState, type Faction } from './entity/unit.js';
import type { World } from './world.js';

/**
 * 给渲染层看的只读世界切片。
 *
 * 这里是定点数与浮点数的唯一边界：越过这层之后随便用 float 做插值和三角函数，
 * 反过来渲染层拿不到任何 sim 内部对象的引用，不可能误改世界状态。
 */
export interface UnitSnapshot {
  id: number;
  typeId: UnitTypeId;
  faction: Faction;
  state: UnitState;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  radius: number;
  hpRatio: number;
  /** 正在出手前摇，渲染层可以据此播放攻击动作 */
  attacking: boolean;
  /** 骑兵冲刺中，渲染层可以提高高亮 */
  charging: boolean;
}

export interface ProjectileSnapshot {
  id: number;
  faction: Faction;
  x: number;
  y: number;
}

export interface Snapshot {
  tick: number;
  units: UnitSnapshot[];
  projectiles: ProjectileSnapshot[];
}

export function takeSnapshot(world: World): Snapshot {
  const units: UnitSnapshot[] = [];
  for (const unit of world.units) {
    if (unit.dead) continue;
    units.push({
      id: unit.id,
      typeId: unit.typeId,
      faction: unit.faction,
      state: unit.state,
      x: toFloat(unit.pos.x),
      y: toFloat(unit.pos.y),
      facingX: toFloat(unit.facing.x),
      facingY: toFloat(unit.facing.y),
      radius: toFloat(unit.config.radius),
      hpRatio: unit.stats.maxHp > 0 ? toFloat(unit.hp) / toFloat(unit.stats.maxHp) : 0,
      attacking: unit.windupLeft > 0,
      charging: unit.state === UnitState.Charge,
    });
  }

  const projectiles: ProjectileSnapshot[] = [];
  for (const p of world.projectiles) {
    if (p.dead) continue;
    projectiles.push({ id: p.id, faction: p.faction, x: toFloat(p.pos.x), y: toFloat(p.pos.y) });
  }

  return { tick: world.tick, units, projectiles };
}

/** 空快照，供渲染层在第一帧之前占位 */
export function emptySnapshot(): Snapshot {
  return { tick: 0, units: [], projectiles: [] };
}
