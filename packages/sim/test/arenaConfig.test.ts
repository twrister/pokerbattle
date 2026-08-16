import { afterEach, describe, expect, it } from 'vitest';
import {
  ARENA_BRIDGES,
  ARENA_HEIGHT,
  ARENA_RIVER_MAX_Y,
  ARENA_RIVER_MIN_Y,
  ARENA_WIDTH,
  Faction,
  MatchState,
  applyArenaConfigDraft,
  dumpArenaConfigDraft,
  dumpDefaultArenaConfigDraft,
  halfCourtYRange,
  resetArenaConfigToDefault,
  toFloat,
  validateArenaConfigDraft,
} from '../src/index.js';
import { fromFloat } from '../src/math/fixed.js';

function validDraft() {
  return dumpDefaultArenaConfigDraft();
}

describe('场景配置草稿', () => {
  afterEach(() => {
    resetArenaConfigToDefault();
  });

  it('默认值与 arena.json 的场地、镜头一致', () => {
    const draft = dumpArenaConfigDraft();
    expect(draft.width).toBe(18);
    expect(draft.height).toBe(15);
    expect(draft.riverWidth).toBe(2);
    expect(toFloat(ARENA_WIDTH)).toBe(18);
    expect(toFloat(ARENA_HEIGHT)).toBe(32);
    expect(ARENA_RIVER_MIN_Y).toBe(15);
    expect(ARENA_RIVER_MAX_Y).toBe(17);
    expect(draft.bridges).toEqual([
      { minX: 3, maxX: 5 },
      { minX: 13, maxX: 15 },
    ]);
    expect(draft.camera.mode).toBe('perspective');
    expect(draft.camera.fov).toBe(30);
    expect(draft.camera.distance).toBe(71);
    expect(draft.camera.offsetY).toBe(5);
  });

  it('河道过宽或桥越界时拒绝', () => {
    const tooWide = { ...validDraft(), riverWidth: 0 };
    expect(validateArenaConfigDraft(tooWide)).toContain('河道');
    const badBridge = {
      ...validDraft(),
      bridges: [{ minX: 16, maxX: 20 }],
    };
    expect(validateArenaConfigDraft(badBridge)).toContain('桥');
    const overlap = {
      ...validDraft(),
      bridges: [
        { minX: 3, maxX: 8 },
        { minX: 7, maxX: 10 },
      ],
    };
    expect(validateArenaConfigDraft(overlap)).toContain('重叠');
    const badDistance = {
      ...validDraft(),
      camera: { ...validDraft().camera, distance: 3 },
    };
    expect(validateArenaConfigDraft(badDistance)).toContain('距离');
    const badOffset = {
      ...validDraft(),
      camera: { ...validDraft().camera, offsetY: 80 },
    };
    expect(validateArenaConfigDraft(badOffset)).toContain('画面上下');
  });

  it('apply 后河道居中，半场边界与导航阻挡跟着变', () => {
    const next = {
      ...validDraft(),
      width: 20,
      height: 16,
      riverWidth: 3,
      bridges: [
        { minX: 2, maxX: 5 },
        { minX: 15, maxX: 18 },
      ],
    };
    applyArenaConfigDraft(next);

    expect(toFloat(ARENA_WIDTH)).toBe(20);
    expect(toFloat(ARENA_HEIGHT)).toBe(35);
    expect(dumpArenaConfigDraft().height).toBe(16);
    expect(ARENA_RIVER_MIN_Y).toBe(16);
    expect(ARENA_RIVER_MAX_Y).toBe(19);
    expect(halfCourtYRange(Faction.Blue)).toEqual({ minY: 0, maxY: 16 });
    expect(halfCourtYRange(Faction.Red)).toEqual({ minY: 19, maxY: 35 });
    expect(ARENA_BRIDGES).toEqual(next.bridges);

    const match = new MatchState(1);
    const riverY = (ARENA_RIVER_MIN_Y + ARENA_RIVER_MAX_Y) / 2;
    expect(match.world.nav.isBlockedAt(fromFloat(10), fromFloat(riverY))).toBe(true);
    expect(match.world.nav.isBlockedAt(fromFloat(3.5), fromFloat(riverY))).toBe(false);
  });

  it('非法草稿 apply 会抛错且不改运行时', () => {
    const before = dumpArenaConfigDraft();
    expect(() => applyArenaConfigDraft({ ...validDraft(), width: 0 })).toThrow();
    expect(dumpArenaConfigDraft()).toEqual(before);
  });
});
