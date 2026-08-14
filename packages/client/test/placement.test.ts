import { describe, expect, it } from 'vitest';
import {
  Faction,
  World,
  createCardFormation,
  fromFloat,
  halfCourtYRange,
  resolveFormationSpawns,
} from '@pb/sim';
import {
  collectPlaceableBuildingCells,
  collectPlaceableBuildingCenters,
} from '../src/input/buildingPlacement.js';
import {
  BLUE_HALF_MAX_Y,
  blueHalfSafeAnchor,
  blueHalfSafeBuildingAnchor,
  isBuildingInsideBlueHalf,
  isDeployAnchorInsideBlueHalf,
  isFormationInsideBlueHalf,
} from '../src/input/placement.js';
import { collectHalfCourtPlaceableCells } from '../src/input/placeableHighlight.js';
import { ARENA_H, ARENA_W } from '../src/view/coords.js';

/** 造一个两排四人的方阵，横向/排间距固定，便于按格算边界。 */
function squadFormation(): ReturnType<typeof createCardFormation> {
  return createCardFormation('two_pair', {
    id: 'test_squad',
    name: '测试方阵',
    match: { kind: 'any' },
    rows: [
      ['melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer'],
    ],
    colSpacing: 2,
    rowSpacing: 2,
  });
}

describe('蓝方阵型落点校验', () => {
  it('白色部署区内锚点合法，越过中线则非法', () => {
    expect(isDeployAnchorInsideBlueHalf(ARENA_W / 2, 8)).toBe(true);
    expect(isDeployAnchorInsideBlueHalf(ARENA_W / 2, BLUE_HALF_MAX_Y)).toBe(false);

    const formation = squadFormation();
    const inside = resolveFormationSpawns(formation, Faction.Blue, ARENA_W / 2, 8);
    expect(isFormationInsideBlueHalf(inside)).toBe(true);
  });

  it('锚点在白色部署区即可放置，即使阵型贴边溢出', () => {
    const formation = squadFormation();
    // 锚点贴着左边界，最左一列会落到 x<0，但白色区内仍应可放。
    expect(isDeployAnchorInsideBlueHalf(0.2, 8)).toBe(true);
    const overflow = resolveFormationSpawns(formation, Faction.Blue, 0.2, 8);
    expect(isFormationInsideBlueHalf(overflow)).toBe(false);
  });

  it('自动落点位于蓝方白色部署区', () => {
    const formation = squadFormation();
    const anchor = blueHalfSafeAnchor(formation)!;
    expect(anchor).not.toBeNull();
    expect(anchor.y).toBeGreaterThanOrEqual(0);
    expect(anchor.y).toBeLessThan(BLUE_HALF_MAX_Y);
    expect(isDeployAnchorInsideBlueHalf(anchor.x, anchor.y)).toBe(true);
  });

  it('超宽阵型仍可自动落到半场中央', () => {
    const oversized = createCardFormation('two_pair', {
      id: 'test_oversized',
      name: '超宽阵',
      match: { kind: 'any' },
      rows: [['melee_grunt', 'melee_grunt', 'melee_grunt']],
      colSpacing: 40,
      rowSpacing: 2,
    });
    const anchor = blueHalfSafeAnchor(oversized)!;
    expect(anchor).not.toBeNull();
    expect(isDeployAnchorInsideBlueHalf(anchor.x, anchor.y)).toBe(true);
  });

  it('单建筑阵型安全锚点保证整块占地在蓝方半场内', () => {
    const tower = createCardFormation('single', {
      id: 'test_tower',
      name: '防御塔',
      match: { kind: 'any' },
      rows: [['building_tower']],
    });
    const anchor = blueHalfSafeAnchor(tower)!;
    expect(anchor).not.toBeNull();
    expect(isBuildingInsideBlueHalf(anchor.x, anchor.y, 2)).toBe(true);

    const baseAnchor = blueHalfSafeBuildingAnchor(4)!;
    expect(baseAnchor).not.toBeNull();
    expect(isBuildingInsideBlueHalf(baseAnchor.x, baseAnchor.y, 4)).toBe(true);
    // 中心贴近中线时，4×4 会跨出蓝方半场
    expect(isBuildingInsideBlueHalf(ARENA_W / 2, BLUE_HALF_MAX_Y, 4)).toBe(false);
  });
});

describe('建造模式可放置目标格', () => {
  it('半场约束下只枚举蓝方合法中心，且排除已占格', () => {
    const world = new World(1);
    const empty = collectPlaceableBuildingCenters(world, 'building_tower', true);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((c) => isBuildingInsideBlueHalf(c.x, c.y, 2))).toBe(true);

    const placed = empty[0]!;
    world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(placed.x), fromFloat(placed.y));
    const after = collectPlaceableBuildingCenters(world, 'building_tower', true);
    // 2×2 会挡住邻接吸附位，合法中心数应明显减少且不含原中心
    expect(after.length).toBeLessThan(empty.length);
    expect(after.some((c) => c.x === placed.x && c.y === placed.y)).toBe(false);
  });

  it('可放置高亮按 1×1 格去重，避免 footprint 矩形叠色', () => {
    const world = new World(1);
    const cells = collectPlaceableBuildingCells(world, 'building_tower', true);
    expect(cells.length).toBeGreaterThan(0);
    const keys = new Set(cells.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(cells.length);
    // 河道前的完整格都可被 2×2 足迹覆盖：18×15 = 270 格
    expect(cells.length).toBe(ARENA_W * Math.floor(BLUE_HALF_MAX_Y));
  });
});

describe('拖拽部署区高亮', () => {
  it('只枚举蓝方半场内的完整格心', () => {
    const { minY, maxY } = halfCourtYRange(Faction.Blue);
    const cells = collectHalfCourtPlaceableCells(Faction.Blue);

    expect(cells.every((cell) => cell.x >= 0 && cell.x <= ARENA_W)).toBe(true);
    expect(cells.every((cell) => cell.y >= minY && cell.y < maxY)).toBe(true);
    expect(cells).toHaveLength(ARENA_W * (Math.floor(maxY) - Math.ceil(minY)));
  });

  it('只枚举红方半场内的完整格心', () => {
    const { minY, maxY } = halfCourtYRange(Faction.Red);
    const cells = collectHalfCourtPlaceableCells(Faction.Red);

    expect(cells.every((cell) => cell.y >= minY && cell.y < maxY)).toBe(true);
    expect(cells).toHaveLength(ARENA_W * (ARENA_H - Math.ceil(minY)));
  });
});
