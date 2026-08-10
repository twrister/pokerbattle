import { describe, expect, it } from 'vitest';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { MatchState } from '../src/match/matchState.js';
import { vec } from '../src/math/vec2.js';
import { updateMovement } from '../src/systems/movement.js';
import { World } from '../src/world.js';

describe('移动朝向', () => {
  it('Seek 时朝向当前路点，而不是保持出生朝向', () => {
    const world = new World(1);
    const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(5), fromFloat(5));
    // 蓝方默认朝 +Y；强制东向路点，走几步后朝向应明显偏右
    unit.state = UnitState.Seek;
    unit.path.push(vec(fromFloat(12), fromFloat(5)));
    unit.pathIndex = 0;

    for (let i = 0; i < 8; i++) updateMovement(world);

    expect(toFloat(unit.facing.x)).toBeGreaterThan(0.5);
    expect(toFloat(unit.facing.y)).toBeLessThan(0.9);
  });

  it('绕桥过河时朝向路径侧向，而不是正对北岸目标', () => {
    const match = new MatchState(1);
    const unit = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(12));
    match.world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(20));

    let sawSidewaysFacing = false;
    for (let i = 0; i < 80; i++) {
      match.world.step();
      if (unit.state !== UnitState.Seek) continue;
      // 目标几乎在正北；若仍按目标朝向，|facing.x| 会接近 0
      if (Math.abs(toFloat(unit.facing.x)) > 0.45) {
        sawSidewaysFacing = true;
        break;
      }
    }

    expect(sawSidewaysFacing).toBe(true);
  });

  it('站定攻击时仍朝向目标', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10.8));

    for (let i = 0; i < 20; i++) world.step();

    expect(attacker.state).toBe(UnitState.Attack);
    // 目标在正北，攻击朝向应接近 +Y
    expect(toFloat(attacker.facing.y)).toBeGreaterThan(0.8);
    expect(Math.abs(toFloat(attacker.facing.x))).toBeLessThan(0.4);
  });
});
