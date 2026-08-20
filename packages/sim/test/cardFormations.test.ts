import { describe, expect, it } from 'vitest';
import {
  CARD_FORMATIONS,
  Faction,
  HAND_CATEGORY_ORDER,
  HAND_CATEGORY_STRENGTH_ORDER,
  allocateCopiedFormationIdentity,
  applyCardFormationDrafts,
  applyUnitConfigDrafts,
  cloneFormationDraft,
  dumpCardFormationDrafts,
  dumpUnitConfigDrafts,
  formatMatchRuleLabel,
  groupFormationsByMatch,
  matchRuleKey,
  getExclusiveFormationUnitTag,
  getFormationBuildingTypeId,
  getFormationsFor,
  getPokerCardById,
  isBuildingOnlyFormation,
  layoutMappedUnits,
  resetCardFormationsToDefault,
  resetUnitConfigsToDefault,
  resolveFormationSpawns,
  validateCardFormationDrafts,
  type FormationDraft,
} from '../src/index.js';

describe('牌型兵种阵型配置', () => {
  it('牌型强度序为同花顺到单张的指定全序，卡组页为其反转', () => {
    expect(HAND_CATEGORY_STRENGTH_ORDER).toEqual([
      'straight_flush',
      'bomb',
      'rocket',
      'flush',
      'full_house',
      'straight5',
      'two_pair',
      'triple',
      'straight4',
      'straight3',
      'pair',
      'single',
    ]);
    expect(HAND_CATEGORY_ORDER).toEqual([...HAND_CATEGORY_STRENGTH_ORDER].reverse());
  });

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

  it('layoutMappedUnits 将近战排前、远程排后', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_number');
    expect(formation).toBeDefined();
    // 数字连对默认 4 民兵前排 + 4 弓手后排
    expect(formation!.rows).toEqual([
      ['melee_grunt', 'melee_grunt', 'melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);
    expect(formation!.slots.filter((slot) => slot.row === 0).map((slot) => slot.typeId)).toEqual([
      'melee_grunt',
      'melee_grunt',
      'melee_grunt',
      'melee_grunt',
    ]);
    expect(layoutMappedUnits([
      { typeId: 'ranged_archer' },
      { typeId: 'melee_grunt' },
    ]).map((row) => row.map((unit) => unit.typeId))).toEqual([
      ['melee_grunt'],
      ['ranged_archer'],
    ]);
  });

  it('Blue 阵营前排 Y 更大，后排 Y 更小', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_number')!;
    const points = resolveFormationSpawns(formation, Faction.Blue, 9, 8);
    const front = points.filter((point) => point.row === 0);
    const back = points.filter((point) => point.row === 1);

    expect(front.every((point) => point.typeId === 'melee_grunt')).toBe(true);
    expect(back.every((point) => point.typeId === 'ranged_archer')).toBe(true);
    expect(Math.min(...front.map((point) => point.y))).toBeGreaterThan(
      Math.max(...back.map((point) => point.y)),
    );
    // 配置间距生效，且阵型相对锚点居中。
    expect(front[1]!.x - front[0]!.x).toBeCloseTo(formation.colSpacing, 6);
    expect(front[0]!.y - back[0]!.y).toBeCloseTo(formation.rowSpacing, 6);
    const midY = (Math.max(...points.map((p) => p.y)) + Math.min(...points.map((p) => p.y))) / 2;
    expect(midY).toBeCloseTo(8, 6);
  });

  it('Red 阵营朝向取反：前排 Y 更小，左右镜像', () => {
    const formation = CARD_FORMATIONS.two_pair.find((entry) => entry.id === 'two_pair_number')!;
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
      'pair_J',
      'pair_Q',
      'pair_K',
      'pair_A',
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

  it('按选中牌面推导数字牌组合的数量', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const formationFor = (category: Parameters<typeof getFormationsFor>[0], ids: string[], id: string) =>
      getFormationsFor(category, cards(...ids)).find((formation) => formation.id === id)!;

    const single = formationFor(['single'], ['10-spades'], 'single_grunt');
    expect(single.units).toEqual([{ typeId: 'melee_grunt', count: 1 }]);

    const pair = formationFor(['pair'], ['10-spades', '10-hearts'], 'pair_grunt');
    expect(pair.units).toEqual([{ typeId: 'melee_grunt', count: 3 }]);

    const straight3 = formationFor(['straight3'], ['8-spades', '9-hearts', '10-clubs'], 'straight3_number');
    expect(straight3.units).toEqual([
      { typeId: 'melee_grunt', count: 2 },
      { typeId: 'ranged_archer', count: 2 },
    ]);
    expect(straight3.slots).toHaveLength(4);

    const straight4 = formationFor(
      ['straight4'],
      ['6-spades', '7-hearts', '8-clubs', '9-diamonds'],
      'straight4_number',
    );
    expect(straight4.units).toEqual([
      { typeId: 'melee_grunt', count: 3 },
      { typeId: 'ranged_archer', count: 3 },
    ]);
    expect(straight4.slots).toHaveLength(6);

    const triple = formationFor(['triple'], ['10-spades', '10-hearts', '10-clubs'], 'triple_grunt');
    expect(triple.units).toEqual([{ typeId: 'melee_grunt', count: 6 }]);

    const twoPair = formationFor(
      ['two_pair'],
      ['9-spades', '9-hearts', '10-clubs', '10-diamonds'],
      'two_pair_number',
    );
    expect(twoPair.units).toEqual([
      { typeId: 'melee_grunt', count: 4 },
      { typeId: 'ranged_archer', count: 4 },
    ]);
  });

  it('三条按点数匹配可配置站位，并可兑换小炸弹', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['triple'], cards(...cardIds)).map((formation) => formation.id);
    const formationFor = (cardIds: string[], id: string) =>
      getFormationsFor(['triple'], cards(...cardIds)).find((formation) => formation.id === id)!;

    expect(CARD_FORMATIONS.triple.map((entry) => entry.id)).toEqual([
      'triple_grunt',
      'triple_archer',
      'triple_J',
      'triple_Q',
      'triple_K',
      'triple_A',
      'triple_small_bomb',
    ]);

    expect(idsFor(['5-spades', '5-hearts', '5-clubs'])).toEqual([
      'triple_grunt',
      'triple_archer',
      'triple_small_bomb',
    ]);
    expect(formationFor(['5-spades', '5-hearts', '5-clubs'], 'triple_grunt').units).toEqual([
      { typeId: 'melee_grunt', count: 6 },
    ]);
    expect(idsFor(['J-spades', 'J-hearts', 'J-clubs'])).toEqual(['triple_J', 'triple_small_bomb']);
    expect(formationFor(['J-spades', 'J-hearts', 'J-clubs'], 'triple_J').units).toEqual([
      { typeId: 'melee_guard', count: 3 },
      { typeId: 'ranged_archer', count: 3 },
    ]);
    expect(idsFor(['A-spades', 'A-hearts', 'A-clubs'])).toEqual(['triple_A', 'triple_small_bomb']);
    expect(formationFor(['A-spades', 'A-hearts', 'A-clubs'], 'triple_A').rows).toEqual([
      ['melee_cavalry', 'melee_cavalry', 'melee_cavalry'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);

    const smallBomb = formationFor(['2-spades', '2-hearts', '2-clubs'], 'triple_small_bomb');
    expect(smallBomb.slots).toEqual([{ typeId: 'small_bomb', row: 0, col: 0 }]);
  });

  it('三顺按点数段匹配可配置站位，且只展示命中段', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['straight3'], cards(...cardIds)).map((formation) => formation.id);
    const formationFor = (cardIds: string[], id: string) =>
      getFormationsFor(['straight3'], cards(...cardIds)).find((formation) => formation.id === id)!;

    expect(CARD_FORMATIONS.straight3.map((entry) => entry.id)).toEqual([
      'straight3_number',
      'straight3_A23',
      'straight3_910J',
      'straight3_10JQ',
      'straight3_JQK',
      'straight3_QKA',
    ]);

    expect(idsFor(['3-spades', '4-hearts', '5-clubs'])).toEqual(['straight3_number']);
    expect(formationFor(['3-spades', '4-hearts', '5-clubs'], 'straight3_number').units).toEqual([
      { typeId: 'melee_grunt', count: 2 },
      { typeId: 'ranged_archer', count: 2 },
    ]);
    expect(idsFor(['A-spades', '2-hearts', '3-clubs'])).toEqual(['straight3_A23']);
    expect(formationFor(['A-spades', '2-hearts', '3-clubs'], 'straight3_A23').units).toEqual([
      { typeId: 'melee_cavalry', count: 1 },
      { typeId: 'melee_grunt', count: 1 },
      { typeId: 'ranged_archer', count: 2 },
    ]);
    expect(idsFor(['9-spades', '10-hearts', 'J-clubs'])).toEqual(['straight3_910J']);
    expect(formationFor(['9-spades', '10-hearts', 'J-clubs'], 'straight3_910J').units).toEqual([
      { typeId: 'melee_grunt', count: 1 },
      { typeId: 'melee_guard', count: 1 },
      { typeId: 'ranged_archer', count: 2 },
    ]);
    expect(idsFor(['10-spades', 'J-hearts', 'Q-clubs'])).toEqual(['straight3_10JQ']);
    expect(formationFor(['10-spades', 'J-hearts', 'Q-clubs'], 'straight3_10JQ').rows).toEqual([
      ['melee_grunt', 'melee_guard'],
      ['ranged_archer', 'hero_queen'],
    ]);
    expect(idsFor(['J-spades', 'Q-hearts', 'K-clubs'])).toEqual(['straight3_JQK']);
    expect(formationFor(['J-spades', 'Q-hearts', 'K-clubs'], 'straight3_JQK').rows).toEqual([
      ['melee_guard', 'hero_king'],
      ['hero_queen', 'ranged_archer'],
    ]);
    expect(idsFor(['Q-spades', 'K-hearts', 'A-clubs'])).toEqual(['straight3_QKA']);
    expect(formationFor(['Q-spades', 'K-hearts', 'A-clubs'], 'straight3_QKA').rows).toEqual([
      ['hero_king', 'melee_cavalry'],
      ['hero_queen', 'ranged_archer'],
    ]);
  });

  it('三顺尊重配置 rows，不因规则重排站位', () => {
    const draft = dumpCardFormationDrafts();
    draft.straight3 = [
      {
        id: 'straight3_number',
        name: '自定义数字三顺',
        match: { kind: 'numbers' },
        rows: [['ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt']],
        colSpacing: 1.2,
        rowSpacing: 1.4,
        thumbScale: 2,
      },
    ];
    applyCardFormationDrafts(draft);
    try {
      const cards = ['8-spades', '9-hearts', '10-clubs'].map((id) => getPokerCardById(id)!);
      const formation = getFormationsFor(['straight3'], cards).find((entry) => entry.id === 'straight3_number')!;
      expect(formation.rows).toEqual([['ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt']]);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('四顺按点数段匹配可配置站位，且只展示命中段', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['straight4'], cards(...cardIds)).map((formation) => formation.id);
    const formationFor = (cardIds: string[], id: string) =>
      getFormationsFor(['straight4'], cards(...cardIds)).find((formation) => formation.id === id)!;

    expect(CARD_FORMATIONS.straight4.map((entry) => entry.id)).toEqual([
      'straight4_number',
      'straight4_A234',
      'straight4_8910J',
      'straight4_910JQ',
      'straight4_10JQK',
      'straight4_JQKA',
    ]);

    expect(idsFor(['3-spades', '4-hearts', '5-clubs', '6-diamonds'])).toEqual(['straight4_number']);
    expect(formationFor(['3-spades', '4-hearts', '5-clubs', '6-diamonds'], 'straight4_number').units).toEqual([
      { typeId: 'melee_grunt', count: 3 },
      { typeId: 'ranged_archer', count: 3 },
    ]);
    expect(idsFor(['A-spades', '2-hearts', '3-clubs', '4-diamonds'])).toEqual(['straight4_A234']);
    expect(formationFor(['A-spades', '2-hearts', '3-clubs', '4-diamonds'], 'straight4_A234').units).toEqual([
      { typeId: 'melee_cavalry', count: 1 },
      { typeId: 'melee_grunt', count: 1 },
      { typeId: 'ranged_archer', count: 2 },
    ]);
    expect(idsFor(['8-spades', '9-hearts', '10-clubs', 'J-diamonds'])).toEqual(['straight4_8910J']);
    expect(formationFor(['8-spades', '9-hearts', '10-clubs', 'J-diamonds'], 'straight4_8910J').rows).toEqual([
      ['melee_grunt', 'melee_guard'],
      ['ranged_archer', 'ranged_archer'],
    ]);
    expect(idsFor(['9-spades', '10-hearts', 'J-clubs', 'Q-diamonds'])).toEqual(['straight4_910JQ']);
    expect(formationFor(['9-spades', '10-hearts', 'J-clubs', 'Q-diamonds'], 'straight4_910JQ').rows).toEqual([
      ['melee_grunt', 'melee_guard'],
      ['ranged_archer', 'hero_queen'],
    ]);
    expect(idsFor(['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds'])).toEqual(['straight4_10JQK']);
    expect(formationFor(['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds'], 'straight4_10JQK').rows).toEqual([
      ['melee_guard', 'hero_king'],
      ['hero_queen', 'ranged_archer'],
    ]);
    expect(idsFor(['J-spades', 'Q-hearts', 'K-clubs', 'A-diamonds'])).toEqual(['straight4_JQKA']);
    expect(formationFor(['J-spades', 'Q-hearts', 'K-clubs', 'A-diamonds'], 'straight4_JQKA').rows).toEqual([
      ['hero_king', 'melee_cavalry'],
      ['hero_queen', 'ranged_archer'],
    ]);
  });

  it('四顺尊重配置 rows，不因规则重排站位', () => {
    const draft = dumpCardFormationDrafts();
    draft.straight4 = [
      {
        id: 'straight4_number',
        name: '自定义数字四顺',
        match: { kind: 'numbers' },
        rows: [['ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt']],
        colSpacing: 1.2,
        rowSpacing: 1.4,
        thumbScale: 2,
      },
    ];
    applyCardFormationDrafts(draft);
    try {
      const cards = ['6-spades', '7-hearts', '8-clubs', '9-diamonds'].map((id) => getPokerCardById(id)!);
      const formation = getFormationsFor(['straight4'], cards).find((entry) => entry.id === 'straight4_number')!;
      expect(formation.rows).toEqual([['ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt']]);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('五顺按点数段匹配可配置站位，7-J / 8-Q 各有独立方案', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['straight5'], cards(...cardIds)).map((formation) => formation.id);
    const formationFor = (cardIds: string[], id: string) =>
      getFormationsFor(['straight5'], cards(...cardIds)).find((formation) => formation.id === id)!;

    expect(CARD_FORMATIONS.straight5.map((entry) => entry.id)).toEqual([
      'straight5_number',
      'straight5_A2345',
      'straight5_78910J',
      'straight5_8910JQ',
      'straight5_910JQK',
      'straight5_10JQKA',
      'straight5_custom_7',
      'straight5_custom_8',
    ]);

    expect(idsFor(['2-spades', '3-hearts', '4-clubs', '5-diamonds', '6-spades'])).toEqual([
      'straight5_number',
      'straight5_custom_7',
    ]);
    expect(
      formationFor(['2-spades', '3-hearts', '4-clubs', '5-diamonds', '6-spades'], 'straight5_number').units,
    ).toEqual([
      { typeId: 'melee_grunt', count: 4 },
      { typeId: 'ranged_archer', count: 4 },
    ]);

    expect(idsFor(['A-spades', '2-hearts', '3-clubs', '4-diamonds', '5-spades'])).toEqual([
      'straight5_A2345',
      'straight5_custom_8',
    ]);
    expect(
      formationFor(['A-spades', '2-hearts', '3-clubs', '4-diamonds', '5-spades'], 'straight5_A2345').rows,
    ).toEqual([
      ['melee_grunt', 'melee_cavalry', 'melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);

    expect(idsFor(['7-spades', '8-hearts', '9-clubs', '10-diamonds', 'J-spades'])).toEqual([
      'straight5_78910J',
    ]);
    expect(
      formationFor(['7-spades', '8-hearts', '9-clubs', '10-diamonds', 'J-spades'], 'straight5_78910J').rows,
    ).toEqual([
      ['melee_grunt', 'melee_guard', 'melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);

    expect(idsFor(['8-spades', '9-hearts', '10-clubs', 'J-diamonds', 'Q-spades'])).toEqual([
      'straight5_8910JQ',
    ]);
    expect(
      formationFor(['8-spades', '9-hearts', '10-clubs', 'J-diamonds', 'Q-spades'], 'straight5_8910JQ').rows,
    ).toEqual([
      ['melee_grunt', 'melee_guard', 'melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'hero_queen', 'ranged_archer', 'ranged_archer'],
    ]);

    expect(idsFor(['9-spades', '10-hearts', 'J-clubs', 'Q-diamonds', 'K-spades'])).toEqual([
      'straight5_910JQK',
    ]);
    expect(
      formationFor(['9-spades', '10-hearts', 'J-clubs', 'Q-diamonds', 'K-spades'], 'straight5_910JQK').rows,
    ).toEqual([
      ['melee_grunt', 'melee_grunt', 'melee_guard', 'melee_grunt'],
      ['ranged_archer', 'hero_queen', 'ranged_archer', 'ranged_archer'],
    ]);

    expect(idsFor(['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds', 'A-spades'])).toEqual([
      'straight5_10JQKA',
    ]);
    expect(
      formationFor(['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds', 'A-spades'], 'straight5_10JQKA').rows,
    ).toEqual([
      ['melee_guard', 'melee_cavalry', 'hero_king', 'melee_grunt'],
      ['ranged_archer', 'hero_queen', 'ranged_archer', 'ranged_archer'],
    ]);
  });

  it('五顺尊重配置 rows，不因规则重排站位', () => {
    const draft = dumpCardFormationDrafts();
    draft.straight5 = [
      {
        id: 'straight5_number',
        name: '自定义数字五顺',
        match: { kind: 'numbers' },
        rows: [['ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt']],
        colSpacing: 1.2,
        rowSpacing: 1.4,
        thumbScale: 2,
      },
      {
        id: 'straight5_tower',
        name: '箭塔',
        match: { kind: 'any' },
        rows: [['building_tower']],
        colSpacing: 1.2,
        rowSpacing: 1.4,
        thumbScale: 2,
      },
    ];
    applyCardFormationDrafts(draft);
    try {
      const cards = ['2-spades', '3-hearts', '4-clubs', '5-diamonds', '6-spades'].map(
        (id) => getPokerCardById(id)!,
      );
      const formation = getFormationsFor(['straight5'], cards).find((entry) => entry.id === 'straight5_number')!;
      expect(formation.rows).toEqual([['ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt']]);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('连对按点数段匹配可配置站位，且战车全局可选', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['two_pair'], cards(...cardIds)).map((formation) => formation.id);
    const formationFor = (cardIds: string[], id: string) =>
      getFormationsFor(['two_pair'], cards(...cardIds)).find((formation) => formation.id === id)!;

    expect(CARD_FORMATIONS.two_pair.map((entry) => entry.id)).toEqual([
      'two_pair_number',
      'two_pair_A2',
      'two_pair_10J',
      'two_pair_JQ',
      'two_pair_QK',
      'two_pair_KA',
      'two_pair_chariot',
    ]);

    expect(idsFor(['4-spades', '4-hearts', '5-clubs', '5-diamonds'])).toEqual([
      'two_pair_number',
      'two_pair_chariot',
    ]);
    expect(formationFor(['4-spades', '4-hearts', '5-clubs', '5-diamonds'], 'two_pair_number').rows).toEqual([
      ['melee_grunt', 'melee_grunt', 'melee_grunt', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);
    expect(formationFor(['4-spades', '4-hearts', '5-clubs', '5-diamonds'], 'two_pair_chariot').rows).toEqual([
      ['ranged_chariot'],
    ]);

    expect(idsFor(['A-spades', 'A-hearts', '2-clubs', '2-diamonds'])).toEqual([
      'two_pair_A2',
      'two_pair_chariot',
    ]);
    expect(formationFor(['A-spades', 'A-hearts', '2-clubs', '2-diamonds'], 'two_pair_A2').rows).toEqual([
      ['melee_grunt', 'melee_cavalry', 'melee_cavalry', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);
    expect(idsFor(['10-spades', '10-hearts', 'J-clubs', 'J-diamonds'])).toEqual([
      'two_pair_10J',
      'two_pair_chariot',
    ]);
    expect(formationFor(['10-spades', '10-hearts', 'J-clubs', 'J-diamonds'], 'two_pair_10J').rows).toEqual([
      ['melee_grunt', 'melee_guard', 'melee_guard', 'melee_grunt'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);
    expect(idsFor(['J-spades', 'J-hearts', 'Q-clubs', 'Q-diamonds'])).toEqual([
      'two_pair_JQ',
      'two_pair_chariot',
    ]);
    expect(formationFor(['J-spades', 'J-hearts', 'Q-clubs', 'Q-diamonds'], 'two_pair_JQ').rows).toEqual([
      ['melee_grunt', 'melee_guard', 'melee_guard', 'melee_grunt'],
      ['ranged_archer', 'hero_queen', 'hero_queen', 'ranged_archer'],
    ]);
    expect(idsFor(['Q-spades', 'Q-hearts', 'K-clubs', 'K-diamonds'])).toEqual([
      'two_pair_QK',
      'two_pair_chariot',
    ]);
    expect(formationFor(['Q-spades', 'Q-hearts', 'K-clubs', 'K-diamonds'], 'two_pair_QK').rows).toEqual([
      ['melee_grunt', 'hero_king', 'hero_king', 'melee_grunt'],
      ['ranged_archer', 'hero_queen', 'hero_queen', 'ranged_archer'],
    ]);
    expect(idsFor(['K-spades', 'K-hearts', 'A-clubs', 'A-diamonds'])).toEqual([
      'two_pair_KA',
      'two_pair_chariot',
    ]);
    expect(formationFor(['K-spades', 'K-hearts', 'A-clubs', 'A-diamonds'], 'two_pair_KA').rows).toEqual([
      ['hero_king', 'melee_cavalry', 'melee_cavalry', 'hero_king'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);
  });

  it('连对尊重配置 rows，不因规则重排站位', () => {
    const draft = dumpCardFormationDrafts();
    draft.two_pair = [
      {
        id: 'two_pair_number',
        name: '自定义数字连对',
        match: { kind: 'numbers' },
        rows: [['ranged_archer', 'ranged_archer'], ['melee_grunt', 'melee_grunt', 'melee_grunt', 'melee_grunt']],
        colSpacing: 1.2,
        rowSpacing: 1.4,
        thumbScale: 2,
      },
      {
        id: 'two_pair_QK',
        name: '自定义 Q-K 连对',
        match: { kind: 'ranks', ranks: ['Q', 'K'] },
        rows: [['hero_king'], ['hero_queen', 'hero_queen', 'hero_queen']],
        colSpacing: 1.2,
        rowSpacing: 1.4,
        thumbScale: 2,
      },
    ];
    applyCardFormationDrafts(draft);
    try {
      const numberCards = ['4-spades', '4-hearts', '5-clubs', '5-diamonds'].map((id) => getPokerCardById(id)!);
      const numberFormation = getFormationsFor(['two_pair'], numberCards).find(
        (entry) => entry.id === 'two_pair_number',
      )!;
      expect(numberFormation.rows).toEqual([
        ['ranged_archer', 'ranged_archer'],
        ['melee_grunt', 'melee_grunt', 'melee_grunt', 'melee_grunt'],
      ]);

      const faceCards = ['Q-spades', 'Q-hearts', 'K-clubs', 'K-diamonds'].map((id) => getPokerCardById(id)!);
      const faceFormation = getFormationsFor(['two_pair'], faceCards).find(
        (entry) => entry.id === 'two_pair_QK',
      )!;
      expect(faceFormation.rows).toEqual([['hero_king'], ['hero_queen', 'hero_queen', 'hero_queen']]);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('单张按点数匹配独立阵型，且不能走对子绕过王炸', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const formationFor = (category: Parameters<typeof getFormationsFor>[0], ids: string[], id: string) =>
      getFormationsFor(category, cards(...ids)).find((formation) => formation.id === id);
    const idsFor = (category: Parameters<typeof getFormationsFor>[0], cardIds: string[]) =>
      getFormationsFor(category, cards(...cardIds)).map((formation) => formation.id);

    expect(formationFor(['single'], ['joker-black'], 'single_joker_black')?.units).toEqual([
      { typeId: 'hero_mage', count: 1 },
    ]);
    expect(formationFor(['single'], ['joker-red'], 'single_joker_red')?.units).toEqual([
      { typeId: 'hero_archmage', count: 1 },
    ]);
    expect(idsFor(['single'], ['J-spades'])).toEqual(['single_J']);
    expect(idsFor(['single'], ['Q-hearts'])).toEqual(['single_Q']);
    expect(idsFor(['single'], ['K-clubs'])).toEqual(['single_K']);
    expect(idsFor(['single'], ['A-diamonds'])).toEqual(['single_A']);
    expect(idsFor(['single'], ['5-spades']).sort()).toEqual(['single_archer', 'single_grunt']);
    // 数字牌方案对王牌不适用；王炸对子也不应展开为对子方案。
    expect(formationFor(['single'], ['joker-black'], 'single_grunt')).toBeUndefined();
    expect(idsFor(['pair'], ['joker-black', 'joker-red'])).toEqual([]);
  });

  it('单张出兵以配置 rows 为准，可按点数单独改兵种', () => {
    const drafts = dumpCardFormationDrafts();
    const ace = drafts.single.find((entry) => entry.id === 'single_A');
    expect(ace).toBeDefined();
    ace!.rows = [['melee_grunt', 'ranged_archer']];
    applyCardFormationDrafts(drafts);

    const formation = getFormationsFor(['single'], [getPokerCardById('A-spades')!]).find(
      (entry) => entry.id === 'single_A',
    );
    expect(formation?.rows).toEqual([['melee_grunt', 'ranged_archer']]);
    expect(formation?.units).toEqual([
      { typeId: 'melee_grunt', count: 1 },
      { typeId: 'ranged_archer', count: 1 },
    ]);
    // J 不受 A 配置影响
    expect(
      getFormationsFor(['single'], [getPokerCardById('J-spades')!]).find((entry) => entry.id === 'single_J')
        ?.units,
    ).toEqual([{ typeId: 'melee_guard', count: 1 }]);

    resetCardFormationsToDefault();
  });

  it('对子按点数匹配独立阵型，出兵以配置 rows 为准', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['pair'], cards(...cardIds)).map((formation) => formation.id);

    expect(idsFor(['J-spades', 'J-hearts'])).toEqual(['pair_J']);
    expect(idsFor(['Q-spades', 'Q-hearts'])).toEqual(['pair_Q']);
    expect(idsFor(['K-spades', 'K-hearts'])).toEqual(['pair_K']);
    expect(idsFor(['A-spades', 'A-hearts'])).toEqual(['pair_A']);
    expect(idsFor(['5-spades', '5-hearts']).sort()).toEqual(['pair_archer', 'pair_grunt']);

    const drafts = dumpCardFormationDrafts();
    const ace = drafts.pair.find((entry) => entry.id === 'pair_A');
    expect(ace).toBeDefined();
    ace!.rows = [['melee_grunt'], ['ranged_archer']];
    applyCardFormationDrafts(drafts);

    const formation = getFormationsFor(['pair'], cards('A-spades', 'A-hearts')).find(
      (entry) => entry.id === 'pair_A',
    );
    expect(formation?.rows).toEqual([['melee_grunt'], ['ranged_archer']]);
    expect(formation?.units).toEqual([
      { typeId: 'melee_grunt', count: 1 },
      { typeId: 'ranged_archer', count: 1 },
    ]);

    resetCardFormationsToDefault();
  });

  it('葫芦按三条点数分档匹配，对子点数不参与分档', () => {
    const cards = (...ids: string[]) => ids.map((id) => getPokerCardById(id)!);
    const idsFor = (cardIds: string[]) =>
      getFormationsFor(['full_house'], cards(...cardIds)).map((formation) => formation.id);
    const lowIds = ['full_house_tower_2_10', 'full_house_dragon_2_10', 'full_house_custom_4_2_10'];
    const highIds = ['full_house_tower_JA', 'full_house_dragon_JA', 'full_house_custom_4_JA'];

    expect(CARD_FORMATIONS.full_house.map((entry) => entry.id)).toEqual([...lowIds, ...highIds]);
    expect(idsFor(['5-spades', '5-hearts', '5-clubs', '9-diamonds', '9-spades'])).toEqual(lowIds);
    expect(idsFor(['8-spades', '8-hearts', '8-clubs', '2-diamonds', '2-spades'])).toEqual(lowIds);
    expect(idsFor(['J-spades', 'J-hearts', 'J-clubs', '9-diamonds', '9-spades'])).toEqual(highIds);
    expect(idsFor(['A-spades', 'A-hearts', 'A-clubs', '2-diamonds', '2-spades'])).toEqual(highIds);
  });

  it('缺少 match 的草稿被严格拒绝', () => {
    const missingMatch = dumpCardFormationDrafts();
    delete (missingMatch.single[0] as { match?: unknown }).match;
    expect(validateCardFormationDrafts(missingMatch)).toContain('缺少牌面匹配配置');

    const badRanks = dumpCardFormationDrafts();
    badRanks.single[0]!.match = { kind: 'ranks', ranks: [] };
    expect(validateCardFormationDrafts(badRanks)).toContain('点数匹配不能为空');

    const missingBounds = dumpCardFormationDrafts();
    missingBounds.flush[0]!.match = { kind: 'rankCount', ranks: ['J', 'Q', 'K', 'A'] };
    expect(validateCardFormationDrafts(missingBounds)).toContain('至少要设置下限或上限');
  });

  it('dump 保留炸弹点数伤害，非法表被拒绝', () => {
    const drafts = dumpCardFormationDrafts();
    const triple = drafts.triple.find((entry) => entry.id === 'triple_small_bomb');
    expect(triple?.rankDamage?.['2-10']).toBe(600);
    expect(triple?.rankDamage?.A).toBe(1000);
    const bomb = drafts.bomb.find((entry) => entry.id === 'bomb_giant_bomb');
    expect(bomb?.rankDamage?.['2-10']).toBe(1200);
    const rocket = drafts.rocket.find((entry) => entry.id === 'rocket_bomb');
    expect(rocket?.damage).toBe(1500);

    triple!.rankDamage = { ...triple!.rankDamage, J: 1234 };
    applyCardFormationDrafts(drafts);
    try {
      const dumped = dumpCardFormationDrafts();
      expect(dumped.triple.find((entry) => entry.id === 'triple_small_bomb')?.rankDamage?.J).toBe(1234);
    } finally {
      resetCardFormationsToDefault();
    }

    const unknownRank = dumpCardFormationDrafts();
    unknownRank.triple[0]!.rankDamage = { XX: 1 } as never;
    expect(validateCardFormationDrafts(unknownRank)).toContain('未知档位');

    const negativeRank = dumpCardFormationDrafts();
    negativeRank.triple.find((entry) => entry.id === 'triple_small_bomb')!.rankDamage = { '2-10': -1 };
    expect(validateCardFormationDrafts(negativeRank)).toContain('不小于 0');

    const negativeFlat = dumpCardFormationDrafts();
    negativeFlat.rocket.find((entry) => entry.id === 'rocket_bomb')!.damage = -1;
    expect(validateCardFormationDrafts(negativeFlat)).toContain('炸弹伤害必须是不小于 0 的数字');
  });

  it('同花按 J～A 张数分档，两档互斥', () => {
    const lowCards = ['2-spades', '4-spades', '6-spades', '8-spades', 'J-spades'].map(
      (id) => getPokerCardById(id)!,
    );
    const highCards = ['2-spades', '4-spades', '6-spades', 'J-spades', 'Q-spades'].map(
      (id) => getPokerCardById(id)!,
    );
    expect(getFormationsFor(['flush'], lowCards).map((entry) => entry.id)).toEqual([
      'flush_tower',
      'flush_dragon',
      'flush_custom_3',
    ]);
    expect(getFormationsFor(['flush'], highCards).map((entry) => entry.id)).toEqual([
      'flush_tower_JA',
      'flush_dragon_JA',
      'flush_custom_3_JA',
    ]);
  });

  it('同花与炸弹出兵以配置 rows 为准', () => {
    const drafts = dumpCardFormationDrafts();
    const flushDragon = drafts.flush.find((entry) => entry.id === 'flush_dragon');
    expect(flushDragon).toBeDefined();
    flushDragon!.rows = [['melee_grunt']];
    const bomb = drafts.bomb.find((entry) => entry.id === 'bomb_giant_bomb');
    expect(bomb).toBeDefined();
    bomb!.rows = [['small_bomb']];
    applyCardFormationDrafts(drafts);
    try {
      const flushCards = ['2-spades', '4-spades', '6-spades', '8-spades', 'J-spades'].map(
        (id) => getPokerCardById(id)!,
      );
      const flush = getFormationsFor(['flush'], flushCards).find((entry) => entry.id === 'flush_dragon');
      expect(flush?.rows).toEqual([['melee_grunt']]);

      const bombCards = ['5-spades', '5-hearts', '5-clubs', '5-diamonds'].map(
        (id) => getPokerCardById(id)!,
      );
      const resolvedBomb = getFormationsFor(['bomb'], bombCards).find(
        (entry) => entry.id === 'bomb_giant_bomb',
      );
      expect(resolvedBomb?.rows).toEqual([['small_bomb']]);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('cloneFormationDraft 改副本 rows / match 不影响源草稿', () => {
    const source: FormationDraft = {
      id: 'single_J',
      name: '单张 J',
      match: { kind: 'ranks', ranks: ['J'] },
      rows: [['melee_guard']],
      colSpacing: 1.2,
      rankDamage: { J: 80 },
    };
    const copy = cloneFormationDraft(source);
    copy.rows[0]!.push('melee_grunt');
    copy.rows.push(['ranged_archer']);
    if (copy.match.kind === 'ranks') copy.match.ranks.push('Q');
    copy.rankDamage!.J = 120;

    expect(source.rows).toEqual([['melee_guard']]);
    expect(source.match).toEqual({ kind: 'ranks', ranks: ['J'] });
    expect(source.rankDamage).toEqual({ J: 80 });
    expect(copy.rows).toEqual([['melee_guard', 'melee_grunt'], ['ranged_archer']]);
  });

  it('allocateCopiedFormationIdentity 在已占用 id 时递增后缀', () => {
    const source: FormationDraft = {
      id: 'single_J',
      name: '单张 J',
      match: { kind: 'ranks', ranks: ['J'] },
      rows: [['melee_guard']],
    };
    expect(allocateCopiedFormationIdentity(source, new Set(), [])).toEqual({
      id: 'single_J_copy',
      name: '单张 J 副本',
    });
    expect(
      allocateCopiedFormationIdentity(source, new Set(['single_J_copy']), ['单张 J 副本']),
    ).toEqual({
      id: 'single_J_copy2',
      name: '单张 J 副本2',
    });
    expect(
      allocateCopiedFormationIdentity(
        { ...source, id: 'single_J_copy', name: '单张 J 副本' },
        new Set(['single_J_copy']),
        ['单张 J 副本'],
      ),
    ).toEqual({
      id: 'single_J_copy2',
      name: '单张 J 副本2',
    });
  });

  it('只含一种兵种时返回该兵种默认角标，混编或空阵型不返回', () => {
    expect(getExclusiveFormationUnitTag({ rows: [['melee_grunt'], ['melee_grunt']] })).toBe('近战');
    expect(getExclusiveFormationUnitTag({ rows: [['ranged_archer']] })).toBe('远程');
    expect(getExclusiveFormationUnitTag({ rows: [['hero_queen']] })).toBe('治疗');
    expect(getExclusiveFormationUnitTag({ rows: [['hero_mage']] })).toBe('召唤');
    expect(
      getExclusiveFormationUnitTag({
        rows: [['melee_grunt'], ['ranged_archer']],
      }),
    ).toBe('');
    expect(getExclusiveFormationUnitTag({ rows: [] })).toBe('');
  });

  it('角标写入时去掉首尾空白', () => {
    const drafts = dumpUnitConfigDrafts();
    drafts.melee_grunt.tag = ' 先锋 ';
    applyUnitConfigDrafts(drafts);
    try {
      expect(getExclusiveFormationUnitTag({ rows: [['melee_grunt']] })).toBe('先锋');
    } finally {
      resetUnitConfigsToDefault();
    }
  });

  it('matchRuleKey 对 ranks 顺序不敏感，label 按点数表展示', () => {
    expect(matchRuleKey({ kind: 'any' })).toBe('any');
    expect(matchRuleKey({ kind: 'numbers' })).toBe('numbers');
    expect(matchRuleKey({ kind: 'joker', joker: 'black' })).toBe('joker:black');
    expect(matchRuleKey({ kind: 'ranks', ranks: ['3', 'A', '2'] })).toBe(
      matchRuleKey({ kind: 'ranks', ranks: ['A', '2', '3'] }),
    );
    expect(matchRuleKey({ kind: 'tripleRanks', ranks: ['10', '2', '5'] })).toBe(
      matchRuleKey({ kind: 'tripleRanks', ranks: ['2', '5', '10'] }),
    );
    expect(matchRuleKey({ kind: 'rankCount', ranks: ['A', 'J'], min: 2 })).toBe(
      matchRuleKey({ kind: 'rankCount', ranks: ['J', 'A'], min: 2 }),
    );
    expect(formatMatchRuleLabel({ kind: 'any' })).toBe('任意');
    expect(formatMatchRuleLabel({ kind: 'numbers' })).toBe('数字牌 2～10');
    expect(formatMatchRuleLabel({ kind: 'joker', joker: 'red' })).toBe('大王');
    expect(formatMatchRuleLabel({ kind: 'ranks', ranks: ['Q', 'K', 'A'] })).toBe('Q-K-A');
    expect(
      formatMatchRuleLabel({
        kind: 'tripleRanks',
        ranks: ['2', '3', '4', '5', '6', '7', '8', '9', '10'],
      }),
    ).toBe('三条 2～10');
    expect(formatMatchRuleLabel({ kind: 'tripleRanks', ranks: ['J', 'Q', 'K', 'A'] })).toBe(
      '三条 J～A',
    );
    expect(formatMatchRuleLabel({ kind: 'rankCount', ranks: ['J', 'Q', 'K', 'A'], min: 2 })).toBe(
      '含 2+ 张 J～A',
    );
    expect(formatMatchRuleLabel({ kind: 'rankCount', ranks: ['J', 'Q', 'K', 'A'], max: 1 })).toBe(
      '含 0～1 张 J～A',
    );
  });

  it('groupFormationsByMatch 按首次出现顺序合并同一 match', () => {
    const drafts = dumpCardFormationDrafts();
    const single = groupFormationsByMatch(drafts.single);
    expect(single.map((group) => group.label)).toEqual([
      '数字牌 2～10',
      'J',
      'Q',
      'K',
      'A',
      '小王',
      '大王',
    ]);
    expect(single[0]!.indices.map((index) => drafts.single[index]!.name)).toEqual([
      '单民兵',
      '单弓手',
    ]);

    const flushGroups = groupFormationsByMatch(drafts.flush);
    expect(flushGroups.map((group) => group.label)).toEqual(['含 0～1 张 J～A', '含 2+ 张 J～A']);
    expect(flushGroups[0]!.indices.map((index) => drafts.flush[index]!.name)).toEqual([
      '箭塔',
      '巨龙',
      '石头人',
    ]);
    expect(flushGroups[1]!.indices.map((index) => drafts.flush[index]!.name)).toEqual([
      '箭塔',
      '巨龙',
      '石头人',
    ]);

    const straightFlush = groupFormationsByMatch(drafts.straight_flush);
    expect(straightFlush).toHaveLength(1);
    expect(straightFlush[0]!.label).toBe('任意');
    expect(straightFlush[0]!.indices).toHaveLength(drafts.straight_flush.length);

    const fullHouse = groupFormationsByMatch(drafts.full_house);
    expect(fullHouse.map((group) => group.label)).toEqual(['三条 2～10', '三条 J～A']);
    expect(fullHouse[0]!.indices.map((index) => drafts.full_house[index]!.name)).toEqual([
      '双射手箭塔',
      '飞龙',
      '小石头人',
    ]);
    expect(fullHouse[1]!.indices.map((index) => drafts.full_house[index]!.name)).toEqual([
      '三射手箭塔',
      '喷火龙',
      '大石头人',
    ]);
  });
});
