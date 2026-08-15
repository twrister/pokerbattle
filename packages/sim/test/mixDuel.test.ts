import { describe, expect, it } from 'vitest';
import { isArcherTowerId } from '../src/config/units.js';
import { toFloat } from '../src/math/fixed.js';
import {
  isBattleSettled,
  layoutMixedRows,
  listMixableUnitTypeIds,
  runMixSingleGame,
  setupMixWorld,
  summarizeMixWorld,
  type MixMatchupOptions,
} from '../src/balance/mixDuel.js';

describe('混编对局', () => {
  it('近战排前、远程排后，并按每排人数分行', () => {
    const rows = layoutMixedRows(
      [
        { typeId: 'melee_grunt', count: 5 },
        { typeId: 'ranged_archer', count: 5 },
        { typeId: 'melee_golem', count: 2 },
      ],
      5,
    );
    expect(rows).toEqual([
      ['melee_grunt', 'melee_grunt', 'melee_grunt', 'melee_grunt', 'melee_grunt'],
      ['melee_golem', 'melee_golem'],
      ['ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer', 'ranged_archer'],
    ]);
  });

  it('可混编列表含三种箭塔，不含基地和引信炸弹', () => {
    const ids = listMixableUnitTypeIds();
    expect(ids).toContain('melee_grunt');
    expect(ids).toContain('ranged_archer');
    expect(ids).toContain('building_tower');
    expect(ids).toContain('building_tower_advanced');
    expect(ids).toContain('building_tower_triple');
    expect(ids.indexOf('building_tower')).toBeLessThan(ids.indexOf('building_tower_advanced'));
    expect(ids.indexOf('building_tower_advanced')).toBeLessThan(ids.indexOf('building_tower_triple'));
    expect(ids.indexOf('melee_grunt')).toBeLessThan(ids.indexOf('building_tower'));
    expect(ids).not.toContain('building_base');
    expect(ids).not.toContain('giant_bomb');
    expect(ids).not.toContain('small_bomb');
  });

  it('地面阵列忽略箭塔，只排可移动单位', () => {
    expect(layoutMixedRows(
      [
        { typeId: 'building_tower', count: 2 },
        { typeId: 'melee_grunt', count: 1 },
      ],
      5,
    )).toEqual([['melee_grunt']]);
  });

  it('混入一座箭塔能开局且场上有对应建筑', () => {
    const session = setupMixWorld({
      unitsA: [
        { typeId: 'melee_grunt', count: 1 },
        { typeId: 'building_tower', count: 1 },
      ],
      unitsB: [{ typeId: 'melee_grunt', count: 1 }],
      seed: 5,
      swap: false,
      rowWidth: 5,
      maxTicks: 100,
      drawThreshold: 0.05,
    });
    const towers = session.world.units.filter((unit) => unit.config.id === 'building_tower');
    expect(towers).toHaveLength(1);
    expect(towers[0]!.faction).toBe(session.aFaction);
  });

  it('同排多座箭塔不重叠且不抛错', () => {
    const session = setupMixWorld({
      unitsA: [{ typeId: 'building_tower', count: 3 }],
      unitsB: [{ typeId: 'building_tower_advanced', count: 2 }],
      seed: 8,
      swap: false,
      rowWidth: 5,
      maxTicks: 1,
      drawThreshold: 0.05,
    });
    const towers = session.world.units.filter((unit) => isArcherTowerId(unit.config.id));
    expect(towers).toHaveLength(5);
    for (let i = 0; i < towers.length; i += 1) {
      for (let j = i + 1; j < towers.length; j += 1) {
        const dx = Math.abs(toFloat(towers[i]!.pos.x) - toFloat(towers[j]!.pos.x));
        const dy = Math.abs(toFloat(towers[i]!.pos.y) - toFloat(towers[j]!.pos.y));
        expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('含箭塔的对局回放能复现胜负与时长', () => {
    const record = runMixSingleGame({
      seed: 29,
      maxTicks: 600,
      mixA: [{ typeId: 'building_tower_triple', count: 1 }],
      mixB: [{ typeId: 'building_tower', count: 1 }],
    });
    const session = setupMixWorld(record.replay);
    let timeout = true;
    for (let i = 0; i < record.replay.maxTicks; i += 1) {
      session.world.step();
      if (isBattleSettled(session.world, session.aFaction, session.bFaction)) {
        timeout = false;
        break;
      }
    }
    const replayed = summarizeMixWorld(session, timeout, record.replay.drawThreshold);
    expect(replayed.ticks).toBe(record.ticks);
    expect(replayed.hpFracA).toBe(record.hpFracA);
    expect(replayed.hpFracB).toBe(record.hpFracB);
    expect(replayed.winner).toBe(record.winner);
    expect(timeout).toBe(record.timeout);
  });

  it('只跑正手一场并返回回放入口', () => {
    const result = runMixSingleGame({
      seed: 7,
      maxTicks: 400,
      mixA: [],
      mixB: [],
    });
    expect(result.index).toBe(1);
    expect(result.swap).toBe(false);
    expect(result.replay.swap).toBe(false);
    expect(result.replay.seed).toBe(7);
    expect(['a', 'b', 'draw']).toContain(result.winner);
  });

  it('双方混入相同时能正常结束', () => {
    const result = runMixSingleGame({
      seed: 3,
      maxTicks: 800,
      mixA: [{ typeId: 'melee_guard', count: 1 }],
      mixB: [{ typeId: 'melee_guard', count: 1 }],
    });
    expect(result.ticks).toBeGreaterThan(0);
    expect(['a', 'b', 'draw']).toContain(result.winner);
  });

  it('A 方混入明显更强的兵时 A 胜', () => {
    const result = runMixSingleGame({
      seed: 11,
      maxTicks: 800,
      mixA: [{ typeId: 'melee_golem', count: 4 }],
      mixB: [],
    });
    expect(result.winner).toBe('a');
  });

  it('同一种子两次运行结果完全一致', () => {
    const options: MixMatchupOptions = {
      seed: 19,
      maxTicks: 500,
      mixA: [{ typeId: 'ranged_archer', count: 2 }],
      mixB: [{ typeId: 'melee_grunt', count: 2 }],
    };
    expect(runMixSingleGame(options)).toEqual(runMixSingleGame(options));
  });

  it('按记录回放能复现同一场胜负与时长', () => {
    const record = runMixSingleGame({
      seed: 23,
      maxTicks: 600,
      mixA: [{ typeId: 'melee_golem', count: 1 }],
      mixB: [],
    });
    const session = setupMixWorld(record.replay);
    let timeout = true;
    for (let i = 0; i < record.replay.maxTicks; i += 1) {
      session.world.step();
      if (isBattleSettled(session.world, session.aFaction, session.bFaction)) {
        timeout = false;
        break;
      }
    }
    const replayed = summarizeMixWorld(session, timeout, record.replay.drawThreshold);
    expect(replayed.ticks).toBe(record.ticks);
    expect(replayed.hpFracA).toBe(record.hpFracA);
    expect(replayed.hpFracB).toBe(record.hpFracB);
    expect(replayed.winner).toBe(record.winner);
    expect(timeout).toBe(record.timeout);
  });
});
