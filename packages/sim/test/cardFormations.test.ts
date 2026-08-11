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
  getPokerCardById,
  isBuildingOnlyFormation,
  layoutMappedUnits,
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
        expect(formation.thumbScale).toBeGreaterThan(0);
      }
    }
  });

  it('规则阵型保留近战前排，远程后排', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_grunt');
    expect(formation).toBeDefined();
    expect(formation!.rows).toEqual([
      ['melee_grunt', 'melee_grunt'],
      ['melee_grunt', 'melee_grunt'],
    ]);
    expect(formation!.slots.filter((slot) => slot.row === 0).map((slot) => slot.typeId)).toEqual([
      'melee_grunt',
      'melee_grunt',
    ]);
    expect(layoutMappedUnits([
      { typeId: 'ranged_archer', level: 1 },
      { typeId: 'melee_grunt', level: 1 },
    ]).map((row) => row.map((unit) => unit.typeId))).toEqual([
      ['melee_grunt'],
      ['ranged_archer'],
    ]);
  });

  it('Blue 阵营前排 Y 更大，后排 Y 更小', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_grunt')!;
    const points = resolveFormationSpawns(formation, Faction.Blue, 9, 8);
    const front = points.filter((point) => point.row === 0);
    const back = points.filter((point) => point.row === 1);

    expect(front.every((point) => point.typeId === 'melee_grunt')).toBe(true);
    expect(back.every((point) => point.typeId === 'melee_grunt')).toBe(true);
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
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_grunt')!;
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
      'rocket_bomb',
      'pair_grunt',
      'pair_archer',
      'pair_rank',
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
      { typeId: 'ranged_archer', level: 1, row: 0, col: 0 },
      { typeId: 'melee_grunt', level: 1, row: 1, col: 0 },
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

  it('按选中牌面推导数字牌组合的数量与等级', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const formationFor = (category: Parameters<typeof getFormationsFor>[0], ids: string[], id: string) =>
      getFormationsFor(category, cards(...ids)).find((formation) => formation.id === id)!;

    const single = formationFor(['single'], ['10-spades'], 'single_grunt');
    expect(single.units).toEqual([{ typeId: 'melee_grunt', level: 9, count: 1 }]);

    const pair = formationFor(['pair'], ['10-spades', '10-hearts'], 'pair_grunt');
    expect(pair.units).toEqual([{ typeId: 'melee_grunt', level: 10, count: 2 }]);

    const straight3 = formationFor(['straight3'], ['8-spades', '9-hearts', '10-clubs'], 'straight3_grunt');
    expect(straight3.units).toEqual([{ typeId: 'melee_grunt', level: 9, count: 3 }]);

    const straight3Archers = formationFor(
      ['straight3'],
      ['3-spades', '4-hearts', '5-clubs'],
      'straight3_archer',
    );
    expect(straight3Archers.units).toEqual([{ typeId: 'ranged_archer', level: 4, count: 3 }]);
    expect(straight3Archers.slots).toHaveLength(3);

    const triple = formationFor(['triple'], ['10-spades', '10-hearts', '10-clubs'], 'triple_grunt');
    expect(triple.units).toEqual([{ typeId: 'melee_grunt', level: 10, count: 5 }]);

    const twoPair = formationFor(
      ['two_pair'],
      ['9-spades', '9-hearts', '10-clubs', '10-diamonds'],
      'two_pair_grunt',
    );
    expect(twoPair.units).toEqual([{ typeId: 'melee_grunt', level: 11, count: 4 }]);

    // 单牌 3～10 必须落在 2～9 级，避免 UI/出兵仍按模板默认 1 级。
    for (const [rank, level] of [
      ['3', 2],
      ['5', 4],
      ['10', 9],
    ] as const) {
      const single = formationFor(['single'], [`${rank}-spades`], 'single_grunt');
      expect(single.slots.every((slot) => slot.level === level)).toBe(true);
      expect(resolveFormationSpawns(single, Faction.Blue, 9, 8).every((point) => point.level === level)).toBe(
        true,
      );
    }
  });
});
