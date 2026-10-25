import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCheckerTexture } from '../src/view/arenaStyle.js';
import {
  ARENA_RIM_WIDTH,
  arenaVisualFromDraft,
  createArenaVisualGroup,
  createOutfieldDecorPositions,
} from '../src/view/scene.js';

describe('卡通场景风格', () => {
  it('棋盘贴图一格一个像素，相邻格交替两种颜色', () => {
    const texture = createCheckerTexture(4, 3, '#7ccf4f', '#6bbd42');
    expect(texture.image.width).toBe(4);
    expect(texture.image.height).toBe(3);
    const data = texture.image.data as Uint8Array;
    expect([data[0], data[1], data[2]]).toEqual([0x7c, 0xcf, 0x4f]);
    expect([data[4], data[5], data[6]]).toEqual([0x6b, 0xbd, 0x42]);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
  });

  it('场外装饰全部落在场地与石沿之外', () => {
    const layout = arenaVisualFromDraft();
    const decor = createOutfieldDecorPositions(layout);
    expect(decor.length).toBeGreaterThan(0);
    const halfW = layout.width / 2 + ARENA_RIM_WIDTH;
    const halfH = layout.height / 2 + ARENA_RIM_WIDTH;
    for (const item of decor) {
      expect(Math.abs(item.x) >= halfW || Math.abs(item.z) >= halfH).toBe(true);
    }
  });

  it('场外装饰位置固定，重建后不抖动', () => {
    const layout = arenaVisualFromDraft();
    expect(createOutfieldDecorPositions(layout)).toEqual(createOutfieldDecorPositions(layout));
  });

  it('整场地视觉组可正常构建', () => {
    const layout = arenaVisualFromDraft();
    const group = createArenaVisualGroup(layout, true);
    group.updateMatrixWorld(true);
    expect(group.children.length).toBeGreaterThan(0);
    expect(() => new THREE.Box3().setFromObject(group)).not.toThrow();
  });
});
