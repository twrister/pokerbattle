import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W, viewNearSign } from '../src/view/coords.js';
import { Faction } from '@pb/sim';
import {
  applySoloCameraPose,
  calculateSoloOrthoBounds,
  clampSoloCameraAngle,
  clampSoloCameraDistance,
  clampSoloCameraFov,
  clampSoloCameraOffsetY,
  clampSoloViewBottomExtra,
  DEFAULT_SOLO_CAMERA_ANGLE_DEG,
  DEFAULT_SOLO_CAMERA_DISTANCE,
  DEFAULT_SOLO_CAMERA_FOV,
  DEFAULT_SOLO_CAMERA_OFFSET_Y,
  DEFAULT_SOLO_VIEW_BOTTOM_EXTRA,
} from '../src/view/scene.js';

describe('单机正交镜头', () => {
  it('默认俯仰角为 46°，并限制在 15–90', () => {
    expect(DEFAULT_SOLO_CAMERA_ANGLE_DEG).toBe(46);
    expect(clampSoloCameraAngle(0)).toBe(15);
    expect(clampSoloCameraAngle(120)).toBe(90);
  });

  it('默认下方留白为 8，并限制在 0–15', () => {
    expect(DEFAULT_SOLO_VIEW_BOTTOM_EXTRA).toBe(8);
    expect(clampSoloViewBottomExtra(-1)).toBe(0);
    expect(clampSoloViewBottomExtra(20)).toBe(15);
  });

  it('默认透视 FOV 为 45°，并限制在 20–90', () => {
    expect(DEFAULT_SOLO_CAMERA_FOV).toBe(45);
    expect(clampSoloCameraFov(10)).toBe(20);
    expect(clampSoloCameraFov(120)).toBe(90);
  });

  it('默认透视距离为 50，并限制在 8–120', () => {
    expect(DEFAULT_SOLO_CAMERA_DISTANCE).toBe(50);
    expect(clampSoloCameraDistance(1)).toBe(8);
    expect(clampSoloCameraDistance(200)).toBe(120);
  });

  it('默认画面上下偏移为 0，并限制在 -30–30', () => {
    expect(DEFAULT_SOLO_CAMERA_OFFSET_Y).toBe(0);
    expect(clampSoloCameraOffsetY(-40)).toBe(-30);
    expect(clampSoloCameraOffsetY(40)).toBe(30);
  });

  it('透视距离加倍时斜视位姿沿视线拉远', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    applySoloCameraPose(camera, 45, Faction.Blue, 100);
    expect(camera.position.y).toBeCloseTo(100 * Math.sin(Math.PI / 4), 5);
    expect(camera.position.z).toBeCloseTo(100 * Math.cos(Math.PI / 4), 5);
  });

  it('透视画面上下偏移为正时，场地中心出现在画面更高处', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const ndcY = (camera: THREE.PerspectiveCamera): number => {
      origin.set(0, 0, 0).project(camera);
      return origin.y;
    };
    const base = new THREE.PerspectiveCamera(45, 9 / 16, 0.1, 500);
    applySoloCameraPose(base, 30, Faction.Blue, 70, 0);
    const shifted = new THREE.PerspectiveCamera(45, 9 / 16, 0.1, 500);
    applySoloCameraPose(shifted, 30, Faction.Blue, 70, 8);
    expect(ndcY(shifted)).toBeGreaterThan(ndcY(base));
  });

  it('45° 斜视角时镜头落在 +Z 侧且朝向原点', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, 45);

    expect(camera.position.y).toBeCloseTo(camera.position.z, 5);
    expect(camera.position.z).toBeGreaterThan(0);
    expect(camera.up.y).toBe(1);
  });

  it('红方视角从 -Z 侧俯视，己方仍在画面下方', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, 45, Faction.Red);
    expect(camera.position.z).toBeLessThan(0);
    expect(camera.position.y).toBeCloseTo(-camera.position.z, 5);
    expect(viewNearSign(camera)).toBe(-1);

    applySoloCameraPose(camera, 90, Faction.Red);
    expect(camera.up.z).toBe(1);
    expect(viewNearSign(camera)).toBe(-1);
  });

  it('蓝方视角近端符号为 +1（斜视与正上俯视）', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, 45, Faction.Blue);
    expect(viewNearSign(camera)).toBe(1);
    applySoloCameraPose(camera, 90, Faction.Blue);
    expect(viewNearSign(camera)).toBe(1);
  });

  it('90° 时退回正上俯视并保持蓝方在画面下方', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    applySoloCameraPose(camera, 90);

    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.z).toBeCloseTo(0);
    expect(camera.position.y).toBeGreaterThan(0);
    // -Z 朝上 → +Z（蓝方）在画面下方
    expect(camera.up.z).toBe(-1);
  });

  it('在 9:16 容器中完整显示战场和边距（正上俯视）', () => {
    const bounds = calculateSoloOrthoBounds(9 / 16, 90);

    expect(bounds.left).toBeLessThanOrEqual(-10);
    expect(bounds.right).toBeGreaterThanOrEqual(10);
    // 下方留白后视锥上偏，仍须包住含 1 格边距的战场。
    const halfHeightWithPadding = ARENA_H / 2 + 1;
    expect(bounds.top).toBeGreaterThanOrEqual(halfHeightWithPadding - 0.1);
    expect(bounds.bottom).toBeLessThanOrEqual(-halfHeightWithPadding + 0.1);
  });

  it('在更宽或更窄的容器中都保持完整战场（正上俯视）', () => {
    for (const aspect of [16 / 9, 390 / 844]) {
      const bounds = calculateSoloOrthoBounds(aspect, 90);
      expect(bounds.left).toBeLessThanOrEqual(-9);
      expect(bounds.right).toBeGreaterThanOrEqual(9);
      const halfHeightWithPadding = ARENA_H / 2 + 1;
      expect(bounds.top).toBeGreaterThanOrEqual(halfHeightWithPadding - 0.1);
      expect(bounds.bottom).toBeLessThanOrEqual(-halfHeightWithPadding + 0.1);
    }
  });

  it('取景相对战场中心上偏，给底部手牌留白', () => {
    const aspect = 9 / 16;
    const bounds = calculateSoloOrthoBounds(aspect, 90);
    // 下方额外留白后，视锥中心应落在原点偏下（相机空间 Y 更小 → 战场上移）
    const centerY = (bounds.top + bounds.bottom) / 2;
    expect(centerY).toBeLessThan(0);
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
