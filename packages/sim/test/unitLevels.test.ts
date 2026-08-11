import { describe, expect, it } from 'vitest';
import {
  Faction,
  UNIT_LEVEL_CONFIGS,
  World,
  fromFloat,
  getUnitConfig,
  getUnitLevels,
  takeSnapshot,
  toFloat,
} from '../src/index.js';

describe('兵种等级配置', () => {
  it('民兵与弓手都提供 1 到 9 级，生命和伤害逐级增长', () => {
    for (const typeId of ['melee_grunt', 'ranged_archer'] as const) {
      expect(getUnitLevels(typeId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (let level = 2; level <= 9; level++) {
        const previous = getUnitConfig(typeId, level - 1);
        const current = getUnitConfig(typeId, level);
        expect(toFloat(current.maxHp)).toBeGreaterThan(toFloat(previous.maxHp));
        expect(toFloat(current.damage)).toBeGreaterThan(toFloat(previous.damage));
      }
    }
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
