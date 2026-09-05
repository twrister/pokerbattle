import { afterEach, describe, expect, it } from 'vitest';
import {
  Faction,
  applyArenaPreset,
  createCardFormation,
  halfCourtSafeAnchor,
  halfCourtSlotAnchorX,
  halfCourtYRange,
  normalizeDeployAnchor,
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

describe('靠河出兵锚点容错', () => {
  afterEach(() => {
    applyArenaPreset('1v1');
  });

  it('半场内坐标原样返回', () => {
    expect(normalizeDeployAnchor(9, 8, Faction.Blue)).toEqual({ x: 9, y: 8 });
    const { minY, maxY } = halfCourtYRange(Faction.Red);
    const insideY = (minY + maxY) / 2;
    expect(normalizeDeployAnchor(9, insideY, Faction.Red)).toEqual({ x: 9, y: insideY });
  });

  it('蓝方贴河越界 2 格内夹回岸边，超出仍拒', () => {
    const { maxY } = halfCourtYRange(Faction.Blue);
    const snapped = normalizeDeployAnchor(9, maxY + 0.8, Faction.Blue);
    expect(snapped).not.toBeNull();
    expect(snapped!.x).toBe(9);
    expect(snapped!.y).toBeLessThan(maxY);
    expect(normalizeDeployAnchor(9, maxY + 2, Faction.Blue)).toBeNull();
  });

  it('红方贴河越界 2 格内夹回岸边，超出仍拒', () => {
    const { minY } = halfCourtYRange(Faction.Red);
    const snapped = normalizeDeployAnchor(9, minY - 0.8, Faction.Red);
    expect(snapped).toEqual({ x: 9, y: minY });
    expect(normalizeDeployAnchor(9, minY - 2, Faction.Red)).toBeNull();
  });
});
