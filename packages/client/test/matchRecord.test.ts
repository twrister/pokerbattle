import { describe, expect, it } from 'vitest';
import { Faction } from '@pb/sim';
import { battleInputFromMatchResult } from '../src/account/matchRecord.js';
import { shouldRecordVersusAbandon } from '../src/account/versusExit.js';

describe('对战结果转档案写入', () => {
  it('按本地阵营映射胜负平', () => {
    expect(
      battleInputFromMatchResult(
        { winner: Faction.Blue, reason: 'base_destroyed', endTick: 10 },
        Faction.Blue,
        'solo',
      ),
    ).toEqual({ mode: 'solo', outcome: 'win', reason: 'base_destroyed' });

    expect(
      battleInputFromMatchResult(
        { winner: Faction.Blue, reason: 'time_limit', endTick: 20 },
        Faction.Red,
        'versus',
      ),
    ).toEqual({ mode: 'versus', outcome: 'loss', reason: 'time_limit' });

    expect(
      battleInputFromMatchResult(
        { winner: null, reason: 'simultaneous_destroyed', endTick: 30 },
        Faction.Blue,
        'versus',
      ),
    ).toEqual({ mode: 'versus', outcome: 'draw', reason: 'simultaneous_destroyed' });
  });
});

describe('联机提前退出规则', () => {
  it('仅在已开局、未结算、且非对手离开时记 abandoned', () => {
    expect(
      shouldRecordVersusAbandon({
        matchStarted: true,
        battleRecorded: false,
        peerLeft: false,
      }),
    ).toBe(true);

    // 匹配/加载阶段退出
    expect(
      shouldRecordVersusAbandon({
        matchStarted: false,
        battleRecorded: false,
        peerLeft: false,
      }),
    ).toBe(false);

    // 已有权威结算
    expect(
      shouldRecordVersusAbandon({
        matchStarted: true,
        battleRecorded: true,
        peerLeft: false,
      }),
    ).toBe(false);

    // 对手离开不记本方失败
    expect(
      shouldRecordVersusAbandon({
        matchStarted: true,
        battleRecorded: false,
        peerLeft: true,
      }),
    ).toBe(false);
  });
});
