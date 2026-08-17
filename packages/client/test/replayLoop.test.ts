import { describe, expect, it, vi } from 'vitest';
import { Faction, MatchState, TICK_RATE } from '@pb/sim';
import { ReplayLoop } from '../src/replay/replayLoop.js';
import { createArenaSignature } from '../src/replay/arenaSignature.js';
import type { ReplayRecord } from '../src/replay/types.js';

const STEP_MS = 1000 / TICK_RATE;

function recordForTicks(endTick: number, seed = 7): { source: MatchState; record: ReplayRecord } {
  const source = new MatchState(seed, '1v1');
  source.seedStartingCastles();
  for (let i = 0; i < endTick; i += 1) source.step([]);
  return {
    source,
    record: {
      schemaVersion: 1,
      id: 'loop-test',
      recordedAt: 1,
      seed,
      matchMode: '1v1',
      endTick,
      result: source.result ?? { winner: null, reason: 'time_limit', endTick },
      context: { localFaction: Faction.Blue, localName: '甲', opponentName: '乙' },
      frames: [],
      arenaSignature: createArenaSignature('1v1'),
    },
  };
}

describe('ReplayLoop', () => {
  it('重跑同一 seed 与空帧表得到相同 hash', () => {
    const { source, record } = recordForTicks(12);
    const loop = new ReplayLoop(record);
    loop.advance(STEP_MS * 12);
    expect(loop.tick).toBe(12);
    expect(loop.match.hash()).toBe(source.hash());
    expect(loop.isFinished).toBe(true);
  });

  it('倍速按倍数推进，暂停不再前进', () => {
    const { record } = recordForTicks(10);
    const loop = new ReplayLoop(record);
    loop.advance(STEP_MS);
    expect(loop.tick).toBe(1);
    loop.setSpeed(2);
    loop.advance(STEP_MS);
    expect(loop.tick).toBe(3);
    loop.setPaused(true);
    loop.advance(STEP_MS * 4);
    expect(loop.tick).toBe(3);
    expect(loop.isPaused).toBe(true);
  });

  it('重播回到 tick 0 并能再次播完', () => {
    const { record } = recordForTicks(6);
    const loop = new ReplayLoop(record);
    loop.advance(STEP_MS * 6);
    expect(loop.isFinished).toBe(true);
    loop.restart();
    expect(loop.tick).toBe(0);
    expect(loop.isFinished).toBe(false);
    loop.advance(STEP_MS * 6);
    expect(loop.tick).toBe(6);
    expect(loop.isFinished).toBe(true);
  });

  it('结算与录像不一致时回调一次', () => {
    const onMismatch = vi.fn();
    const { record } = recordForTicks(4);
    record.result = { winner: Faction.Red, reason: 'base_destroyed' };
    const loop = new ReplayLoop(record, { onMismatch });
    loop.advance(STEP_MS * 4);
    expect(onMismatch).toHaveBeenCalledTimes(1);
    loop.advance(STEP_MS);
    expect(onMismatch).toHaveBeenCalledTimes(1);
  });
});
