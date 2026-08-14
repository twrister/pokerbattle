import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat } from '../src/math/fixed.js';
import { World } from '../src/world.js';

/**
 * 拥挤场景性能冒烟：固定单位数/tick 数，确认单次运行耗时在合理量级。
 * 不与历史绝对数值硬比对（CI 机器差异大），只防止意外引入复杂度爆炸。
 */
describe('拥挤性能冒烟', () => {
  it('24 单位混战 600 tick 应在 2 秒内跑完', () => {
    expectCrowdedSteps(6, 600, 2000);
  });

  it('48 单位混战 600 tick 应在 4 秒内跑完', () => {
    expectCrowdedSteps(12, 600, 4000);
  });
});

/** 每侧 pairs 组近战+弓箭对向开打，跑满 ticks 且不超过耗时上限。 */
function expectCrowdedSteps(pairs: number, ticks: number, maxMs: number): void {
  const world = new World(42);
  for (let i = 0; i < pairs; i++) {
    world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(4 + i * 1.5), fromFloat(8));
    world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(4 + i * 1.5), fromFloat(5));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(4 + i * 1.5), fromFloat(24));
    world.spawnUnit(Faction.Red, 'ranged_archer', fromFloat(4 + i * 1.5), fromFloat(28));
  }

  const started = Date.now();
  for (let t = 0; t < ticks; t++) world.step();
  const elapsed = Date.now() - started;

  expect(world.tick).toBe(ticks);
  expect(elapsed).toBeLessThan(maxMs);
}
