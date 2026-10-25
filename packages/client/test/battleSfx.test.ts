import { describe, expect, it } from 'vitest';
import {
  Faction,
  UnitState,
  type ExplosionEffectSnapshot,
  type ProjectileSnapshot,
  type Snapshot,
  type UnitSnapshot,
} from '@pb/sim';
import { BattleSfx } from '../src/audio/battleSfx.js';
import type { SfxId } from '../src/audio/sfxManifest.js';

/** 收集播放请求，替代真实 Web Audio。 */
function createRecorder(): { ids: SfxId[]; play: (id: SfxId) => void } {
  const ids: SfxId[] = [];
  return { ids, play: (id) => ids.push(id) };
}

function unit(id: number, overrides: Partial<UnitSnapshot> = {}): UnitSnapshot {
  return {
    id,
    typeId: 'melee_grunt',
    faction: Faction.Blue,
    ownerSlot: Faction.Blue,
    state: UnitState.Idle,
    x: 0,
    y: 0,
    facingX: 0,
    facingY: 1,
    radius: 0.4,
    range: 1,
    footprint: 0,
    hpRatio: 1,
    attacking: false,
    charging: false,
    inspired: false,
    casting: false,
    hit: false,
    aoeHit: false,
    ...overrides,
  };
}

function projectile(id: number, visual: ProjectileSnapshot['visual']): ProjectileSnapshot {
  return {
    id,
    faction: Faction.Blue,
    x: 0,
    y: 0,
    height: 0,
    visual,
    landed: false,
    fuseBombKind: null,
    impactX: 0,
    impactY: 0,
    aoeRadius: 0,
  };
}

function explosion(id: number, kind: ExplosionEffectSnapshot['kind']): ExplosionEffectSnapshot {
  return { id, x: 0, y: 0, radius: 1, kind, progress: 0 };
}

function snapshot(tick: number, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick,
    units: [],
    projectiles: [],
    healEffects: [],
    aoePulseEffects: [],
    explosionEffects: [],
    groundHazards: [],
    ...overrides,
  };
}

describe('战斗音效差分', () => {
  it('首帧只建索引，不出声', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play });

    battleSfx.onSnapshot(
      snapshot(1, {
        units: [unit(1), unit(2)],
        projectiles: [projectile(1, 'arrow')],
        explosionEffects: [explosion(1, 'normal')],
      }),
    );

    expect(recorder.ids).toEqual([]);
  });

  it('新弹道按外观分档，同一 tick 重复调用不重播', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play });
    battleSfx.onSnapshot(snapshot(1));

    const next = snapshot(2, {
      projectiles: [projectile(1, 'arrow'), projectile(2, 'orb'), projectile(3, 'bomb')],
    });
    battleSfx.onSnapshot(next);
    battleSfx.onSnapshot(next);

    expect(recorder.ids).toEqual(['arrow', 'magic', 'bomb_toss']);
  });

  it('巨型炸弹与血溅用更重的爆炸音', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play });
    battleSfx.onSnapshot(snapshot(1));

    battleSfx.onSnapshot(
      snapshot(2, {
        explosionEffects: [explosion(1, 'normal'), explosion(2, 'giant_bomb'), explosion(3, 'blood3')],
      }),
    );

    expect(recorder.ids).toEqual(['explode', 'explode_big', 'hit_big']);
  });

  it('单位阵亡的爆炸特效只出画面，不播音效', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play });
    battleSfx.onSnapshot(snapshot(1));

    // explode4 只在单位阵亡时生成；阵亡本身由 'death' 提示，爆炸不再叠一声
    battleSfx.onSnapshot(
      snapshot(2, { explosionEffects: [explosion(1, 'explode4'), explosion(2, 'explode4')] }),
    );
    expect(recorder.ids).toEqual([]);

    // 同帧混着普通爆炸时，普通爆炸照常响
    battleSfx.onSnapshot(snapshot(3, { explosionEffects: [explosion(3, 'normal')] }));
    expect(recorder.ids).toEqual(['explode']);
  });

  it('单位从快照消失即阵亡，建筑走倒塌音', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play });
    battleSfx.onSnapshot(snapshot(1, { units: [unit(1), unit(2, { footprint: 3 })] }));

    // 只留 unit 1，unit 2 是建筑 → 倒塌
    battleSfx.onSnapshot(snapshot(2, { units: [unit(1)] }));
    expect(recorder.ids).toEqual(['building_down']);

    // unit 1 也死了 → 普通阵亡音
    battleSfx.onSnapshot(snapshot(3, { units: [] }));
    expect(recorder.ids).toEqual(['building_down', 'death']);
  });

  it('受击音只在 hit 位由假变真时响一次', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play, now: () => 1000 });
    battleSfx.onSnapshot(snapshot(1, { units: [unit(1)] }));

    battleSfx.onSnapshot(snapshot(2, { units: [unit(1, { hit: true })] }));
    expect(recorder.ids).toEqual(['hit']);

    // 仍在受击状态，不应重复
    battleSfx.onSnapshot(snapshot(3, { units: [unit(1, { hit: true })] }));
    expect(recorder.ids).toEqual(['hit']);

    // 范围伤害用更重的受击音，但同一个合并窗口内被节流
    battleSfx.onSnapshot(snapshot(4, { units: [unit(1, { hit: true, aoeHit: true })] }));
    expect(recorder.ids).toEqual(['hit']);
  });

  it('受击音过了合并窗口后，范围伤害会换成更重的档', () => {
    const recorder = createRecorder();
    let now = 0;
    const battleSfx = new BattleSfx({ play: recorder.play, now: () => now, hitWindowMs: 150 });
    battleSfx.onSnapshot(snapshot(1, { units: [unit(1)] }));

    battleSfx.onSnapshot(snapshot(2, { units: [unit(1, { hit: true })] }));
    expect(recorder.ids).toEqual(['hit']);

    // hit 位先回假再触发，窗口外才允许再播
    battleSfx.onSnapshot(snapshot(3, { units: [unit(1)] }));
    now = 500;
    battleSfx.onSnapshot(snapshot(4, { units: [unit(1, { hit: true, aoeHit: true })] }));
    expect(recorder.ids).toEqual(['hit', 'hit_big']);
  });

  it('投送音在合并窗口内只响一次', () => {
    const recorder = createRecorder();
    let now = 0;
    const battleSfx = new BattleSfx({ play: recorder.play, now: () => now, crowdWindowMs: 90 });
    battleSfx.onSnapshot(snapshot(1));

    battleSfx.onSnapshot(snapshot(2, { units: [unit(1), unit(2), unit(3)] }));
    expect(recorder.ids).toEqual(['spawn']);

    // 过了窗口再出新兵才会再响
    now = 200;
    battleSfx.onSnapshot(snapshot(3, { units: [unit(1), unit(2), unit(3), unit(4)] }));
    expect(recorder.ids).toEqual(['spawn', 'spawn']);
  });

  it('reset 后重新静默建索引', () => {
    const recorder = createRecorder();
    const battleSfx = new BattleSfx({ play: recorder.play });
    battleSfx.onSnapshot(snapshot(1));
    battleSfx.onSnapshot(snapshot(2, { projectiles: [projectile(1, 'arrow')] }));
    expect(recorder.ids).toEqual(['arrow']);

    battleSfx.reset();
    battleSfx.onSnapshot(snapshot(10, { projectiles: [projectile(1, 'arrow')] }));
    expect(recorder.ids).toEqual(['arrow']);
  });
});
