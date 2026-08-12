import { describe, expect, it } from 'vitest';
import {
  Faction,
  UNIT_LEVEL_CONFIGS,
  UNIT_LEVELS_ENABLED,
  World,
  fromFloat,
  getUnitConfig,
  getUnitLevels,
  takeSnapshot,
  toFloat,
} from '../src/index.js';

describe.skipIf(!UNIT_LEVELS_ENABLED)('兵种等级配置', () => {
  it('民兵与弓手都提供 1 到 12 级，生命和伤害逐级增长', () => {
    for (const typeId of ['melee_grunt', 'ranged_archer'] as const) {
      expect(getUnitLevels(typeId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      for (let level = 2; level <= 12; level++) {
        const previous = getUnitConfig(typeId, level - 1);
        const current = getUnitConfig(typeId, level);
        expect(toFloat(current.maxHp)).toBeGreaterThan(toFloat(previous.maxHp));
        expect(toFloat(current.damage)).toBeGreaterThan(toFloat(previous.damage));
      }
    }
  });

  it('12 级民兵战力贴近 1 级卫士', () => {
    const militia12 = getUnitConfig('melee_grunt', 12);
    const guard1 = getUnitConfig('melee_guard', 1);
    expect(toFloat(militia12.maxHp)).toBe(toFloat(guard1.maxHp));
    expect(Math.abs(toFloat(militia12.damage) - toFloat(guard1.damage))).toBeLessThanOrEqual(1);
  });

  it('未指定或不存在等级时回退到 1 级', () => {
    expect(getUnitConfig('melee_grunt')).toBe(UNIT_LEVEL_CONFIGS.melee_grunt[1]);
    expect(getUnitConfig('melee_grunt', 99)).toBe(UNIT_LEVEL_CONFIGS.melee_grunt[1]);
  });

  it('单位出生等级决定属性，并写入渲染快照', () => {
    const world = new World(1);
    const unit = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(5), 9);

    expect(unit.level).toBe(9);
    expect(unit.hp).toBe(getUnitConfig('ranged_archer', 9).maxHp);
    expect(takeSnapshot(world).units[0]?.level).toBe(9);
  });
});

describe('兵种等级关闭时', () => {
  it('对外只暴露 1 级，查询任意等级都回落到 1 级配置', () => {
    expect(UNIT_LEVELS_ENABLED).toBe(false);
    expect(getUnitLevels('melee_grunt')).toEqual([1]);
    expect(getUnitLevels('ranged_archer')).toEqual([1]);
    expect(getUnitConfig('melee_grunt', 9)).toBe(UNIT_LEVEL_CONFIGS.melee_grunt[1]);
    expect(getUnitConfig('ranged_archer', 12)).toBe(UNIT_LEVEL_CONFIGS.ranged_archer[1]);
  });

  it('出生请求高等级时仍按 1 级属性与快照等级结算', () => {
    const world = new World(1);
    const unit = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(5), 9);

    expect(unit.level).toBe(1);
    expect(unit.hp).toBe(getUnitConfig('ranged_archer', 1).maxHp);
    expect(takeSnapshot(world).units[0]?.level).toBe(1);
  });
});
