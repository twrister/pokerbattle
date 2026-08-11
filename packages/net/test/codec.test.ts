import { describe, expect, it } from 'vitest';
import { Faction } from '@pb/sim';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  normalizeRoomId,
} from '../src/index.js';

describe('协议编解码', () => {
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

  it('可编解码 join / rejoin / error / welcome 扩展字段', () => {
    const join = encodeMessage({
      type: 'join',
      mode: 'room',
      roomId: 'room-01',
      name: 'Alice',
    });
    expect(decodeClientMessage(join)).toEqual({
      type: 'join',
      mode: 'room',
      roomId: 'room-01',
      name: 'Alice',
    });

    const rejoin = encodeMessage({
      type: 'rejoin',
      roomId: 'room-01',
      token: 'abc',
      lastTick: 12,
    });
    expect(decodeClientMessage(rejoin)).toEqual({
      type: 'rejoin',
      roomId: 'room-01',
      token: 'abc',
      lastTick: 12,
    });

    const welcome = encodeMessage({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 99,
      inputDelay: 4,
      roomId: 'room-01',
      reconnectToken: 'tok',
    });
    expect(decodeServerMessage(welcome)).toMatchObject({
      type: 'welcome',
      roomId: 'room-01',
      reconnectToken: 'tok',
    });

    const error = encodeMessage({
      type: 'error',
      code: 'room_full',
      message: '房间已满',
    });
    expect(decodeServerMessage(error)).toEqual({
      type: 'error',
      code: 'room_full',
      message: '房间已满',
    });
  });

  it('规范化房号并拒绝非法字符', () => {
    expect(normalizeRoomId('  Room_01  ')).toBe('Room_01');
    expect(normalizeRoomId('bad room')).toBeNull();
    expect(normalizeRoomId('')).toBeNull();
  });
});
