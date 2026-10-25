import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Faction, UNIT_CONFIGS, toFloat } from '@pb/sim';
import { INSPIRE_BURST_SEC, InspireBurst, InspireSparks, KingInspireAura } from '../src/view/inspireFx.js';
import { UnitView } from '../src/view/unitView.js';

/** 振奋特效：国王范围环、上升光点、进入爆闪三件事的行为约束。 */
describe('振奋特效', () => {
  it('国王范围环的缩放等于配置的振奋半径', () => {
    const radius = toFloat(UNIT_CONFIGS.hero_king.inspire!.radius);
    const aura = new KingInspireAura(radius);
    const ring = aura.group.children.find((c) => c.name !== 'ground-glow-mark')!;
    expect(ring.scale.x).toBeCloseTo(radius, 5);
    aura.dispose();
  });

  it('爆闪：开始后可见，超过时长自动隐藏', () => {
    const burst = new InspireBurst(1);
    burst.start(10);
    expect(burst.group.visible).toBe(true);
    burst.update(10 + INSPIRE_BURST_SEC * 0.5);
    expect(burst.group.visible).toBe(true);
    burst.update(10 + INSPIRE_BURST_SEC + 0.01);
    expect(burst.group.visible).toBe(false);
    burst.dispose();
  });

  it('光点：位置落在 0..height 内，缩放不为负', () => {
    const sparks = new InspireSparks(1, 2);
    const camera = new THREE.PerspectiveCamera();
    for (const t of [0, 0.3, 0.9, 1.7]) {
      sparks.update(t, camera);
      for (const spark of sparks.group.children) {
        expect(spark.position.y).toBeGreaterThanOrEqual(0);
        expect(spark.position.y).toBeLessThanOrEqual(2);
        expect(spark.scale.x).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('只有国王创建范围环，普通单位没有', () => {
    const king = new UnitView(Faction.Blue, 'hero_king');
    const grunt = new UnitView(Faction.Blue, 'melee_grunt');
    expect(king.group.getObjectByName('king-inspire-aura')).toBeDefined();
    expect(grunt.group.getObjectByName('king-inspire-aura')).toBeUndefined();
    king.dispose();
    grunt.dispose();
  });
});
