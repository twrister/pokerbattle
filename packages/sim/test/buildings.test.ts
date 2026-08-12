import { describe, expect, it } from 'vitest';
import { getUnitConfig } from '../src/config/units.js';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { buildingCellRange, snapBuildingCenter } from '../src/nav/buildingGrid.js';
import { CommandKind, placeBuildingCommand } from '../src/commands.js';
import { World } from '../src/world.js';

describe('建筑系统', () => {
  it('偶数足迹吸附到格线交点，奇数吸附到格心', () => {
    expect(snapBuildingCenter(9.4, 4)).toBe(9);
    expect(snapBuildingCenter(9.6, 4)).toBe(10);
    expect(snapBuildingCenter(9.1, 3)).toBe(9.5);
    expect(snapBuildingCenter(9.9, 3)).toBe(9.5);
  });

  it('占地半开区间与足迹一致', () => {
    expect(buildingCellRange(9, 16, 4)).toEqual({ minX: 7, minY: 14, maxX: 11, maxY: 18 });
    expect(buildingCellRange(9, 16, 2)).toEqual({ minX: 8, minY: 15, maxX: 10, maxY: 17 });
  });

  it('放置基地后占地内不可走，边界外可走', () => {
    const world = new World(1);
    const base = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(16));
    expect(base).not.toBeNull();
    // 占地 [7,11)×[14,18)，中心与内部应阻挡
    expect(world.nav.isBlockedAt(fromFloat(9), fromFloat(16))).toBe(true);
    expect(world.nav.isBlockedAt(fromFloat(7.1), fromFloat(14.1))).toBe(true);
    // 边界外一格可走
    expect(world.nav.isBlockedAt(fromFloat(6.5), fromFloat(16))).toBe(false);
    expect(world.nav.isBlockedAt(fromFloat(11.1), fromFloat(16))).toBe(false);
  });

  it('建筑重叠放置被拒绝', () => {
    const world = new World(1);
    expect(world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(16))).not.toBeNull();
    expect(world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(10), fromFloat(16))).toBeNull();
    expect(world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(14), fromFloat(16))).not.toBeNull();
  });

  it('放置建筑会把区域内单位挤出矩形', () => {
    const world = new World(1);
    const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(16));
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(16));

    const half = 2;
    const r = toFloat(unit.config.radius);
    const x = toFloat(unit.pos.x);
    const y = toFloat(unit.pos.y);
    // 圆心应在 [7,11]×[14,18] 扩大半径后的外侧（贴边）
    const insideX = x > 7 - r && x < 11 + r;
    const insideY = y > 14 - r && y < 18 + r;
    // 至少有一个轴向已被推到边界外（严格说圆心不应再深入内部）
    const deeplyInside = x > 7 && x < 11 && y > 14 && y < 18;
    expect(deeplyInside).toBe(false);
    expect(insideX || insideY).toBe(true);
    void half;
  });

  it('建筑死亡后解除寻路阻挡', () => {
    const world = new World(1);
    const base = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(16))!;
    expect(world.nav.isBlockedAt(fromFloat(9), fromFloat(16))).toBe(true);
    base.hp = 0;
    world.step();
    expect(world.getUnit(base.id)).toBeUndefined();
    expect(world.nav.isBlockedAt(fromFloat(9), fromFloat(16))).toBe(false);
  });

  it('PlaceBuilding 指令与同 seed 跑法 hash 一致', () => {
    const run = (): number => {
      const world = new World(42);
      world.step([
        placeBuildingCommand(Faction.Blue, 'building_tower', fromFloat(8.2), fromFloat(10.7)),
        placeBuildingCommand(Faction.Red, 'building_base', fromFloat(9.1), fromFloat(22.4)),
      ]);
      for (let i = 0; i < 30; i++) world.step();
      return world.hash();
    };
    expect(run()).toBe(run());
  });

  it('越界 PlaceBuilding 指令被静默丢弃', () => {
    const world = new World(1);
    world.step([placeBuildingCommand(Faction.Blue, 'building_base', fromFloat(1), fromFloat(1))]);
    expect(world.units.length).toBe(0);
    expect(CommandKind.PlaceBuilding).toBe(1);
  });

  it('近战贴基地四角可进入攻击并造成伤害', () => {
    // 占地 [7,11)×[14,18)，四角外侧（碰撞圆贴角）
    const corners: ReadonlyArray<readonly [number, number]> = [
      [6.6, 13.6],
      [11.4, 13.6],
      [6.6, 18.4],
      [11.4, 18.4],
    ];
    for (const [x, y] of corners) {
      const world = new World(1);
      const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(16))!;
      const hp0 = base.hp;
      const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(x), fromFloat(y));
      for (let i = 0; i < 60; i++) world.step();
      expect(unit.state, `corner (${x},${y}) should Attack`).toBe(UnitState.Attack);
      expect(base.hp, `corner (${x},${y}) should deal damage`).toBeLessThan(hp0);
    }
  });

  it('远程从对角方向接近基地可进入攻击并造成伤害', () => {
    // 来自东南/西南等对角，易分到对角攻击环槽；修复前会停在射程外永久 Seek
    const approaches: ReadonlyArray<readonly [number, number]> = [
      [14, 11],
      [4, 11],
      [14, 21],
      [4, 21],
    ];
    for (const [x, y] of approaches) {
      const world = new World(1);
      const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(16))!;
      const hp0 = base.hp;
      const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(x), fromFloat(y));
      for (let i = 0; i < 400; i++) world.step();
      expect(archer.state, `approach (${x},${y}) should Attack`).toBe(UnitState.Attack);
      expect(base.hp, `approach (${x},${y}) should deal damage`).toBeLessThan(hp0);
    }
  });

  it('左侧偏南接近建筑时攻击站位不翻到建筑右侧', () => {
    // 复现：主槽偏南时 id%3 邻位曾把左侧弓手摊到东南槽，绕到建筑右方才开火
    const world = new World(1);
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(29))!;
    // 再占一个 id，使弓手 id%3===0（邻位 offset=-1），与线上复现一致
    world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(4), fromFloat(4));
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(14.3));
    expect(archer.id % 3).toBe(0);

    for (let i = 0; i < 20; i++) world.step();
    expect(archer.targetId).toBe(base.id);
    expect(archer.engageSlot).toBeGreaterThanOrEqual(0);
    // 槽位方向不得指向建筑右侧（+X）
    const slot = archer.engageSlot;
    // 3=+X-Y, 2=+X, 1=+X+Y 均为右侧半区
    expect([1, 2, 3].includes(slot), `slot ${slot} should stay left/south`).toBe(false);

    for (let i = 0; i < 500; i++) world.step();
    expect(archer.state).toBe(UnitState.Attack);
    expect(toFloat(archer.pos.x)).toBeLessThanOrEqual(toFloat(base.pos.x));
  });

  it('防御塔在射程内以投射物攻击敌军', () => {
    const world = new World(1);
    // 塔占地 2，中心 (8,10)；敌军放在射程内正北
    const tower = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(8), fromFloat(10))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(14));
    const hp0 = enemy.hp;
    for (let i = 0; i < 80; i++) world.step();
    expect(tower.state).toBe(UnitState.Attack);
    expect(enemy.hp).toBeLessThan(hp0);
  });

  it('高级箭塔数值高于普通箭塔且可放置', () => {
    const advanced = getUnitConfig('building_tower_advanced');
    const basic = getUnitConfig('building_tower');
    expect(advanced.name).toBe('高级箭塔');
    expect(toFloat(advanced.maxHp)).toBe(3000);
    expect(toFloat(advanced.damage)).toBe(150);
    expect(toFloat(advanced.attackInterval)).toBe(7);
    expect(toFloat(advanced.maxHp)).toBeGreaterThan(toFloat(basic.maxHp));
    expect(toFloat(advanced.damage)).toBeGreaterThan(toFloat(basic.damage));
    expect(toFloat(advanced.attackInterval)).toBeLessThan(toFloat(basic.attackInterval));

    const world = new World(1);
    const tower = world.spawnBuilding(
      Faction.Blue,
      'building_tower_advanced',
      fromFloat(8),
      fromFloat(10),
    );
    expect(tower).not.toBeNull();
    expect(tower!.config.id).toBe('building_tower_advanced');
  });

  it('基地在射程内以投射物攻击敌军（同 1 级箭塔）', () => {
    const world = new World(1);
    // 基地占地 4，中心 (9,16)；敌军放在射程内正西
    const base = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(16))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(6.5), fromFloat(16));
    const hp0 = enemy.hp;
    for (let i = 0; i < 80; i++) world.step();
    expect(base.state).toBe(UnitState.Attack);
    expect(enemy.hp).toBeLessThan(hp0);
  });
});
