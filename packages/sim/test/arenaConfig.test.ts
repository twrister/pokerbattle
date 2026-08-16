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
      { minX: 8, maxX: 10 },
    ]);
    expect(draft.bridge3Enabled).toBe(false);
    expect(ARENA_BRIDGES).toEqual([
      { minX: 3, maxX: 5 },
      { minX: 13, maxX: 15 },
    ]);
    expect(draft.bases).toEqual([{ x: 9, y: 2 }]);
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
    const badBase = {
      ...validDraft(),
      bases: [{ x: 9, y: 20 }],
    };
    expect(validateArenaConfigDraft(badBase)).toContain('半场');
    const missingBridge3 = {
      ...validDraft(),
      bridges: [
        { minX: 3, maxX: 5 },
        { minX: 13, maxX: 15 },
      ],
      bridge3Enabled: true,
    };
    expect(validateArenaConfigDraft(missingBridge3)).toContain('第三座桥');
    const idleBridge3 = {
      ...validDraft(),
      bridge3Enabled: false,
      bridges: [
        { minX: 3, maxX: 5 },
        { minX: 13, maxX: 15 },
        { minX: 4, maxX: 20 },
      ],
    };
    expect(validateArenaConfigDraft(idleBridge3)).toBeUndefined();
    expect(validateArenaConfigDraft({ ...idleBridge3, bridge3Enabled: true })).toBeDefined();
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
    expect(dumpArenaConfigDraft().bridge3Enabled).toBe(false);

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

  it('开启桥三后第三座写入地形，关闭后只留前两座', () => {
    const draft = {
      ...validDraft(),
      bridge3Enabled: true,
    };
    applyArenaConfigDraft(draft);
    expect(ARENA_BRIDGES).toEqual(draft.bridges);
    expect(dumpArenaConfigDraft().bridge3Enabled).toBe(true);

    applyArenaConfigDraft({ ...draft, bridge3Enabled: false });
    expect(ARENA_BRIDGES).toEqual(draft.bridges.slice(0, 2));
    expect(dumpArenaConfigDraft().bridges).toEqual(draft.bridges);
  });

  it('2v2 预设默认两座单边基地且开启桥三', () => {
    const draft = dumpDefaultArenaConfigDraft('2v2');
    expect(draft.bridge3Enabled).toBe(true);
    expect(draft.bases).toEqual([
      { x: 7.5, y: 2 },
      { x: 22.5, y: 2 },
    ]);
    expect(draft.bridges).toHaveLength(3);
  });
});
