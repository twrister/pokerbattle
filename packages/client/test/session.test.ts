// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction } from '@pb/sim';
import { encodeMessage } from '@pb/net';
import { connectRoomSession, createLobbyPresence } from '../src/net/session.js';

type Listener = (event?: { data?: string }) => void;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    });
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  pushServer(message: unknown): void {
    this.emit('message', { data: encodeMessage(message as never) });
  }
}

describe('connectRoomSession', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:9081',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('入房在 welcome 后 resolve，start 再回调开局', async () => {
    const onMatchStart = vi.fn();
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Tester',
      onMatchStart,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({ type: 'join', mode: 'create' });

    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 0,
      inputDelay: 4,
      roomId: '101',
      roomName: 'Tester的房间',
      reconnectToken: 'tok-a',
      opponentName: '',
    });
    ws.pushServer({
      type: 'roomState',
      roomId: '101',
      roomName: 'Tester的房间',
      hostSeat: 0,
      phase: 'waiting',
      members: [{ seat: 0, name: 'Tester', ready: true, isHost: true }],
    });

    const session = await done;
    expect(session.roomId).toBe('101');
    expect(session.roomName).toBe('Tester的房间');
    expect(session.faction).toBe(Faction.Blue);
    expect(session.isHost).toBe(true);
    expect(onMatchStart).not.toHaveBeenCalled();

    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 123,
      inputDelay: 4,
      roomId: '101',
      roomName: 'Tester的房间',
      reconnectToken: 'tok-a',
      opponentName: 'Rival',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    expect(onMatchStart).toHaveBeenCalledTimes(1);
    expect(onMatchStart.mock.calls[0]?.[1]).toBe(Faction.Blue);
    close();
  });

  it('join 会带上 playerId', async () => {
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Tester',
      playerId: 'device-abc-001',
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({
      type: 'join',
      mode: 'create',
      name: 'Tester',
      playerId: 'device-abc-001',
    });
    close();
    await expect(done).rejects.toThrow('已取消入房');
  });

  it('创建房间会带上 roomName', async () => {
    const { done, close } = connectRoomSession({
      mode: 'create',
      roomName: '自定义房',
      name: 'Tester',
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({
      type: 'join',
      mode: 'create',
      roomName: '自定义房',
    });

    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 0,
      inputDelay: 4,
      roomId: '088',
      roomName: '自定义房',
      reconnectToken: 'tok-create',
      opponentName: '',
    });
    const session = await done;
    expect(session.roomId).toBe('088');
    session.sendStartMatch();
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: 'startMatch' });
    session.sendSetReady(false);
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: 'setReady', ready: false });
    close();
  });

  it('主动 close 后断线不会触发重连', async () => {
    const onReconnecting = vi.fn();
    const { done } = connectRoomSession({
      mode: 'room',
      roomId: '042',
      name: 'Tester',
      onReconnecting,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 1,
      faction: Faction.Red,
      seed: 7,
      inputDelay: 4,
      roomId: '042',
      roomName: '对局房',
      reconnectToken: 'tok-b',
      opponentName: 'Other',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    const session = await done;

    session.close();
    expect(onReconnecting).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('入座后 close 会立刻断连且不重连', async () => {
    const { done, close } = connectRoomSession({ mode: 'create', name: 'Tester' });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 0,
      inputDelay: 4,
      roomId: '055',
      roomName: '等待房',
      reconnectToken: 'tok-wait',
      opponentName: '',
    });

    close();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    await expect(done).resolves.toMatchObject({ roomId: '055' });
  });

  it('意外断线会自动 rejoin 并恢复输入', async () => {
    vi.useFakeTimers();
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();
    const onMatchStart = vi.fn();
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Tester',
      onReconnecting,
      onReconnected,
      onMatchStart,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 42,
      inputDelay: 4,
      roomId: '009',
      roomName: '匹配房',
      reconnectToken: 'tok-c',
      opponentName: 'Rival',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    await done;
    const loop = onMatchStart.mock.calls[0]?.[0];
    expect(loop).toBeDefined();
    loop.handleServerMessage({ type: 'frame', tick: 1, commands: [] });
    expect(loop.lastConfirmedTick).toBe(1);

    // 模拟非主动断开
    ws.readyState = MockWebSocket.CLOSED;
    ws.emit('close');
    expect(onReconnecting).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    const rejoinWs = MockWebSocket.instances.at(-1)!;
    await Promise.resolve();
    expect(JSON.parse(rejoinWs.sent[0]!)).toMatchObject({
      type: 'rejoin',
      roomId: '009',
      token: 'tok-c',
      lastTick: 1,
    });

    rejoinWs.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 42,
      inputDelay: 4,
      roomId: '009',
      roomName: '匹配房',
      reconnectToken: 'tok-c',
      opponentName: 'Rival',
    });
    rejoinWs.pushServer({ type: 'frame', tick: 2, commands: [] });
    expect(onReconnected).toHaveBeenCalled();
    expect(loop.lastConfirmedTick).toBe(2);
    close();
  });

  it('换座后用新席位重放房间快照，保持房主身份', async () => {
    const onRoomState = vi.fn();
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Host',
      onRoomState,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 0,
      inputDelay: 4,
      roomId: '301',
      roomName: '换座房',
      reconnectToken: 'tok-seat',
      opponentName: '',
    });
    ws.pushServer({
      type: 'roomState',
      roomId: '301',
      roomName: '换座房',
      hostSeat: 0,
      phase: 'waiting',
      matchMode: '2v2',
      maxPlayers: 4,
      members: [{ seat: 0, name: 'Host', ready: true, isHost: true, faction: Faction.Blue }],
    });
    const session = await done;
    expect(session.seat).toBe(0);
    expect(session.isHost).toBe(true);

    const movedState = {
      type: 'roomState' as const,
      roomId: '301',
      roomName: '换座房',
      hostSeat: 2,
      phase: 'waiting' as const,
      matchMode: '2v2' as const,
      maxPlayers: 4,
      members: [{ seat: 2, name: 'Host', ready: true, isHost: true, faction: Faction.Red }],
    };
    onRoomState.mockClear();
    // 快照先到、welcome 后到：本机 seat 仍是旧值时不得刷新房间页。
    ws.pushServer(movedState);
    expect(session.seat).toBe(0);
    expect(onRoomState).not.toHaveBeenCalled();

    ws.pushServer({
      type: 'welcome',
      seat: 2,
      faction: Faction.Red,
      seed: 0,
      inputDelay: 4,
      roomId: '301',
      roomName: '换座房',
      reconnectToken: 'tok-seat',
      opponentName: '',
      matchMode: '2v2',
      members: movedState.members,
    });
    expect(session.seat).toBe(2);
    expect(session.isHost).toBe(true);
    expect(onRoomState).toHaveBeenCalledTimes(1);
    expect(onRoomState).toHaveBeenLastCalledWith(expect.objectContaining({ hostSeat: 2 }));
    close();
  });

  it('换座 welcome 先到时按新席位刷新快照', async () => {
    const onRoomState = vi.fn();
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Host',
      onRoomState,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 0,
      inputDelay: 4,
      roomId: '301',
      roomName: '换座房',
      reconnectToken: 'tok-seat-2',
      opponentName: '',
    });
    ws.pushServer({
      type: 'roomState',
      roomId: '301',
      roomName: '换座房',
      hostSeat: 0,
      phase: 'waiting',
      matchMode: '2v2',
      maxPlayers: 4,
      members: [{ seat: 0, name: 'Host', ready: true, isHost: true, faction: Faction.Blue }],
    });
    const session = await done;
    onRoomState.mockClear();

    ws.pushServer({
      type: 'welcome',
      seat: 2,
      faction: Faction.Red,
      seed: 0,
      inputDelay: 4,
      roomId: '301',
      roomName: '换座房',
      reconnectToken: 'tok-seat-2',
      opponentName: '',
      matchMode: '2v2',
      members: [{ seat: 2, name: 'Host', ready: true, isHost: true, faction: Faction.Red }],
    });
    expect(session.seat).toBe(2);
    expect(session.isHost).toBe(true);
    // 旧快照里还没有新席，此时不应按旧座位刷新
    expect(onRoomState).not.toHaveBeenCalled();

    ws.pushServer({
      type: 'roomState',
      roomId: '301',
      roomName: '换座房',
      hostSeat: 2,
      phase: 'waiting',
      matchMode: '2v2',
      maxPlayers: 4,
      members: [{ seat: 2, name: 'Host', ready: true, isHost: true, faction: Faction.Red }],
    });
    expect(onRoomState).toHaveBeenCalledTimes(1);
    expect(onRoomState).toHaveBeenLastCalledWith(expect.objectContaining({ hostSeat: 2 }));
    close();
  });

  it('同房间再开局会换新 NetSimLoop，不会复用上一局已结束的状态', async () => {
    const onMatchStart = vi.fn();
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Tester',
      onMatchStart,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 0,
      inputDelay: 4,
      roomId: '501',
      roomName: '连开房',
      reconnectToken: 'tok-rematch',
      opponentName: '',
    });
    const session = await done;

    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 11,
      inputDelay: 4,
      roomId: '501',
      roomName: '连开房',
      reconnectToken: 'tok-rematch',
      opponentName: 'Rival',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    const firstLoop = onMatchStart.mock.calls[0]?.[0];
    expect(firstLoop).toBeDefined();
    firstLoop.handleServerMessage({
      type: 'matchEnd',
      endTick: 8,
      winner: Faction.Red,
      reason: 'base_destroyed',
    });

    ws.pushServer({
      type: 'welcome',
      seat: 0,
      faction: Faction.Blue,
      seed: 22,
      inputDelay: 4,
      roomId: '501',
      roomName: '连开房',
      reconnectToken: 'tok-rematch',
      opponentName: 'Rival',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    expect(onMatchStart).toHaveBeenCalledTimes(2);
    const secondLoop = onMatchStart.mock.calls[1]?.[0];
    expect(secondLoop).not.toBe(firstLoop);
    expect(secondLoop.match.result).toBeNull();
    expect(secondLoop.match.world.seed).toBe(22);
    expect(session.roomId).toBe('501');
    close();
  });

  it('welcome 种子变了即使仍标记在局内也会重建 loop，避免误走重连', async () => {
    const onMatchStart = vi.fn();
    const onReconnected = vi.fn();
    const { done, close } = connectRoomSession({
      mode: 'create',
      name: 'Tester',
      onMatchStart,
      onReconnected,
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.pushServer({
      type: 'welcome',
      seat: 1,
      faction: Faction.Red,
      seed: 33,
      inputDelay: 4,
      roomId: '502',
      roomName: '误重连房',
      reconnectToken: 'tok-seed',
      opponentName: 'Host',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    await done;
    const firstLoop = onMatchStart.mock.calls[0]?.[0];

    ws.pushServer({
      type: 'welcome',
      seat: 1,
      faction: Faction.Red,
      seed: 44,
      inputDelay: 4,
      roomId: '502',
      roomName: '误重连房',
      reconnectToken: 'tok-seed',
      opponentName: 'Host',
    });
    ws.pushServer({ type: 'start', startTick: 1 });
    expect(onReconnected).not.toHaveBeenCalled();
    expect(onMatchStart).toHaveBeenCalledTimes(2);
    expect(onMatchStart.mock.calls[1]?.[0]).not.toBe(firstLoop);
    expect(onMatchStart.mock.calls[1]?.[0].match.world.seed).toBe(44);
    close();
  });
});

describe('createLobbyPresence', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:9081',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('连上后上报 activity，切到单机再发一条 lobby', async () => {
    const presence = createLobbyPresence({
      name: 'Tester',
      playerId: 'device-1',
      activity: 'lobby',
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({
      type: 'lobby',
      name: 'Tester',
      playerId: 'device-1',
      activity: 'lobby',
    });

    presence.setActivity('solo');
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1]!)).toMatchObject({ type: 'lobby', activity: 'solo' });

    presence.setActivity('solo');
    expect(ws.sent).toHaveLength(2);
    presence.dispose();
  });

  it('意外断线后重连并带上当前单机 activity', async () => {
    vi.useFakeTimers();
    const presence = createLobbyPresence({
      name: 'Tester',
      playerId: 'device-1',
      activity: 'lobby',
    });
    await Promise.resolve();
    const first = MockWebSocket.instances[0]!;
    presence.setActivity('solo');
    first.close();

    await vi.advanceTimersByTimeAsync(800);
    expect(MockWebSocket.instances).toHaveLength(2);
    const second = MockWebSocket.instances[1]!;
    await Promise.resolve();
    expect(JSON.parse(second.sent[0]!)).toMatchObject({ type: 'lobby', activity: 'solo' });
    presence.dispose();
    vi.useRealTimers();
  });

  it('复用大厅连接查询排行榜并带回自己的名次', async () => {
    const presence = createLobbyPresence({
      name: 'Tester',
      playerId: 'device-1',
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    const pending = presence.listLeaderboard();
    await Promise.resolve();
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: 'listLeaderboard',
      playerId: 'device-1',
    });
    ws.pushServer({
      type: 'leaderboard',
      entries: [
        {
          rank: 1,
          playerId: 'device-1',
          displayName: 'Tester',
          score: 4,
          matches: 4,
          wins: 4,
          losses: 0,
          winRate: 1,
        },
      ],
      self: {
        rank: 1,
        playerId: 'device-1',
        displayName: 'Tester',
        score: 4,
        matches: 4,
        wins: 4,
        losses: 0,
        winRate: 1,
      },
    });
    await expect(pending).resolves.toMatchObject({
      type: 'leaderboard',
      self: { playerId: 'device-1', score: 4, rank: 1 },
    });
    presence.dispose();
  });
});
