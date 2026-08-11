import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeServerMessage, encodeMessage, type ServerMessage } from '@pb/net';
import { RoomManager } from '../src/roomManager.js';
import { MatchRoom } from '../src/room.js';

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  /** 与 ws 包一致：实例上也挂 OPEN，供 readyState === ws.OPEN 判断。 */
  readonly OPEN = FakeWebSocket.OPEN;
  readyState = FakeWebSocket.OPEN;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, handler: (...args: unknown[]) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, handler: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }

  /** 模拟客户端上行。 */
  receive(message: unknown): void {
    this.emit('message', encodeMessage(message as never));
  }

  messages(): ServerMessage[] {
    return this.sent
      .map((raw) => decodeServerMessage(raw))
      .filter((message): message is ServerMessage => message !== null);
  }
}

describe('RoomManager 多房间', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('同房两人开局，第三人被拒绝', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    const c = new FakeWebSocket();

    expect(manager.join(a as never, { type: 'join', mode: 'room', roomId: 'alpha', name: 'A' }).ok).toBe(
      true,
    );
    expect(manager.join(b as never, { type: 'join', mode: 'room', roomId: 'alpha', name: 'B' }).ok).toBe(
      true,
    );
    const third = manager.join(c as never, { type: 'join', mode: 'room', roomId: 'alpha', name: 'C' });
    expect(third.ok).toBe(false);
    expect(third.error?.code).toBe('already_started');

    expect(a.messages().some((m) => m.type === 'start')).toBe(true);
    expect(b.messages().some((m) => m.type === 'start')).toBe(true);
    manager.dispose();
  });

  it('快速匹配自动分到不同房间并行开局', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    const c = new FakeWebSocket();
    const d = new FakeWebSocket();

    manager.join(a as never, { type: 'join', mode: 'quick', roomId: '', name: 'A' });
    manager.join(b as never, { type: 'join', mode: 'quick', roomId: '', name: 'B' });
    manager.join(c as never, { type: 'join', mode: 'quick', roomId: '', name: 'C' });
    manager.join(d as never, { type: 'join', mode: 'quick', roomId: '', name: 'D' });

    const roomA = welcomeRoom(a);
    const roomB = welcomeRoom(b);
    const roomC = welcomeRoom(c);
    const roomD = welcomeRoom(d);
    expect(roomA).toBe(roomB);
    expect(roomC).toBe(roomD);
    expect(roomA).not.toBe(roomC);
    expect(manager.size).toBe(2);
    manager.dispose();
  });

  it('等待者离开后空房会被回收', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    manager.join(a as never, { type: 'join', mode: 'room', roomId: 'lonely', name: 'A' });
    expect(manager.size).toBe(1);
    a.close();
    expect(manager.size).toBe(0);
    manager.dispose();
  });

  it('A 房断线不影响 B 房继续推进', () => {
    vi.useFakeTimers();
    const manager = new RoomManager();
    const a1 = new FakeWebSocket();
    const a2 = new FakeWebSocket();
    const b1 = new FakeWebSocket();
    const b2 = new FakeWebSocket();

    manager.join(a1 as never, { type: 'join', mode: 'room', roomId: 'A', name: 'A1' });
    manager.join(a2 as never, { type: 'join', mode: 'room', roomId: 'A', name: 'A2' });
    manager.join(b1 as never, { type: 'join', mode: 'room', roomId: 'B', name: 'B1' });
    manager.join(b2 as never, { type: 'join', mode: 'room', roomId: 'B', name: 'B2' });

    const before = countFrames(b1);
    a1.close();
    vi.advanceTimersByTime(200);
    expect(countFrames(b1)).toBeGreaterThan(before);
    expect(b1.messages().some((m) => m.type === 'peerLeft')).toBe(false);
    manager.dispose();
  });
});

describe('MatchRoom 断线重连', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('断线期间继续 tick，重连后按 lastTick 补帧', () => {
    vi.useFakeTimers();
    const room = new MatchRoom({ roomId: 'resume' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');

    vi.advanceTimersByTime(250); // 约 5 帧
    const token = latestWelcome(a).reconnectToken;
    const framesBeforeDrop = countFrames(a);
    expect(framesBeforeDrop).toBeGreaterThan(0);

    a.close();
    expect(b.messages().some((m) => m.type === 'peerDisconnected')).toBe(true);

    vi.advanceTimersByTime(300); // 断线期间继续推进
    const lastTick = framesBeforeDrop; // 断开前大约已确认到该 tick
    const resumed = new FakeWebSocket();
    expect(room.handleRejoin(resumed as never, token, lastTick)).toBe(true);
    expect(b.messages().some((m) => m.type === 'peerReconnected')).toBe(true);

    const replayed = resumed
      .messages()
      .filter((m): m is Extract<ServerMessage, { type: 'frame' }> => m.type === 'frame');
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed[0]?.tick).toBe(lastTick + 1);
    room.dispose();
  });

  it('错误令牌无法重连，超时后 peerLeft', () => {
    vi.useFakeTimers();
    const room = new MatchRoom({ roomId: 'timeout' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');

    a.close();
    const bad = new FakeWebSocket();
    expect(room.handleRejoin(bad as never, 'not-a-token', 0)).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(b.messages().some((m) => m.type === 'peerLeft')).toBe(true);
  });
});

function welcomeRoom(ws: FakeWebSocket): string {
  const welcome = ws.messages().find((m) => m.type === 'welcome');
  if (!welcome || welcome.type !== 'welcome') throw new Error('missing welcome');
  return welcome.roomId;
}

function latestWelcome(ws: FakeWebSocket) {
  const welcome = [...ws.messages()].reverse().find((m) => m.type === 'welcome');
  if (!welcome || welcome.type !== 'welcome') throw new Error('missing welcome');
  return welcome;
}

function countFrames(ws: FakeWebSocket): number {
  return ws.messages().filter((m) => m.type === 'frame').length;
}
