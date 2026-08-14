import { describe, expect, it } from 'vitest';
import { debugSpawnUnitTypeIds } from '../src/debug/panel.js';

describe('调试模式选兵栏', () => {
  it('默认不含建筑', () => {
    const ids = debugSpawnUnitTypeIds(false);
    expect(ids).not.toContain('building_tower');
    expect(ids).not.toContain('building_tower_advanced');
    expect(ids).not.toContain('building_tower_triple');
    expect(ids).not.toContain('building_base');
  });

  it('调试放兵附带三种箭塔且不含基地', () => {
    const ids = debugSpawnUnitTypeIds(true);
    expect(ids).toContain('building_tower');
    expect(ids).toContain('building_tower_advanced');
    expect(ids).toContain('building_tower_triple');
    expect(ids).not.toContain('building_base');
    expect(ids.indexOf('building_tower')).toBeLessThan(ids.indexOf('building_tower_advanced'));
    expect(ids.indexOf('building_tower_advanced')).toBeLessThan(ids.indexOf('building_tower_triple'));
  });
});
