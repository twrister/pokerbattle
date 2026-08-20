import { describe, expect, it } from 'vitest';
import {
  applyUnitConfigDrafts,
  dumpUnitConfigDrafts,
  getUnitConfig,
  resetUnitConfigsToDefault,
  toUnitConfigDraft,
} from '../src/config/units.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { dist } from '../src/math/vec2.js';
import { World } from '../src/world.js';

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe('冲锋战车', () => {
  it('加载指定基础参数、优先打建筑与阵亡生成配置', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(8), fromFloat(8));

    expect(wagon.config.name).toBe('冲锋战车');
    expect(toFloat(wagon.config.radius)).toBeCloseTo(0.8, 3);
    expect(toFloat(wagon.config.bodyScale)).toBeCloseTo(1.2, 3);
    expect(toFloat(wagon.config.mass)).toBeCloseTo(3, 3);
    expect(toFloat(wagon.stats.maxHp)).toBeCloseTo(1100, 3);
    expect(toFloat(wagon.stats.damage)).toBeCloseTo(80, 3);
    expect(toFloat(wagon.stats.attackInterval)).toBeCloseTo(20, 3);
    expect(toFloat(wagon.stats.attackWindup)).toBeCloseTo(7, 3);
    expect(toFloat(wagon.stats.range)).toBeCloseTo(1, 3);
    expect(toFloat(wagon.stats.moveSpeed)).toBeCloseTo(1.2, 3);
    expect(toFloat(wagon.config.sightRange)).toBeCloseTo(40, 3);
    expect(wagon.config.movementLayer).toBe('ground');
    expect(wagon.config.canAttackAir).toBe(false);
    expect(wagon.config.preferBuildings).toBe(true);
    expect(wagon.config.targetsBuildingsOnly).toBe(false);
    expect(wagon.config.attack.kind).toBe('melee');
    expect(wagon.config.deathSpawn?.entries).toEqual([{ unitTypeId: 'melee_grunt', count: 4 }]);

    const draft = toUnitConfigDraft(getUnitConfig('melee_charge_wagon'));
    expect(draft.preferBuildings).toBe(true);
    expect(draft.targetsBuildingsOnly).toBeUndefined();
    expect(draft.deathSpawn).toEqual({ entries: [{ unitTypeId: 'melee_grunt', count: 4 }] });
    expect(toUnitConfigDraft(getUnitConfig('melee_grunt')).preferBuildings).toBeUndefined();
    expect(toUnitConfigDraft(getUnitConfig('melee_grunt')).deathSpawn).toBeUndefined();
  });

  it('同时有民兵与箭塔时只锁箭塔', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(5), fromFloat(10));
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(6), fromFloat(10));
    const tower = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(8), fromFloat(10));
    expect(tower).not.toBeNull();
    wagon.retargetIn = 0;

    run(world, 1);
    expect(wagon.targetId).toBe(tower!.id);
    expect(wagon.targetId).not.toBe(grunt.id);
  });

  it('无敌方建筑时锁定近身民兵并可攻击', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(8), fromFloat(10));
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    wagon.retargetIn = 0;

    run(world, 1);
    expect(wagon.targetId).toBe(grunt.id);

    run(world, 12);
    expect(grunt.hp).toBeLessThan(grunt.stats.maxHp);
  });

  it('打民兵粘性中出现箭塔应换火到塔', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(5), fromFloat(10));
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(6), fromFloat(10));
    wagon.retargetIn = 0;

    run(world, 1);
    expect(wagon.targetId).toBe(grunt.id);

    const tower = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(10), fromFloat(10));
    expect(tower).not.toBeNull();
    run(world, 1);
    expect(wagon.targetId).toBe(tower!.id);
    expect(wagon.targetId).not.toBe(grunt.id);
  });

  it('追建筑时近身民兵不打断', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(5), fromFloat(10));
    const tower = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(12), fromFloat(10));
    expect(tower).not.toBeNull();
    wagon.retargetIn = 0;

    run(world, 1);
    expect(wagon.targetId).toBe(tower!.id);

    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(6), fromFloat(10));
    run(world, 1);
    expect(wagon.targetId).toBe(tower!.id);
    expect(wagon.targetId).not.toBe(grunt.id);
  });

  it('阵亡后在原地生成 4 个同阵营民兵', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(8), fromFloat(8));
    const deathX = wagon.pos.x;
    const deathY = wagon.pos.y;
    wagon.hp = 0;
    world.step();

    expect(world.units.find((unit) => unit.id === wagon.id)).toBeUndefined();
    const militia = world.units.filter((unit) => unit.typeId === 'melee_grunt');
    expect(militia).toHaveLength(4);
    for (const unit of militia) {
      expect(unit.faction).toBe(Faction.Blue);
      expect(unit.ownerSlot).toBe(wagon.ownerSlot);
      expect(toFloat(dist(unit.pos.x, unit.pos.y, deathX, deathY))).toBeLessThan(1);
    }
  });

  it('deathSpawn 条目 count 改为 2 时只生成 2 个民兵', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(8), fromFloat(8));
    Object.assign(wagon, {
      config: {
        ...wagon.config,
        deathSpawn: { entries: [{ unitTypeId: 'melee_grunt' as const, count: 2 }] },
      },
    });
    wagon.hp = 0;
    world.step();

    expect(world.units.filter((unit) => unit.typeId === 'melee_grunt')).toHaveLength(2);
  });

  it('旧单兵种 deathSpawn 草稿仍能生成对应人数', () => {
    const drafts = dumpUnitConfigDrafts();
    drafts.melee_charge_wagon.deathSpawn = { unitTypeId: 'ranged_archer', count: 2 };
    applyUnitConfigDrafts(drafts);
    try {
      const world = new World(1);
      const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(8), fromFloat(8));
      wagon.hp = 0;
      world.step();

      expect(world.units.filter((unit) => unit.typeId === 'ranged_archer')).toHaveLength(2);
      expect(world.units.filter((unit) => unit.typeId === 'melee_grunt')).toHaveLength(0);
    } finally {
      resetUnitConfigsToDefault();
    }
  });

  it('阵亡后按条目生成多种兵', () => {
    const world = new World(1);
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(8), fromFloat(8));
    Object.assign(wagon, {
      config: {
        ...wagon.config,
        deathSpawn: {
          entries: [
            { unitTypeId: 'melee_grunt' as const, count: 3 },
            { unitTypeId: 'ranged_archer' as const, count: 2 },
          ],
        },
      },
    });
    wagon.hp = 0;
    world.step();

    const militia = world.units.filter((unit) => unit.typeId === 'melee_grunt');
    const archers = world.units.filter((unit) => unit.typeId === 'ranged_archer');
    expect(militia).toHaveLength(3);
    expect(archers).toHaveLength(2);
    for (const unit of [...militia, ...archers]) {
      expect(unit.faction).toBe(Faction.Blue);
      expect(unit.ownerSlot).toBe(wagon.ownerSlot);
    }
  });
});
