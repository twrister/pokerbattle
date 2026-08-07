import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W } from '../src/view/coords.js';
import {
  applySoloCameraPose,
  calculateSoloOrthoBounds,
  clampSoloCameraAngle,
  DEFAULT_SOLO_CAMERA_ANGLE_DEG,
} from '../src/view/scene.js';

describe('单机正交镜头', () => {
  it('默认俯仰角为 45°，并限制在 15–90', () => {
    expect(DEFAULT_SOLO_CAMERA_ANGLE_DEG).toBe(45);
    expect(clampSoloCameraAngle(0)).toBe(15);
    expect(clampSoloCameraAngle(120)).toBe(90);
  });

  it('45° 斜视角时镜头落在 +Z 侧且朝向原点', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, 45);

    expect(camera.position.y).toBeCloseTo(camera.position.z, 5);
    expect(camera.position.z).toBeGreaterThan(0);
    expect(camera.up.y).toBe(1);
  });

  it('90° 时退回正上俯视并保持蓝方在画面上方', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, 90);

    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.z).toBeCloseTo(0);
    expect(camera.position.y).toBeGreaterThan(0);
    expect(camera.up.z).toBe(-1);
  });

  it('在 9:16 容器中完整显示战场和边距（正上俯视）', () => {
    const bounds = calculateSoloOrthoBounds(9 / 16, 90);

    expect(bounds.left).toBeLessThanOrEqual(-10);
    expect(bounds.right).toBeGreaterThanOrEqual(10);
    expect(bounds.top).toBeGreaterThanOrEqual(17);
    expect(bounds.bottom).toBeLessThanOrEqual(-17);
  });

  it('在更宽或更窄的容器中都保持完整战场（正上俯视）', () => {
    for (const aspect of [16 / 9, 390 / 844]) {
      const bounds = calculateSoloOrthoBounds(aspect, 90);
      expect(bounds.left).toBeLessThanOrEqual(-9);
      expect(bounds.right).toBeGreaterThanOrEqual(9);
      expect(bounds.top).toBeGreaterThanOrEqual(16);
      expect(bounds.bottom).toBeLessThanOrEqual(-16);
    }
  });

  it('45° 斜视角时战场四角都落在正交视锥内', () => {
    const aspect = 9 / 16;
    const bounds = calculateSoloOrthoBounds(aspect, 45);
    const camera = new THREE.OrthographicCamera(
      bounds.left,
      bounds.right,
      bounds.top,
      bounds.bottom,
      0.1,
      500,
    );
    applySoloCameraPose(camera, 45);

    const halfW = ARENA_W / 2;
    const halfH = ARENA_H / 2;
    const corners = [
      new THREE.Vector3(-halfW, 0, -halfH),
      new THREE.Vector3(halfW, 0, -halfH),
      new THREE.Vector3(halfW, 0, halfH),
      new THREE.Vector3(-halfW, 0, halfH),
    ];
    const inv = camera.matrixWorldInverse;
    for (const corner of corners) {
      corner.applyMatrix4(inv);
      expect(corner.x).toBeGreaterThanOrEqual(bounds.left);
      expect(corner.x).toBeLessThanOrEqual(bounds.right);
      expect(corner.y).toBeGreaterThanOrEqual(bounds.bottom);
      expect(corner.y).toBeLessThanOrEqual(bounds.top);
    }
  });
});
