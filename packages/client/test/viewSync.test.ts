import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  AIR_UNIT_HOVER_HEIGHT,
  CASTLE_PROTECT_HP_RATIO,
  Faction,
  UNIT_CONFIGS,
  UnitState,
  World,
  applyCombatDamage,
  fromFloat,
  fromInt,
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
import { HP_COLOR_ALLY, HP_COLOR_ENEMY, HP_COLOR_SELF, UnitView, visualFaction, visualSide } from '../src/view/unitView.js';
import { SPRITE_DEFS, SPRITE_GEOMETRY } from '../src/view/unitSprites.js';

/** 从单位视图里取出前景血条颜色，忽略底条与等级徽章。 */
function findHpFillHex(group: THREE.Group): number | undefined {
  for (const child of group.children) {
    if (!(child instanceof THREE.Group)) continue;
    for (const nested of child.children) {
      if (!(nested instanceof THREE.Mesh)) continue;
      const material = nested.material;
      if (!(material instanceof THREE.MeshBasicMaterial)) continue;
      const hex = material.color.getHex();
      if (hex !== 0x11161f && hex !== 0xffffff && hex !== 0xf4d27a && hex !== 0xffe9a8) return hex;
    }
  }
  return undefined;
}

/**
 * 这些用例只跑场景图，不创建 WebGL 上下文，所以能在 Node 里直接执行。
 * 目的是守住「快照 -> 场景对象」这条同步链路，不是验证画面好不好看。
 */
describe('队友着色', () => {
  it('同队不同席位为青蓝，1v1 不会出现 ally', () => {
    expect(visualSide(Faction.Blue, 0, Faction.Blue, 0)).toBe('self');
    expect(visualSide(Faction.Blue, 1, Faction.Blue, 0)).toBe('ally');
    expect(visualSide(Faction.Red, 2, Faction.Blue, 0)).toBe('enemy');
    expect(visualSide(Faction.Blue, 0, Faction.Blue, 0)).not.toBe('ally');
    expect(HP_COLOR_SELF).toBe(0x63d68a);
    expect(HP_COLOR_ALLY).toBe(0x35d6d6);
    expect(HP_COLOR_ENEMY).toBe(0xf2604f);
  });
});

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
    expect(afterDeath.units).toHaveLength(0);
    // 死亡会播 explode4，单位视图必须拿走，特效可以短暂留在场景
    expect(scene.children.length).toBe(baseChildren + afterDeath.explosionEffects.length);
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

  it('主堡血条有保护线刻度，普通单位没有', () => {
    const castle = new UnitView(Faction.Blue, 'building_base');
    const grunt = new UnitView(Faction.Blue, 'melee_grunt');
    const mark = castle.group.getObjectByName('hp-protect-mark');
    expect(mark).toBeInstanceOf(THREE.Mesh);
    expect(grunt.group.getObjectByName('hp-protect-mark')).toBeUndefined();

    const ratio = CASTLE_PROTECT_HP_RATIO;
    const barWidth = Math.max(1.2, UNIT_CONFIGS.building_base.footprint * 0.85);
    expect(mark?.position.x).toBeCloseTo((ratio - 0.5) * barWidth, 5);

    camera.position.set(0, 10, 10);
    camera.updateMatrixWorld();
    castle.update(0, 0, 0, 1, 1, UnitState.Idle, false, false, false, false, 0, camera);
    expect((mark as THREE.Mesh).material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(((mark as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xf4d27a);

    castle.update(0, 0, 0, 1, ratio * 0.5, UnitState.Idle, false, false, false, false, 0, camera);
    expect(((mark as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffe9a8);
    castle.dispose();
    grunt.dispose();
  });

  it('己方血条绿色、对阵血条红色', () => {
    const unitView = new UnitView(Faction.Blue, 'building_base');
    expect(findHpFillHex(unitView.group)).toBe(0x63d68a);
    unitView.dispose();

    const enemyView = new UnitView(Faction.Red, 'building_base');
    expect(findHpFillHex(enemyView.group)).toBe(0xf2604f);
    enemyView.dispose();
  });

  it('画面阵营把己方映射为蓝、对阵方映射为红', () => {
    expect(visualFaction(Faction.Blue, Faction.Blue)).toBe(Faction.Blue);
    expect(visualFaction(Faction.Red, Faction.Blue)).toBe(Faction.Red);
    expect(visualFaction(Faction.Red, Faction.Red)).toBe(Faction.Blue);
    expect(visualFaction(Faction.Blue, Faction.Red)).toBe(Faction.Red);
  });

  it('本地为红方时己方建筑按蓝方皮渲染，对阵建筑按红方皮', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    view.setLocalFaction(Faction.Red);
    const world = new World(1);
    const ownBase = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(28));
    const oppBase = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(3));
    expect(ownBase).toBeTruthy();
    expect(oppBase).toBeTruthy();
    const snap = takeSnapshot(world);
    view.render(snap, snap, 1, camera);

    const ownSnap = snap.units.find((unit) => unit.id === ownBase!.id)!;
    const oppSnap = snap.units.find((unit) => unit.id === oppBase!.id)!;
    const ownView = scene.children.find(
      (child) => Math.abs(child.position.z - toSceneZ(ownSnap.y)) < 1e-4,
    );
    const oppView = scene.children.find(
      (child) => Math.abs(child.position.z - toSceneZ(oppSnap.y)) < 1e-4,
    );
    expect(ownView?.userData.visualFaction).toBe(Faction.Blue);
    expect(oppView?.userData.visualFaction).toBe(Faction.Red);
    expect(ownView instanceof THREE.Group && findHpFillHex(ownView)).toBe(0x63d68a);
    expect(oppView instanceof THREE.Group && findHpFillHex(oppView)).toBe(0xf2604f);
    expect(ownSnap.faction).toBe(Faction.Red);
    expect(oppSnap.faction).toBe(Faction.Blue);
  });

  it('红方建筑使用专属贴图路径', () => {
    expect(SPRITE_DEFS.building_base?.frontUrl).toBe('buildings/base.png');
    expect(SPRITE_DEFS.building_base?.frontUrlRed).toBe('buildings/base_red.png');
    expect(SPRITE_DEFS.building_tower?.frontUrlRed).toBe('buildings/tower_red.png');
    expect(SPRITE_DEFS.building_tower_advanced?.frontUrl).toBe('buildings/tower.png');
    expect(SPRITE_DEFS.building_tower_advanced?.frontUrlRed).toBe('buildings/tower_red.png');
    expect(SPRITE_DEFS.building_tower_triple?.frontUrl).toBe('buildings/tower.png');
    expect(SPRITE_DEFS.building_tower_triple?.frontUrlRed).toBe('buildings/tower_red.png');
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
    unitView.update(0, 0, 0, 1, 1, UnitState.Idle, false, false, false, false, 0, blueCam);
    expect(findBillboard()?.position.z).toBeCloseTo(half, 5);

    const redCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    redCam.position.set(0, 10, -10);
    redCam.lookAt(0, 0, 0);
    redCam.updateMatrixWorld();
    unitView.update(0, 0, 0, 1, 1, UnitState.Idle, false, false, false, false, 0, redCam);
    expect(findBillboard()?.position.z).toBeCloseTo(-half, 5);
    unitView.dispose();
  });

  it('巨龙使用正背面精灵并让角色悬浮在地面标记上方', () => {
    expect(SPRITE_DEFS.dragon?.frontUrl).toBe('units/dragon-front.png');
    expect(SPRITE_DEFS.dragon?.backUrl).toBe('units/dragon-back.png');
    expect(SPRITE_DEFS.fire_dragon?.frontUrl).toBe('units/fire-dragon-front.png');
    expect(SPRITE_DEFS.fire_dragon?.backUrl).toBe('units/fire-dragon-back.png');
    expect(SPRITE_DEFS.ranged_chariot?.frontUrl).toBe('units/chariot-front.png');
    expect(SPRITE_DEFS.ranged_chariot?.backUrl).toBe('units/chariot-back.png');
    expect(SPRITE_DEFS.ranged_ballista?.frontUrl).toBe('units/ballista-front.png');
    expect(SPRITE_DEFS.ranged_ballista?.backUrl).toBe('units/ballista-back.png');
    expect(SPRITE_DEFS.melee_charge_wagon?.frontUrl).toBe('units/charge-wagon-front.png');
    expect(SPRITE_DEFS.melee_charge_wagon?.backUrl).toBe('units/charge-wagon-back.png');

    const unitView = new UnitView(Faction.Blue, 'dragon');
    camera.position.set(0, 10, 10);
    camera.updateMatrixWorld();
    unitView.update(
      0,
      0,
      1,
      0,
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
    for (const typeId of ['ranged_chariot', 'dragon', 'fire_dragon'] as const) {
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

  it('喷火龙落地后显示燃烧地面圈', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const shooter = world.spawnUnit(Faction.Blue, 'fire_dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    shooter.attackCooldown = fromFloat(9999);
    const aoeRadius =
      shooter.config.attack.kind === 'projectile_aoe'
        ? shooter.config.attack.aoeRadius
        : fromFloat(0);
    const projectile = world.spawnProjectile(
      shooter,
      target,
      shooter.stats.damage,
      fromFloat(9),
      aoeRadius,
    );
    for (let i = 0; i < 80 && !projectile.dead; i += 1) world.step();
    const snap = takeSnapshot(world);
    expect(snap.groundHazards).toHaveLength(1);

    view.render(snap, snap, 1, camera);
    const mark = scene.children.find((child) => child.name === 'ground-hazard');
    expect(mark).toBeDefined();
    expect(mark?.position.x).toBeCloseTo(toSceneX(12), 5);
    expect(mark?.position.z).toBeCloseTo(toSceneZ(10), 5);
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

  it('选中单位后显示白色无填充攻击范围圈，且同时只存在一个', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(6), fromFloat(10));
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const snap = takeSnapshot(world);
    const archerSnap = snap.units.find((unit) => unit.id === archer.id)!;
    expect(archerSnap.range).toBeGreaterThan(0);

    view.render(snap, snap, 1, camera);
    view.selectUnit(archer.id);
    view.render(snap, snap, 1, camera);

    const marks = scene.children.filter((child) => child.name === 'attack-range-mark');
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;
    expect(mark.position.x).toBeCloseTo(toSceneX(6), 5);
    expect(mark.position.z).toBeCloseTo(toSceneZ(10), 5);
    // 只要描边、不要预警圈那种半透明填充
    expect(mark.children.some((child) => child instanceof THREE.Mesh)).toBe(false);
    const line = mark.children.find((child) => child instanceof THREE.LineLoop) as THREE.LineLoop;
    expect(line).toBeDefined();
    expect((line.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xffffff);
    expect(line.scale.x).toBeCloseTo(archerSnap.range + archerSnap.radius, 5);

    view.selectUnit(grunt.id);
    view.render(snap, snap, 1, camera);
    const afterSwitch = scene.children.filter((child) => child.name === 'attack-range-mark');
    expect(afterSwitch).toHaveLength(1);
    expect(afterSwitch[0]!.position.x).toBeCloseTo(toSceneX(12), 5);
  });

  it('点空地取消选中，单位死亡后范围圈回收', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(8));
    const snap = takeSnapshot(world);
    view.render(snap, snap, 1, camera);
    view.selectUnit(unit.id);
    view.render(snap, snap, 1, camera);
    expect(scene.children.some((child) => child.name === 'attack-range-mark')).toBe(true);

    view.selectUnit(null);
    view.render(snap, snap, 1, camera);
    expect(scene.children.some((child) => child.name === 'attack-range-mark')).toBe(false);

    view.selectUnit(unit.id);
    view.render(snap, snap, 1, camera);
    unit.hp = 0;
    world.step();
    const afterDeath = takeSnapshot(world);
    view.render(snap, afterDeath, 1, camera);
    expect(scene.children.some((child) => child.name === 'attack-range-mark')).toBe(false);
  });

  it('点击拾取命中最近单位，空地返回 null', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const near = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(10));
    const far = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const snap = takeSnapshot(world);
    view.render(snap, snap, 1, camera);

    expect(view.pickUnitAtSim(8, 10)).toBe(near.id);
    expect(view.pickUnitAtSim(12, 10)).toBe(far.id);
    expect(view.pickUnitAtSim(8.3, 10)).toBe(near.id);
    expect(view.pickUnitAtSim(9, 20)).toBeNull();
  });

  it('箭塔自然掉血不闪红，战斗受击才闪红', () => {
    const scene = new THREE.Scene();
    const view = new BattleView(scene);
    const world = new World(1);
    const tower = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(8), fromFloat(10))!;
    const spawned = takeSnapshot(world);
    view.render(spawned, spawned, 1, camera);
    expect(findTowerBodyHex(scene)).toBe(0xffffff);

    world.step();
    const decayed = takeSnapshot(world);
    expect(decayed.units[0]!.hpRatio).toBeLessThan(spawned.units[0]!.hpRatio);
    expect(decayed.units[0]!.hit).toBe(false);
    view.render(spawned, decayed, 1, camera);
    expect(findTowerBodyHex(scene)).toBe(0xffffff);

    applyCombatDamage(tower, fromInt(80));
    const hit = takeSnapshot(world);
    expect(hit.units[0]!.hit).toBe(true);
    view.render(decayed, hit, 1, camera);
    expect(findTowerBodyHex(scene)).not.toBe(0xffffff);
  });
});

/** 取出箭塔本体贴图 tint；未受击为白，闪红后偏离白色。 */
function findTowerBodyHex(scene: THREE.Scene): number | undefined {
  for (const child of scene.children) {
    if (!(child instanceof THREE.Group)) continue;
    for (const nested of child.children) {
      if (!(nested instanceof THREE.Group)) continue;
      const mesh = nested.children.find((node) => node instanceof THREE.Mesh);
      if (!(mesh instanceof THREE.Mesh)) continue;
      const material = mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) return material.color.getHex();
    }
  }
  return undefined;
}
