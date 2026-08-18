import { describe, expect, it } from 'vitest';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { vec } from '../src/math/vec2.js';
import { MatchState } from '../src/match/matchState.js';
import { updateMovement } from '../src/systems/movement.js';
import { World } from '../src/world.js';

/** 沿 +X 走固定帧数，量位移（无敌人、无分离干扰）。 */
function walkDistance(scale: number, ticks = 10): number {
  const world = new World(1);
  world.unitTimeScale = fromFloat(scale);
  const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(5), fromFloat(5));
  unit.state = UnitState.Seek;
  unit.path.push(vec(fromFloat(20), fromFloat(5)));
  unit.pathIndex = 0;
  const startX = unit.pos.x;
  for (let i = 0; i < ticks; i++) updateMovement(world);
  return toFloat(unit.pos.x - startX);
}

describe('单位逻辑加速', () => {
  it('1.5 倍时同样移速位移约为 1 倍的 1.5 倍', () => {
    const normal = walkDistance(1);
    const boosted = walkDistance(1.5);
    expect(boosted / normal).toBeCloseTo(1.5, 2);
  });

  it('决胜与结算写入 1.5 倍，clear 后恢复', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    match.setPhaseDurations({
      normalTicks: 1,
      doubleSpeedTicks: 1,
      finalTicks: 20,
      settlementTicks: 20,
    });

    while (match.world.tick < 2) match.step();
    expect(match.phase).toBe('final');
    expect(toFloat(match.world.unitTimeScale)).toBeCloseTo(1.5);

    while (match.world.tick < 22) match.step();
    expect(match.phase).toBe('settlement');
    expect(toFloat(match.world.unitTimeScale)).toBeCloseTo(1.5);

    match.clear();
    expect(match.phase).toBe('normal');
    expect(toFloat(match.world.unitTimeScale)).toBeCloseTo(1);
  });
});
