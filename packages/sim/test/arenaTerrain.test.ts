import { describe, expect, it } from 'vitest';
// 对局河道以 arena.json 为准（默认河宽 2）；不加载配置模块时仍是源码里的 1 格占位
import '../src/config/arenaConfig.js';
import { ARENA_BRIDGES, ARENA_RIVER_MAX_Y, ARENA_RIVER_MIN_Y } from '../src/config/arenaTerrain.js';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { MatchState } from '../src/match/matchState.js';
import { World } from '../src/world.js';

/** 河道带中心，保证落在阻挡格而不是半开上沿。 */
function riverCenterY(): number {
  return (ARENA_RIVER_MIN_Y + ARENA_RIVER_MAX_Y) / 2;
}

describe('对局河道地形', () => {
  it('只对 MatchState 写入河道，模拟沙盒 World 保持空旷', () => {
    const sandbox = new World(1);
    const match = new MatchState(1);

    expect(sandbox.nav.isBlockedAt(fromFloat(9), fromFloat(15.5))).toBe(false);
    expect(match.world.nav.isBlockedAt(fromFloat(9), fromFloat(15.5))).toBe(true);
  });

  it('河道只有两座两格宽的桥可以通行', () => {
    const match = new MatchState(1);
    const riverY = (ARENA_RIVER_MIN_Y + ARENA_RIVER_MAX_Y) / 2;

    expect(match.world.nav.isBlockedAt(fromFloat(9), fromFloat(riverY))).toBe(true);
    for (const bridge of ARENA_BRIDGES) {
      const bridgeCenter = (bridge.minX + bridge.maxX) / 2;
      expect(match.world.nav.isBlockedAt(fromFloat(bridgeCenter), fromFloat(riverY))).toBe(false);
    }
  });

  it('地面寻路过河时会绕到桥面', () => {
    const match = new MatchState(1);
    const path: Array<{ x: number; y: number }> = [];

    expect(
      match.world.pathFinder.findPath(
        fromFloat(9),
        fromFloat(14),
        fromFloat(9),
        fromFloat(18),
        path,
      ),
    ).toBe(true);

    const route = [{ x: fromFloat(9), y: fromFloat(14) }, ...path];
    expect(
      route.slice(1).some((point, index) => {
        const previous = route[index]!;
        const startY = toFloat(previous.y);
        const endY = toFloat(point.y);
        const riverCenter = (ARENA_RIVER_MIN_Y + ARENA_RIVER_MAX_Y) / 2;
        if ((startY - riverCenter) * (endY - riverCenter) > 0 || startY === endY) return false;
        const ratio = (riverCenter - startY) / (endY - startY);
        const crossingX = toFloat(previous.x) + (toFloat(point.x) - toFloat(previous.x)) * ratio;
        return ARENA_BRIDGES.some(
          (bridge) => crossingX >= bridge.minX && crossingX < bridge.maxX,
        );
      }),
    ).toBe(true);
  });

  it('重开对局后保留河道阻挡', () => {
    const match = new MatchState(1);
    match.clear();

    expect(match.world.nav.isBlockedAt(fromFloat(9), fromFloat(15.5))).toBe(true);
  });

  it('地面单位生成在河道内会被挤到岸上或桥面', () => {
    const match = new MatchState(1);
    const riverY = riverCenterY();
    const unit = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(riverY));
    const air = match.world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(riverY));

    expect(match.world.nav.isBlockedAt(unit.pos.x, unit.pos.y)).toBe(false);
    expect(toFloat(air.pos.y)).toBeCloseTo(riverY, 5);
  });

  it('软碰撞不能把地面单位推进河道', () => {
    const match = new MatchState(1);
    const south = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(14.4));
    const north = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(14.7));

    for (let i = 0; i < 10; i++) match.world.step();

    expect(match.world.nav.isBlockedAt(south.pos.x, south.pos.y)).toBe(false);
    expect(match.world.nav.isBlockedAt(north.pos.x, north.pos.y)).toBe(false);
  });

  it('步进后会把已经踏进河道的地面单位挤回岸上', () => {
    const match = new MatchState(1);
    const unit = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(12));
    unit.pos.x = fromFloat(9);
    unit.pos.y = fromFloat(riverCenterY());

    match.world.step();

    expect(match.world.nav.isBlockedAt(unit.pos.x, unit.pos.y)).toBe(false);
  });

  it('已在河心的地面单位仍能寻路离开', () => {
    const match = new MatchState(1);
    const path: Array<{ x: number; y: number }> = [];
    const startX = fromFloat(9);
    const startY = fromFloat(riverCenterY());

    expect(match.world.nav.isBlockedAt(startX, startY)).toBe(true);
    expect(
      match.world.pathFinder.findPath(startX, startY, fromFloat(9), fromFloat(12), path),
    ).toBe(true);
    expect(path.length).toBeGreaterThan(0);
    expect(match.world.nav.isBlockedAt(path[0]!.x, path[0]!.y)).toBe(false);
  });

  it('冲刺撞上河面时停在可走格，不会冲进河里', () => {
    const match = new MatchState(1);
    const cavalry = match.world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(13.5));
    cavalry.state = UnitState.Charge;
    cavalry.chargeDir.x = 0;
    cavalry.chargeDir.y = fromFloat(1);
    cavalry.chargeRemaining = fromFloat(6);
    cavalry.chargeWindupLeft = 0;

    for (let i = 0; i < 20; i++) match.world.step();

    expect(match.world.nav.isBlockedAt(cavalry.pos.x, cavalry.pos.y)).toBe(false);
    expect(toFloat(cavalry.pos.y)).toBeLessThan(ARENA_RIVER_MIN_Y + 0.05);
  });

  it('地面单位经桥过河时圆心不进入河道', () => {
    const match = new MatchState(1);
    const unit = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(12));
    match.world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(22));

    let reachedBridgeBand = false;
    for (let i = 0; i < 240; i++) {
      match.world.step();
      expect(match.world.nav.isBlockedAt(unit.pos.x, unit.pos.y)).toBe(false);
      if (toFloat(unit.pos.y) >= ARENA_RIVER_MIN_Y - 0.2) {
        reachedBridgeBand = true;
        break;
      }
    }
    expect(reachedBridgeBand).toBe(true);
  });
});
