import { describe, expect, it } from 'vitest';
import { ARENA_BRIDGES, ARENA_RIVER_MAX_Y, ARENA_RIVER_MIN_Y } from '../src/config/arenaTerrain.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { MatchState } from '../src/match/matchState.js';
import { World } from '../src/world.js';

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
});
