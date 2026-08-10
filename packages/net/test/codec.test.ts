import { describe, expect, it } from 'vitest';
import { Faction } from '@pb/sim';
import { decodeServerMessage, encodeMessage } from '../src/codec.js';

describe('matchEnd 协议', () => {
  it('可编解码权威结算消息', () => {
    const raw = encodeMessage({
      type: 'matchEnd',
      endTick: 2400,
      winner: Faction.Blue,
      reason: 'time_limit',
    });

    expect(decodeServerMessage(raw)).toEqual({
      type: 'matchEnd',
      endTick: 2400,
      winner: Faction.Blue,
      reason: 'time_limit',
    });
  });
});
