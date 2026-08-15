import { describe, expect, it } from 'vitest';
import { Faction } from '@pb/sim';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  normalizeLobbyActivity,
  normalizeRoomId,
  normalizeRoomName,
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

  it('可编解码 join / rejoin / listRooms / error / welcome 扩展字段', () => {
    const join = encodeMessage({
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'Alice',
      playerId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      roomName: 'Alice的房间',
    });
    expect(decodeClientMessage(join)).toEqual({
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'Alice',
      playerId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      roomName: 'Alice的房间',
    });

    const listRooms = encodeMessage({ type: 'listRooms' });
    expect(decodeClientMessage(listRooms)).toEqual({ type: 'listRooms' });

    const lobby = encodeMessage({
      type: 'lobby',
      name: 'Alice',
      playerId: 'device-1',
      activity: 'solo',
    });
    expect(decodeClientMessage(lobby)).toEqual({
      type: 'lobby',
      name: 'Alice',
      playerId: 'device-1',
      activity: 'solo',
    });

    const rejoin = encodeMessage({
      type: 'rejoin',
      roomId: '042',
      token: 'abc',
      lastTick: 12,
    });
    expect(decodeClientMessage(rejoin)).toEqual({
      type: 'rejoin',
      roomId: '042',
      token: 'abc',
      lastTick: 12,
    });

    const welcome = encodeMessage({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 99,
      inputDelay: 4,
      roomId: '042',
      roomName: 'Alice的房间',
      reconnectToken: 'tok',
      opponentName: 'Bob',
    });
    expect(decodeServerMessage(welcome)).toMatchObject({
      type: 'welcome',
      roomId: '042',
      roomName: 'Alice的房间',
      reconnectToken: 'tok',
      opponentName: 'Bob',
    });

    const roomList = encodeMessage({
      type: 'roomList',
      rooms: [{ roomId: '042', roomName: 'Alice的房间', playerCount: 1, maxPlayers: 2 }],
    });
    expect(decodeServerMessage(roomList)).toEqual({
      type: 'roomList',
      rooms: [{ roomId: '042', roomName: 'Alice的房间', playerCount: 1, maxPlayers: 2 }],
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

  it('可编解码 startMatch / roomState', () => {
    const startMatch = encodeMessage({ type: 'startMatch' });
    expect(decodeClientMessage(startMatch)).toEqual({ type: 'startMatch' });

    const setReady = encodeMessage({ type: 'setReady', ready: false });
    expect(decodeClientMessage(setReady)).toEqual({ type: 'setReady', ready: false });

    const roomState = encodeMessage({
      type: 'roomState',
      roomId: '042',
      roomName: 'Alice的房间',
      hostSeat: 0,
      phase: 'waiting',
      members: [
        { seat: 0, name: 'Alice', ready: true, isHost: true },
        { seat: 1, name: 'Bob', ready: true, isHost: false },
      ],
    });
    expect(decodeServerMessage(roomState)).toEqual({
      type: 'roomState',
      roomId: '042',
      roomName: 'Alice的房间',
      hostSeat: 0,
      phase: 'waiting',
      members: [
        { seat: 0, name: 'Alice', ready: true, isHost: true },
        { seat: 1, name: 'Bob', ready: true, isHost: false },
      ],
    });
  });

  it('规范化三位房号并拒绝非法值', () => {
    expect(normalizeRoomId('  042  ')).toBe('042');
    expect(normalizeRoomId('999')).toBe('999');
    expect(normalizeRoomId('42')).toBeNull();
    expect(normalizeRoomId('room-01')).toBeNull();
    expect(normalizeRoomId('')).toBeNull();
  });

  it('规范化房间名并裁剪超长', () => {
    expect(normalizeRoomName('  测试房间  ')).toBe('测试房间');
    expect(normalizeRoomName('')).toBeNull();
    expect(normalizeRoomName('a'.repeat(30))).toHaveLength(24);
  });

  it('清洗大厅活动，未知值回退大厅', () => {
    expect(normalizeLobbyActivity('solo')).toBe('solo');
    expect(normalizeLobbyActivity('lobby')).toBe('lobby');
    expect(normalizeLobbyActivity('room')).toBe('lobby');
    expect(normalizeLobbyActivity(undefined)).toBe('lobby');
  });
});
