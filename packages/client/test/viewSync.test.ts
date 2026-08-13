import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  AIR_UNIT_HOVER_HEIGHT,
  Faction,
  UNIT_CONFIGS,
  UnitState,
  World,
  fromFloat,
  takeSnapshot,
} from '@pb/sim';
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
import { UnitView } from '../src/view/unitView.js';
import { SPRITE_DEFS, SPRITE_GEOMETRY } from '../src/view/unitSprites.js';

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

  it('弓箭手弹道使用箭矢面片而非彩色球', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    world.spawnProjectile(archer, target, archer.stats.damage, fromFloat(9));
    const snap = takeSnapshot(world);
    expect(snap.projectiles[0]!.visual).toBe('arrow');

    view.render(snap, snap, 1, camera);
    const mesh = scene.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(mesh.userData.visual).toBe('arrow');
    expect(mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry);
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

  it('红方建筑使用专属贴图路径', () => {
    expect(SPRITE_DEFS.building_base?.frontUrl).toBe('buildings/base.png');
    expect(SPRITE_DEFS.building_base?.frontUrlRed).toBe('buildings/base_red.png');
    expect(SPRITE_DEFS.building_tower?.frontUrlRed).toBe('buildings/tower_red.png');
    expect(SPRITE_DEFS.building_tower_advanced?.frontUrl).toBe('buildings/tower.png');
    expect(SPRITE_DEFS.building_tower_advanced?.frontUrlRed).toBe('buildings/tower_red.png');
  });

  it('建筑贴图底边随镜头近端翻转（蓝 +Z / 红 -Z）', () => {
    const half = UNIT_CONFIGS.building_base.footprint / 2;
    const unitView = new UnitView(Faction.Red, 'building_base');
    const findBillboard = (): THREE.Group | undefined =>
      unitView.group.children.find(
        (child) =>
          child instanceof THREE.Group &&
          child.children.some(
            (nested) => nested instanceof THREE.Mesh && nested.geometry === SPRITE_GEOMETRY,
          ),
      ) as THREE.Group | undefined;

    const blueCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    blueCam.position.set(0, 10, 10);
    blueCam.lookAt(0, 0, 0);
    blueCam.updateMatrixWorld();
    unitView.update(0, 0, 0, 1, 1, 1, UnitState.Idle, false, false, false, false, 0, blueCam);
    expect(findBillboard()?.position.z).toBeCloseTo(half, 5);

    const redCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    redCam.position.set(0, 10, -10);
    redCam.lookAt(0, 0, 0);
    redCam.updateMatrixWorld();
    unitView.update(0, 0, 0, 1, 1, 1, UnitState.Idle, false, false, false, false, 0, redCam);
    expect(findBillboard()?.position.z).toBeCloseTo(-half, 5);
    unitView.dispose();
  });

  it('巨龙使用正背面精灵并让角色悬浮在地面标记上方', () => {
    expect(SPRITE_DEFS.dragon?.frontUrl).toBe('units/dragon-front.png');
    expect(SPRITE_DEFS.dragon?.backUrl).toBe('units/dragon-back.png');
    expect(SPRITE_DEFS.ranged_chariot?.frontUrl).toBe('units/chariot-front.png');
    expect(SPRITE_DEFS.ranged_chariot?.backUrl).toBe('units/chariot-back.png');

    const unitView = new UnitView(Faction.Blue, 'dragon');
    camera.position.set(0, 10, 10);
    camera.updateMatrixWorld();
    unitView.update(
      0,
      0,
      1,
      0,
      1,
      1,
      UnitState.Idle,
      false,
      false,
      false,
      false,
      0,
      camera,
    );

    const billboard = unitView.group.children.find(
      (child) =>
        child instanceof THREE.Group &&
        child.children.some(
          (nested) => nested instanceof THREE.Mesh && nested.geometry === SPRITE_GEOMETRY,
        ),
    );
    // 悬浮含随机相位正弦起伏（幅度约 0.08），不能只按基准高度卡下限
    expect(billboard?.position.y).toBeGreaterThan(AIR_UNIT_HOVER_HEIGHT - 0.1);
    expect(billboard?.position.y).toBeLessThan(AIR_UNIT_HOVER_HEIGHT + 0.1);
    unitView.dispose();
  });

  it('炸弹飞行期间在落点显示预警圈，落地后回收', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    // 用红方投放，确认预警圈不按本机阵营过滤
    const projectile = world.spawnGiantBomb(Faction.Red, fromFloat(9), fromFloat(15));
    const flying = takeSnapshot(world);
    expect(flying.projectiles[0]?.fuseBombKind).toBe('giant_bomb');

    view.render(flying, flying, 1, camera);
    const warning = scene.children.find((child) => child.name === 'aoe-ground-mark');
    expect(warning).toBeDefined();
    expect(warning?.position.x).toBeCloseTo(toSceneX(9), 5);
    expect(warning?.position.z).toBeCloseTo(toSceneZ(15), 5);

    for (let i = 0; i < 100 && !projectile.dead; i += 1) world.step();
    const after = takeSnapshot(world);
    view.render(flying, after, 1, camera);
    expect(scene.children.some((child) => child.name === 'aoe-ground-mark')).toBe(false);
  });

  it('战车与巨龙的范围弹在落点显示预警圈', () => {
    for (const typeId of ['ranged_chariot', 'dragon'] as const) {
      const scene = new THREE.Scene();
      const view = new BattleView(scene);
      const world = new World(1);
      const shooter = world.spawnUnit(Faction.Blue, typeId, fromFloat(5), fromFloat(10));
      const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
      const aoeRadius =
        shooter.config.attack.kind === 'projectile_aoe'
          ? shooter.config.attack.aoeRadius
          : fromFloat(0);
      world.spawnProjectile(shooter, target, shooter.stats.damage, fromFloat(9), aoeRadius);
      const snap = takeSnapshot(world);
      expect(snap.projectiles[0]!.aoeRadius).toBeGreaterThan(0);

      view.render(snap, snap, 1, camera);
      const warning = scene.children.find((child) => child.name === 'aoe-ground-mark');
      expect(warning, typeId).toBeDefined();
      expect(warning?.position.x).toBeCloseTo(toSceneX(12), 5);
      expect(warning?.position.z).toBeCloseTo(toSceneZ(10), 5);
    }
  });

  it('普通箭矢不显示爆炸范围预警圈', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    world.spawnProjectile(archer, target, archer.stats.damage, fromFloat(9));
    const snap = takeSnapshot(world);
    view.render(snap, snap, 1, camera);
    expect(scene.children.some((child) => child.name === 'aoe-ground-mark')).toBe(false);
  });
});
