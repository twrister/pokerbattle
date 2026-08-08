import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Faction, World, fromFloat, takeSnapshot } from '@pb/sim';
import {
  ARENA_H,
  ARENA_W,
  toSceneFacingZ,
  toSceneX,
  toSceneZ,
  toSimX,
  toSimY,
} from '../src/view/coords.js';
import { BattleView } from '../src/view/viewSync.js';

/**
 * 这些用例只跑场景图，不创建 WebGL 上下文，所以能在 Node 里直接执行。
 * 目的是守住「快照 -> 场景对象」这条同步链路，不是验证画面好不好看。
 */
describe('坐标换算', () => {
  it('sim 坐标与场景坐标可以来回转换', () => {
    expect(toSimX(toSceneX(3.25))).toBeCloseTo(3.25, 6);
    expect(toSimY(toSceneZ(19.5))).toBeCloseTo(19.5, 6);
  });

  it('场地中心映射到场景原点', () => {
    expect(toSceneX(ARENA_W / 2)).toBeCloseTo(0, 6);
    expect(toSceneZ(ARENA_H / 2)).toBeCloseTo(0, 6);
  });

  it('蓝方半场（低 simY）落在 +Z，镜头近端即画面下方', () => {
    expect(toSceneZ(0)).toBeCloseTo(ARENA_H / 2, 6);
    expect(toSceneZ(ARENA_H)).toBeCloseTo(-ARENA_H / 2, 6);
    expect(toSceneFacingZ(1)).toBe(-1);
  });
});

describe('渲染同步', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  it('单位出场时创建视图，死亡后从场景移除', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const baseChildren = scene.children.length;

    const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(16));
    const snapshot = takeSnapshot(world);
    view.render(snapshot, snapshot, 1, camera);
    expect(scene.children.length).toBe(baseChildren + 1);

    unit.hp = 0;
    world.step();
    const afterDeath = takeSnapshot(world);
    view.render(snapshot, afterDeath, 1, camera);
    expect(scene.children.length).toBe(baseChildren);
  });

  it('视图按位置插值，alpha 为 0.5 时落在两帧中点', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);

    world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(4), fromFloat(4));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(4), fromFloat(28));
    const first = takeSnapshot(world);

    for (let i = 0; i < 20; i++) world.step();
    const second = takeSnapshot(world);

    const blueFirst = first.units[0]!;
    const blueSecond = second.units.find((u) => u.id === blueFirst.id)!;
    expect(blueSecond.y).not.toBeCloseTo(blueFirst.y, 3);

    view.render(first, second, 0.5, camera);
    const group = scene.children.find((child) => child instanceof THREE.Group)!;
    expect(group.position.z).toBeCloseTo(toSceneZ((blueFirst.y + blueSecond.y) / 2), 5);
  });

  it('reset 之后场景里不再有单位视图，且视图对象被复用', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(5));

    const snapshot = takeSnapshot(world);
    view.render(snapshot, snapshot, 1, camera);
    const created = scene.children.filter((child) => child instanceof THREE.Group);
    expect(created.length).toBe(1);

    view.reset();
    expect(scene.children.filter((child) => child instanceof THREE.Group).length).toBe(0);

    view.render(snapshot, snapshot, 1, camera);
    const reused = scene.children.filter((child) => child instanceof THREE.Group);
    expect(reused[0]).toBe(created[0]);
  });

  it('治疗事件会创建单体受疗效果，并在事件结束后回收', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    world.spawnHealEffect(fromFloat(8), fromFloat(8), fromFloat(0.5));
    const withEffect = takeSnapshot(world);

    view.render(withEffect, withEffect, 1, camera);
    expect(scene.children.length).toBe(1);

    for (let i = 0; i < 12; i++) world.step();
    const withoutEffect = takeSnapshot(world);
    view.render(withEffect, withoutEffect, 1, camera);
    expect(scene.children.length).toBe(0);
  });
});
