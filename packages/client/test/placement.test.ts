import { describe, expect, it } from 'vitest';
import { Faction, createCardFormation, resolveFormationSpawns } from '@pb/sim';
import {
  BLUE_HALF_MAX_Y,
  blueHalfSafeAnchor,
  isFormationInsideBlueHalf,
} from '../src/input/placement.js';
import { ARENA_W } from '../src/view/coords.js';

/** 造一个两排四人的方阵，横向/排间距固定，便于按格算边界。 */
function squadFormation(): ReturnType<typeof createCardFormation> {
  return createCardFormation('two_pair', {
    id: 'test_squad',
    name: '测试方阵',
    rows: [
      ['melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer'],
    ],
    colSpacing: 2,
    rowSpacing: 2,
  });
}

describe('蓝方阵型落点校验', () => {
  it('半场中央的整阵合法，越过中线则判非法', () => {
    const formation = squadFormation();
    const inside = resolveFormationSpawns(formation, Faction.Blue, ARENA_W / 2, 8);
    expect(isFormationInsideBlueHalf(inside)).toBe(true);

    const acrossHalfLine = resolveFormationSpawns(
      formation,
      Faction.Blue,
      ARENA_W / 2,
      BLUE_HALF_MAX_Y,
    );
    expect(isFormationInsideBlueHalf(acrossHalfLine)).toBe(false);
  });

  it('锚点在场内但阵型有单位越过左右边界时判非法', () => {
    const formation = squadFormation();
    // 锚点贴着左边界，最左一列会落到 x<0。
    const overflow = resolveFormationSpawns(formation, Faction.Blue, 0.2, 8);
    expect(isFormationInsideBlueHalf(overflow)).toBe(false);
  });

  it('自动落点位于蓝方半场且整阵合法', () => {
    const formation = squadFormation();
    const anchor = blueHalfSafeAnchor(formation)!;
    expect(anchor).not.toBeNull();
    expect(anchor.y).toBeGreaterThan(0);
    expect(anchor.y).toBeLessThan(BLUE_HALF_MAX_Y);
    expect(isFormationInsideBlueHalf(resolveFormationSpawns(formation, Faction.Blue, anchor.x, anchor.y))).toBe(
      true,
    );
  });

  it('阵型比半场还大时没有安全落点', () => {
    const oversized = createCardFormation('two_pair', {
      id: 'test_oversized',
      name: '超宽阵',
      rows: [['melee_grunt', 'melee_grunt', 'melee_grunt']],
      colSpacing: 40,
      rowSpacing: 2,
    });
    expect(blueHalfSafeAnchor(oversized)).toBeNull();
  });
});
