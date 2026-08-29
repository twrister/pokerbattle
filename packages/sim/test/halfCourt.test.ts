import { afterEach, describe, expect, it } from 'vitest';
import {
  Faction,
  applyArenaPreset,
  createCardFormation,
  halfCourtSafeAnchor,
  halfCourtSlotAnchorX,
} from '../src/index.js';

/** 单兵阵型，只用来读自动出兵锚点。 */
function gruntFormation() {
  return createCardFormation('single', {
    id: 'test_default_anchor',
    name: '测试单兵',
    match: { kind: 'any' },
    rows: [['melee_grunt']],
  });
}

describe('半场默认出兵锚点', () => {
  afterEach(() => {
    applyArenaPreset('1v1');
  });

  it('1v1 默认落在半场中央，与主堡同 X', () => {
    expect(halfCourtSlotAnchorX('1v1', 0)).toBe(9);
    expect(halfCourtSlotAnchorX('1v1', 1)).toBe(9);
    const anchor = halfCourtSafeAnchor(gruntFormation(), Faction.Blue, halfCourtSlotAnchorX('1v1', 0));
    expect(anchor?.x).toBe(9);
  });

  it('2v2 默认与己方主堡垂直对齐，不走战场中线', () => {
    applyArenaPreset('2v2');
    expect(halfCourtSlotAnchorX('2v2', 0)).toBe(6);
    expect(halfCourtSlotAnchorX('2v2', 1)).toBe(18);
    expect(halfCourtSlotAnchorX('2v2', 2)).toBe(6);
    expect(halfCourtSlotAnchorX('2v2', 3)).toBe(18);

    const left = halfCourtSafeAnchor(gruntFormation(), Faction.Blue, halfCourtSlotAnchorX('2v2', 0));
    const right = halfCourtSafeAnchor(gruntFormation(), Faction.Blue, halfCourtSlotAnchorX('2v2', 1));
    expect(left?.x).toBe(6);
    expect(right?.x).toBe(18);
    expect(left?.x).not.toBe(12);
    expect(right?.x).not.toBe(12);
  });
});
