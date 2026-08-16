import { describe, expect, it, vi } from 'vitest';
import { Faction, fromFloat, playFormationCommand } from '@pb/sim';
import { NetSimLoop } from '../src/net/netLoop.js';

describe('NetSimLoop', () => {
  it('重复补帧不会二次 step', () => {
    const loop = new NetSimLoop({
      seed: 1,
      faction: Faction.Blue,
      inputDelay: 4,
      send: vi.fn(),
    });
    loop.handleServerMessage({ type: 'start', startTick: 1 });
    loop.handleServerMessage({ type: 'frame', tick: 1, commands: [] });
    loop.handleServerMessage({ type: 'frame', tick: 1, commands: [] });
    expect(loop.lastConfirmedTick).toBe(1);
    expect(loop.tick).toBe(1);
  });

  it('输入暂停时不发送上行', () => {
    const send = vi.fn();
    const loop = new NetSimLoop({
      seed: 1,
      faction: Faction.Blue,
      inputDelay: 4,
      send,
    });
    loop.handleServerMessage({ type: 'start', startTick: 1 });
    loop.setInputPaused(true);
    loop.sendInput([
      playFormationCommand(Faction.Blue, 'single_grunt', ['A-spades'], fromFloat(9), fromFloat(8)),
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it('观战模式消化 frameBatch 且不上报 hash/input', () => {
    const send = vi.fn();
    const loop = new NetSimLoop({
      seed: 1,
      faction: Faction.Blue,
      inputDelay: 4,
      spectator: true,
      maxStepsPerAdvance: 2,
      send,
    });
    loop.handleServerMessage({
      type: 'frameBatch',
      fromTick: 1,
      frames: [[], [], []],
    });
    expect(loop.lastConfirmedTick).toBe(2);
    expect(loop.pendingTicks).toBe(1);
    loop.advance(0);
    expect(loop.lastConfirmedTick).toBe(3);
    expect(loop.pendingTicks).toBe(0);
    loop.sendInput([
      playFormationCommand(Faction.Blue, 'single_grunt', ['A-spades'], fromFloat(9), fromFloat(8)),
    ]);
    expect(send).not.toHaveBeenCalled();
  });
});
