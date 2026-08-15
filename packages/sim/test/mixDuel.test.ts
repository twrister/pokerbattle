import { describe, expect, it } from 'vitest';
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

  it('可混编列表不含建筑和引信炸弹', () => {
    const ids = listMixableUnitTypeIds();
    expect(ids).toContain('melee_grunt');
    expect(ids).toContain('ranged_archer');
    expect(ids).not.toContain('building_tower');
    expect(ids).not.toContain('giant_bomb');
    expect(ids).not.toContain('small_bomb');
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
