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
});
