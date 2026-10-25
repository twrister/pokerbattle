import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundHazardView, hazardLifeAlpha } from '../src/view/groundHazardView.js';

/** 喷火龙燃烧区只保留火焰本体：不再叠任何边界环，缩放与淡入淡出仍要正确。 */
describe('地面燃烧区', () => {
  it('只有火焰网格，没有边界环', () => {
    const view = new GroundHazardView();
    expect(view.group.name).toBe('ground-hazard');
    expect(view.group.children).toHaveLength(1);
    expect(view.group.children[0]!.name).toBe('ground-hazard-burn');
    let hasRing = false;
    view.group.traverse((child) => {
      if (child.name.startsWith('ground-ring')) hasRing = true;
    });
    expect(hasRing).toBe(false);
  });

  it('按半径缩放，透明度跟随生命周期', () => {
    const view = new GroundHazardView();
    view.update({ id: 3, x: 10, y: 10, radius: 2, progress: 0.95 });
    const burn = view.group.children[0] as THREE.Mesh;
    expect(burn.scale.x).toBeCloseTo(2, 5);
    const mat = burn.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uOpacity!.value).toBeCloseTo(hazardLifeAlpha(0.95), 5);
  });
});
