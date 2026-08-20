import { describe, expect, it } from 'vitest';
import { createCardFormation } from '@pb/sim';
import {
  attackReachPreviewRadius,
  formationAttackRangePreviewRadius,
  showsAttackRangeOnPlace,
} from '../src/input/attackRangePreview.js';

describe('放置攻击范围预览', () => {
  it('三种箭塔、连弩车、投弹车需要放置射程圈，其余兵种不要', () => {
    expect(showsAttackRangeOnPlace('building_tower')).toBe(true);
    expect(showsAttackRangeOnPlace('building_tower_advanced')).toBe(true);
    expect(showsAttackRangeOnPlace('building_tower_triple')).toBe(true);
    expect(showsAttackRangeOnPlace('ranged_ballista')).toBe(true);
    expect(showsAttackRangeOnPlace('ranged_chariot')).toBe(true);
    expect(showsAttackRangeOnPlace('melee_grunt')).toBe(false);
    expect(showsAttackRangeOnPlace('ranged_archer')).toBe(false);
    expect(showsAttackRangeOnPlace('giant_bomb')).toBe(false);
    expect(showsAttackRangeOnPlace('small_bomb')).toBe(false);
  });

  it('远程圈半径只算 range，与选中单位白圈一致', () => {
    expect(attackReachPreviewRadius('building_tower')).toBeCloseTo(8);
    expect(attackReachPreviewRadius('building_tower_advanced')).toBeCloseTo(8);
    expect(attackReachPreviewRadius('building_tower_triple')).toBeCloseTo(9);
    expect(attackReachPreviewRadius('ranged_ballista')).toBeCloseTo(7);
    expect(attackReachPreviewRadius('ranged_chariot')).toBeCloseTo(11);
  });

  it('民兵或炸弹阵型不画攻击范围圈', () => {
    const grunt = createCardFormation('single', {
      id: 'test_grunt',
      name: '民兵',
      match: { kind: 'any' },
      rows: [['melee_grunt']],
    });
    const bomb = createCardFormation('single', {
      id: 'test_bomb',
      name: '炸弹',
      match: { kind: 'any' },
      rows: [['giant_bomb']],
    });
    expect(formationAttackRangePreviewRadius(grunt)).toBeNull();
    expect(formationAttackRangePreviewRadius(bomb)).toBeNull();
  });

  it('单槽连弩车 / 投弹车 / 箭塔阵型返回对应半径', () => {
    const ballista = createCardFormation('single', {
      id: 'test_ballista',
      name: '连弩车',
      match: { kind: 'any' },
      rows: [['ranged_ballista']],
    });
    const chariot = createCardFormation('single', {
      id: 'test_chariot',
      name: '投弹车',
      match: { kind: 'any' },
      rows: [['ranged_chariot']],
    });
    const tower = createCardFormation('single', {
      id: 'test_tower',
      name: '箭塔',
      match: { kind: 'any' },
      rows: [['building_tower']],
    });
    expect(formationAttackRangePreviewRadius(ballista)).toBeCloseTo(7);
    expect(formationAttackRangePreviewRadius(chariot)).toBeCloseTo(11);
    expect(formationAttackRangePreviewRadius(tower)).toBeCloseTo(8);
  });

  it('混编含连弩车仍给出连弩车半径；同时有投弹车时取较大射程', () => {
    const mixed = createCardFormation('pair', {
      id: 'test_mixed_ballista',
      name: '民兵连弩',
      match: { kind: 'any' },
      rows: [['melee_grunt', 'ranged_ballista']],
    });
    const both = createCardFormation('pair', {
      id: 'test_both_ranged',
      name: '连弩投弹',
      match: { kind: 'any' },
      rows: [['ranged_ballista', 'ranged_chariot']],
    });
    expect(formationAttackRangePreviewRadius(mixed)).toBeCloseTo(7);
    expect(formationAttackRangePreviewRadius(both)).toBeCloseTo(11);
  });
});
