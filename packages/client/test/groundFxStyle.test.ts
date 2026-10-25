import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GROUND_FX, GroundGlowMark, GroundRingMark } from '../src/view/groundFxStyle.js';
import { AoeGroundMark, createAttackRangeMark } from '../src/view/aoeGroundMark.js';

/**
 * 地面提示改成有宽度的环面，是为了在浅沙色场地上仍然可辨。
 * 这里守住三件事：环是网格而非 1px 线、描边跟着淡出、半径缩放只走 group。
 */
describe('地面提示环', () => {
  it('主环是有宽度的网格而不是 LineLoop', () => {
    const mark = new GroundRingMark({ color: GROUND_FX.warnFill });
    const ring = mark.group.children.find((child) => child.name === 'ground-ring');
    expect(ring).toBeInstanceOf(THREE.Mesh);
    expect(ring).not.toBeInstanceOf(THREE.LineLoop);
    mark.dispose();
  });

  it('默认带深色描边，并随透明度一起淡出', () => {
    const mark = new GroundRingMark({ color: GROUND_FX.warnFill, opacity: 1 });
    const outline = mark.group.children.find((child) => child.name === 'ground-ring-outline')!;
    const ring = mark.group.children.find((child) => child.name === 'ground-ring')!;
    const outlineMat = (outline as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const ringMat = (ring as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(outlineMat.color.getHex()).toBe(GROUND_FX.outline);
    // 描边始终比主环淡，否则会把彩色环压成黑框
    expect(outlineMat.opacity).toBeLessThan(ringMat.opacity);

    mark.setOpacity(0.5);
    expect(ringMat.opacity).toBeCloseTo(0.5, 5);
    expect(outlineMat.opacity).toBeCloseTo(0.25, 5);
    mark.dispose();
  });

  it('可以关掉描边，白色射程圈走这条路径', () => {
    const mark = new GroundRingMark({ color: GROUND_FX.range, outline: false });
    expect(mark.group.children.some((child) => child.name === 'ground-ring-outline')).toBe(false);
    mark.dispose();
  });

  it('setRadius 缩放整组，环宽随半径等比', () => {
    const mark = new GroundRingMark({ color: GROUND_FX.hazardFill });
    mark.setRadius(3);
    expect(mark.group.scale.x).toBeCloseTo(3, 5);
    mark.dispose();
  });

  it('绝对环宽模式下，半径变化后世界环宽不变', () => {
    const mark = new GroundRingMark({ color: GROUND_FX.range, outline: false, width: 0.2 });
    const ring = mark.group.children.find((child) => child.name === 'ground-ring') as THREE.Mesh;
    const bandOf = (): number => {
      const p = (ring.geometry as THREE.RingGeometry).parameters;
      return (p.outerRadius - p.innerRadius) * mark.group.scale.x;
    };
    mark.setRadius(5);
    expect(bandOf()).toBeCloseTo(0.2, 3);
    mark.setRadius(11);
    expect(bandOf()).toBeCloseTo(0.2, 3);
    expect((ring.geometry as THREE.RingGeometry).parameters.outerRadius).toBe(1);
    mark.dispose();
  });

  it('外径严格等于真实半径，描边不向外溢出', () => {
    const mark = new GroundRingMark({ color: GROUND_FX.warnFill, thickness: 0.1 });
    const ring = mark.group.children.find((child) => child.name === 'ground-ring') as THREE.Mesh;
    const outline = mark.group.children.find(
      (child) => child.name === 'ground-ring-outline',
    ) as THREE.Mesh;
    const ringGeo = ring.geometry as THREE.RingGeometry;
    const outlineGeo = outline.geometry as THREE.RingGeometry;
    // 范围圈的外径必须是真实半径，往外多画一点都会让玩家误判爆炸边界
    expect(ringGeo.parameters.outerRadius).toBe(1);
    expect(outlineGeo.parameters.outerRadius).toBeLessThanOrEqual(1);
    mark.dispose();
  });
});

/** 柔光晕用来替代实心圆盘底盘：只在外缘聚色，中心留空，不压住脚下的单位贴图。 */
describe('地面柔光晕', () => {
  it('外径等于真实半径，并按缩放落在场景里', () => {
    const glow = new GroundGlowMark({ color: GROUND_FX.castGround });
    const mesh = glow.group.children[0] as THREE.Mesh;
    expect(mesh.name).toBe('ground-glow');
    expect((mesh.geometry as THREE.RingGeometry).parameters.outerRadius).toBe(1);

    glow.setRadius(2.5);
    expect(glow.group.scale.x).toBeCloseTo(2.5, 5);
    glow.dispose();
  });

  it('透明度按构造基准等比缩放，0 时完全透明', () => {
    const glow = new GroundGlowMark({ color: GROUND_FX.inspireGlow, opacity: 0.4 });
    const uniforms = (glow.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(uniforms.uniforms.uOpacity!.value).toBeCloseTo(0.4, 5);

    glow.setOpacity(0.5);
    expect(uniforms.uniforms.uOpacity!.value).toBeCloseTo(0.2, 5);

    glow.setOpacity(0);
    expect(uniforms.uniforms.uOpacity!.value).toBe(0);
    glow.dispose();
  });
});

/** 危险区只保留纯色圆面；攻击范围只保留细白环，两种形态不要互相串样式。 */
describe('地面范围标记', () => {
  it('爆炸预警只有红色圆面，没有硬边界', () => {
    const mark = new AoeGroundMark();
    const fill = mark.group.children[0] as THREE.Mesh;
    expect((fill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(GROUND_FX.warnFill);
    expect(mark.group.children.some((child) => child instanceof THREE.Group)).toBe(false);
    mark.dispose();
  });

  it('攻击范围圈是白色细环，无填充无描边', () => {
    const mark = createAttackRangeMark();
    mark.update(0, 0, 8);
    // 没有填充：唯一的子节点是环所在的 Group
    expect(mark.group.children).toHaveLength(1);
    const ringGroup = mark.group.children[0] as THREE.Group;
    const ring = ringGroup.children.find((child) => child.name === 'ground-ring') as THREE.Mesh;
    const ringMat = ring.material as THREE.MeshBasicMaterial;
    expect(ringMat.color.getHex()).toBe(GROUND_FX.range);
    expect((ring.geometry as THREE.RingGeometry).parameters.outerRadius).toBe(1);
    // 细圈：环宽远小于早期 0.09~0.1 的粗环
    expect((ring.geometry as THREE.RingGeometry).parameters.innerRadius).toBeGreaterThan(0.95);
    expect(ringGroup.children.some((child) => child.name === 'ground-ring-outline')).toBe(false);
    mark.dispose();
  });

  it('不同射程的攻击范围圈世界环宽一致', () => {
    const mark = createAttackRangeMark();
    const ringGroup = mark.group.children[0] as THREE.Group;
    const ring = ringGroup.children.find((child) => child.name === 'ground-ring') as THREE.Mesh;
    const bandOf = (): number => {
      const p = (ring.geometry as THREE.RingGeometry).parameters;
      return (p.outerRadius - p.innerRadius) * ringGroup.scale.x;
    };
    mark.update(0, 0, 5);
    const small = bandOf();
    mark.update(0, 0, 11);
    expect(bandOf()).toBeCloseTo(small, 4);
    mark.dispose();
  });
});
