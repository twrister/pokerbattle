import { describe, expect, it } from 'vitest';
import {
  CARD_FORMATIONS,
  FORMATION_COL_SPACING,
  FORMATION_ROW_SPACING,
  Faction,
  HAND_CATEGORY_ORDER,
  applyCardFormationDrafts,
  dumpCardFormationDrafts,
  getFormationBuildingTypeId,
  getFormationsFor,
  isBuildingOnlyFormation,
  resetCardFormationsToDefault,
  resolveFormationSpawns,
  validateCardFormationDrafts,
} from '../src/index.js';

describe('牌型兵种阵型配置', () => {
  it('所有牌型都有搭配，且 rows 能展开为 slots / units', () => {
    for (const category of HAND_CATEGORY_ORDER) {
      const formations = CARD_FORMATIONS[category];
      expect(formations.length).toBeGreaterThan(0);
      for (const formation of formations) {
        expect(formation.rows.length).toBeGreaterThan(0);
        expect(formation.slots.length).toBeGreaterThan(0);
        expect(formation.slots).toHaveLength(
          formation.rows.reduce((sum, row) => sum + row.length, 0),
        );
        expect(formation.units.reduce((sum, entry) => sum + entry.count, 0)).toBe(
          formation.slots.length,
        );
        expect(formation.colSpacing).toBeGreaterThan(0);
        expect(formation.rowSpacing).toBeGreaterThan(0);
        expect(formation.thumbScale).toBe(2);
      }
    }
  });

  it('民兵弓手各二：前排民兵、后排弓手', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_split');
    expect(formation).toBeDefined();
    expect(formation!.rows).toEqual([
      ['melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer'],
    ]);
    expect(formation!.slots.filter((slot) => slot.row === 0).map((slot) => slot.typeId)).toEqual([
      'melee_grunt',
      'melee_grunt',
    ]);
    expect(formation!.slots.filter((slot) => slot.row === 1).map((slot) => slot.typeId)).toEqual([
      'ranged_archer',
      'ranged_archer',
    ]);
  });

  it('Blue 阵营前排 Y 更大，后排 Y 更小', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_split')!;
    const points = resolveFormationSpawns(formation, Faction.Blue, 9, 8);
    const front = points.filter((point) => point.row === 0);
    const back = points.filter((point) => point.row === 1);

    expect(front.every((point) => point.typeId === 'melee_grunt')).toBe(true);
    expect(back.every((point) => point.typeId === 'ranged_archer')).toBe(true);
    expect(Math.min(...front.map((point) => point.y))).toBeGreaterThan(
      Math.max(...back.map((point) => point.y)),
    );
    // 默认间距生效，且阵型相对锚点居中。
    expect(front[1]!.x - front[0]!.x).toBeCloseTo(FORMATION_COL_SPACING, 6);
    expect(front[0]!.y - back[0]!.y).toBeCloseTo(FORMATION_ROW_SPACING, 6);
    const midY = (Math.max(...points.map((p) => p.y)) + Math.min(...points.map((p) => p.y))) / 2;
    expect(midY).toBeCloseTo(8, 6);
  });

  it('Red 阵营朝向取反：前排 Y 更小，左右镜像', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_split')!;
    const blue = resolveFormationSpawns(formation, Faction.Blue, 9, 16);
    const red = resolveFormationSpawns(formation, Faction.Red, 9, 16);

    const blueFrontY = Math.min(...blue.filter((p) => p.row === 0).map((p) => p.y));
    const redFrontY = Math.max(...red.filter((p) => p.row === 0).map((p) => p.y));
    expect(blueFrontY).toBeGreaterThan(16);
    expect(redFrontY).toBeLessThan(16);

    // 同一 col 的左右相对锚点在红方镜像。
    const blueLeft = blue.find((p) => p.row === 0 && p.col === 0)!;
    const redLeft = red.find((p) => p.row === 0 && p.col === 0)!;
    expect(blueLeft.x - 9).toBeCloseTo(-(redLeft.x - 9), 6);
  });

  it('getFormationsFor 按牌型强度取并集', () => {
    const formations = getFormationsFor(['pair', 'rocket']);
    expect(formations.map((entry) => entry.id)).toEqual([
      'rocket_royal',
      'pair_grunts',
      'pair_archers',
      'pair_custom_3',
    ]);
  });

  it('草稿应用会刷新派生字段，并拒绝非法兵种', () => {
    const drafts = dumpCardFormationDrafts();
    const formation = drafts.pair[0]!;
    formation.rows = [['ranged_archer'], ['melee_grunt']];
    formation.colSpacing = 2;
    formation.thumbScale = 2.5;
    applyCardFormationDrafts(drafts);

    expect(CARD_FORMATIONS.pair[0]!.slots).toEqual([
      { typeId: 'ranged_archer', row: 0, col: 0 },
      { typeId: 'melee_grunt', row: 1, col: 0 },
    ]);
    expect(CARD_FORMATIONS.pair[0]!.colSpacing).toBe(2);
    expect(CARD_FORMATIONS.pair[0]!.thumbScale).toBe(2.5);

    const invalid = dumpCardFormationDrafts();
    invalid.pair[0]!.rows = [['not_a_unit' as never]];
    expect(validateCardFormationDrafts(invalid)).toContain('未知兵种');
    resetCardFormationsToDefault();
  });

  it('允许单建筑阵型，拒绝建筑与兵种混编', () => {
    const drafts = dumpCardFormationDrafts();
    drafts.single[0]!.rows = [['building_tower']];
    expect(validateCardFormationDrafts(drafts)).toBeNull();
    expect(isBuildingOnlyFormation(drafts.single[0]!)).toBe(true);
    expect(getFormationBuildingTypeId(drafts.single[0]!)).toBe('building_tower');

    const mixed = dumpCardFormationDrafts();
    mixed.single[0]!.rows = [['building_tower', 'melee_grunt']];
    expect(validateCardFormationDrafts(mixed)).toContain('只能配置单个建筑');

    const multiBuilding = dumpCardFormationDrafts();
    multiBuilding.single[0]!.rows = [['building_base'], ['building_tower']];
    expect(validateCardFormationDrafts(multiBuilding)).toContain('只能配置单个建筑');
  });
});
