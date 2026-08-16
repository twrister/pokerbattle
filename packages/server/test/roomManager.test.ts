import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeServerMessage, encodeMessage, type ServerMessage } from '@pb/net';
import { MatchState } from '@pb/sim';
import { PlayerStatsStore } from '../src/playerStatsStore.js';
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

  it('创建房间得三位房号，同房两人开局，第三人被拒绝', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    const c = new FakeWebSocket();

    const created = manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'A',
      roomName: '测试房间',
    });
    expect(created.ok).toBe(true);
    const roomId = welcomeRoom(a);
    expect(roomId).toMatch(/^\d{3}$/);
    expect(latestWelcome(a).roomName).toBe('测试房间');

    expect(manager.join(b as never, { type: 'join', mode: 'room', roomId, name: 'B' }).ok).toBe(true);
    expect(a.messages().some((m) => m.type === 'start')).toBe(false);
    expect(a.messages().some((m) => m.type === 'roomState')).toBe(true);

    const third = manager.join(c as never, { type: 'join', mode: 'room', roomId, name: 'C' });
    expect(third.ok).toBe(false);
    expect(third.error?.code).toBe('already_started');

    hostStart(a);
    expect(a.messages().some((m) => m.type === 'start')).toBe(true);
    expect(b.messages().some((m) => m.type === 'start')).toBe(true);
    manager.dispose();
  });

  it('join 带 playerId 时登记玩家，未带则跳过', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-room-stats-'));
    const store = new PlayerStatsStore({ filePath: path.join(dir, 'player-stats.json') });
    const manager = new RoomManager({ playerStats: store });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();

    manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: '有档',
      playerId: 'device-aaa',
    });
    manager.join(b as never, { type: 'join', mode: 'quick', roomId: '', name: '无档' });

    expect(store.listPlayers()).toEqual([
      expect.objectContaining({ playerId: 'device-aaa', displayName: '有档', matches: 0 }),
    ]);
    expect(manager.listOnlinePlayers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'device-aaa', name: '有档', location: 'room' }),
        expect.objectContaining({ playerId: null, name: '无档', location: 'room' }),
      ]),
    );
    manager.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('加入不存在的房间会失败，不会隐式建房', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const result = manager.join(a as never, { type: 'join', mode: 'room', roomId: '042', name: 'A' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_room');
    expect(manager.size).toBe(0);
    manager.dispose();
  });

  it('列表包含全部房间并带上 phase 与 spectatorCount', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    const c = new FakeWebSocket();

    manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'A',
      roomName: '等待房',
    });
    const waitingId = welcomeRoom(a);
    manager.join(b as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'B',
      roomName: '满员房',
    });
    const fullId = welcomeRoom(b);
    manager.join(c as never, { type: 'join', mode: 'room', roomId: fullId, name: 'C' });

    const list = manager.listRooms();
    expect(list).toHaveLength(2);
    expect(list.find((room) => room.roomId === waitingId)).toMatchObject({
      roomId: waitingId,
      roomName: '等待房',
      playerCount: 1,
      maxPlayers: 2,
      phase: 'waiting',
      spectatorCount: 0,
    });
    expect(list.find((room) => room.roomId === fullId)).toMatchObject({
      roomId: fullId,
      roomName: '满员房',
      playerCount: 2,
      phase: 'waiting',
      spectatorCount: 0,
    });
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
    expect(roomA).toMatch(/^\d{3}$/);
    expect(roomA).toBe(roomB);
    expect(roomC).toBe(roomD);
    expect(roomA).not.toBe(roomC);
    expect(manager.size).toBe(2);
    manager.dispose();
  });

  it('等待者离开后空房会被回收', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'A',
      roomName: 'lonely',
    });
    expect(manager.size).toBe(1);
    a.close();
    expect(manager.size).toBe(0);
    manager.dispose();
  });

  it('运维快照覆盖等待与对局中房间，且不含重连令牌', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T10:00:00.000Z'));
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    const c = new FakeWebSocket();

    manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'Waiter',
      roomName: '等待房',
    });
    const waitingId = welcomeRoom(a);

    manager.join(b as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'Blue',
      roomName: '对局房',
    });
    const playingId = welcomeRoom(b);
    manager.join(c as never, { type: 'join', mode: 'room', roomId: playingId, name: 'Red' });
    hostStart(b);

    const snapshots = manager.listOpsSnapshots();
    expect(snapshots).toHaveLength(2);
    const waiting = snapshots.find((room) => room.roomId === waitingId);
    const playing = snapshots.find((room) => room.roomId === playingId);
    expect(waiting?.phase).toBe('waiting');
    expect(waiting?.playerCount).toBe(1);
    expect(waiting?.connectedCount).toBe(1);
    expect(playing?.phase).toBe('playing');
    expect(playing?.playerCount).toBe(2);
    expect(playing?.seats.map((seat) => seat.name).sort()).toEqual(['Blue', 'Red']);

    const summary = manager.summarizeOps();
    expect(summary).toMatchObject({
      roomCount: 2,
      waitingRooms: 1,
      playingRooms: 1,
      endedRooms: 0,
      seatedPlayers: 3,
      connectedPlayers: 3,
    });

    // 序列化快照后也不应泄露 reconnectToken
    expect(JSON.stringify(snapshots)).not.toContain('reconnectToken');
    manager.dispose();
  });

  it('A 房断线不影响 B 房继续推进', () => {
    vi.useFakeTimers();
    const manager = new RoomManager();
    const a1 = new FakeWebSocket();
    const a2 = new FakeWebSocket();
    const b1 = new FakeWebSocket();
    const b2 = new FakeWebSocket();

    manager.join(a1 as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'A1',
      roomName: 'A房',
    });
    const roomA = welcomeRoom(a1);
    manager.join(a2 as never, { type: 'join', mode: 'room', roomId: roomA, name: 'A2' });
    hostStart(a1);
    manager.join(b1 as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'B1',
      roomName: 'B房',
    });
    const roomB = welcomeRoom(b1);
    manager.join(b2 as never, { type: 'join', mode: 'room', roomId: roomB, name: 'B2' });
    hostStart(b1);

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
    const room = new MatchRoom({ roomId: '001', roomName: '重连房' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');
    hostStart(a);

    vi.advanceTimersByTime(250); // 约 5 帧
    const token = latestWelcome(a).reconnectToken;
    const framesBeforeDrop = countFrames(a);
    expect(framesBeforeDrop).toBeGreaterThan(0);

    a.close();
    expect(b.messages().some((m) => m.type === 'peerDisconnected')).toBe(true);

    const afterDisconnect = room.toOpsSnapshot();
    expect(afterDisconnect.connectedCount).toBe(1);
    expect(afterDisconnect.seats.find((seat) => seat.name === 'A')?.connected).toBe(false);

    vi.advanceTimersByTime(300); // 断线期间继续推进
    const lastTick = framesBeforeDrop; // 断开前大约已确认到该 tick
    const resumed = new FakeWebSocket();
    expect(room.handleRejoin(resumed as never, token, lastTick)).toBe(true);
    expect(b.messages().some((m) => m.type === 'peerReconnected')).toBe(true);

    const afterRejoin = room.toOpsSnapshot();
    expect(afterRejoin.connectedCount).toBe(2);
    expect(afterRejoin.phase).toBe('playing');
    expect(JSON.stringify(afterRejoin)).not.toContain(token);

    const replayed = resumed
      .messages()
      .filter((m): m is Extract<ServerMessage, { type: 'frame' }> => m.type === 'frame');
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed[0]?.tick).toBe(lastTick + 1);
    room.dispose();
  });

  it('错误令牌无法重连，超时后 peerLeft', () => {
    vi.useFakeTimers();
    const room = new MatchRoom({ roomId: '002', roomName: '超时房' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');
    hostStart(a);

    a.close();
    const bad = new FakeWebSocket();
    expect(room.handleRejoin(bad as never, 'not-a-token', 0)).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(b.messages().some((m) => m.type === 'peerLeft')).toBe(true);
  });

  it('双方均离线超过 3s 后关闭房间', () => {
    vi.useFakeTimers();
    let disposed = false;
    const room = new MatchRoom({
      roomId: '003',
      roomName: '双方离线房',
      onDispose: () => {
        disposed = true;
      },
    });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');
    hostStart(a);

    a.close();
    b.close();
    expect(room.toOpsSnapshot().connectedCount).toBe(0);
    expect(disposed).toBe(false);

    vi.advanceTimersByTime(2_999);
    expect(disposed).toBe(false);

    vi.advanceTimersByTime(1);
    expect(disposed).toBe(true);
    expect(room.isEmpty).toBe(true);
  });

  it('双方离线未满 3s 有一方重连则不关房', () => {
    vi.useFakeTimers();
    let disposed = false;
    const room = new MatchRoom({
      roomId: '004',
      roomName: '短暂双离线',
      onDispose: () => {
        disposed = true;
      },
    });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');
    hostStart(a);

    const tokenA = latestWelcome(a).reconnectToken;
    a.close();
    b.close();
    vi.advanceTimersByTime(2_000);

    const resumed = new FakeWebSocket();
    expect(room.handleRejoin(resumed as never, tokenA, 0)).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(disposed).toBe(false);
    expect(room.toOpsSnapshot().connectedCount).toBe(1);
    expect(room.toOpsSnapshot().phase).toBe('playing');
    room.dispose();
  });

  it('非房主或人数未齐时拒绝 startMatch，房主离开后移交主持', () => {
    const room = new MatchRoom({ roomId: '005', roomName: '主持房' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    a.receive({ type: 'startMatch' });
    expect(a.messages().some((m) => m.type === 'error' && m.code === 'not_ready')).toBe(true);

    room.handleJoin(b as never, 'B');
    b.receive({ type: 'startMatch' });
    expect(b.messages().some((m) => m.type === 'error' && m.code === 'not_host')).toBe(true);
    expect(room.toOpsSnapshot().phase).toBe('waiting');

    a.close();
    const state = b.messages().filter((m) => m.type === 'roomState').at(-1);
    expect(state && state.type === 'roomState' && state.hostSeat).toBe(1);
    expect(state && state.type === 'roomState' && state.members[0]?.isHost).toBe(true);

    const c = new FakeWebSocket();
    room.handleJoin(c as never, 'C');
    hostStart(b);
    expect(b.messages().some((m) => m.type === 'start')).toBe(true);
    expect(room.toOpsSnapshot().phase).toBe('playing');
    room.dispose();
  });

  it('非房主可取消准备，取消后房主无法开局', () => {
    const room = new MatchRoom({ roomId: '006', roomName: '准备房' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');

    a.receive({ type: 'setReady', ready: false });
    expect(a.messages().some((m) => m.type === 'error' && m.code === 'is_host')).toBe(true);

    b.receive({ type: 'setReady', ready: false });
    const state = b.messages().filter((m) => m.type === 'roomState').at(-1);
    expect(state && state.type === 'roomState' && state.members.find((m) => m.seat === 1)?.ready).toBe(
      false,
    );

    hostStart(a);
    expect(a.messages().some((m) => m.type === 'error' && m.code === 'not_ready')).toBe(true);
    expect(room.toOpsSnapshot().phase).toBe('waiting');

    b.receive({ type: 'setReady', ready: true });
    hostStart(a);
    expect(a.messages().some((m) => m.type === 'start')).toBe(true);
    room.dispose();
  });
});

describe('MatchRoom 观战', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未开局房间拒绝观战', () => {
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'A',
      roomName: '等待房',
    });
    const roomId = welcomeRoom(a);
    const viewer = new FakeWebSocket();
    const result = manager.spectate(viewer as never, { type: 'spectate', roomId, name: '观众' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('not_playing');
    manager.dispose();
  });

  it('对局中可观战，收到 welcome 与完整 frameBatch，进出时广播人数', () => {
    vi.useFakeTimers();
    const manager = new RoomManager();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    manager.join(a as never, {
      type: 'join',
      mode: 'create',
      roomId: '',
      name: 'A',
      roomName: '观战房',
    });
    const roomId = welcomeRoom(a);
    manager.join(b as never, { type: 'join', mode: 'room', roomId, name: 'B' });
    hostStart(a);
    vi.advanceTimersByTime(250);

    const viewer = new FakeWebSocket();
    const result = manager.spectate(viewer as never, {
      type: 'spectate',
      roomId,
      name: '观众',
    });
    expect(result.ok).toBe(true);

    const welcome = viewer.messages().find((m) => m.type === 'spectateWelcome');
    expect(welcome).toMatchObject({
      type: 'spectateWelcome',
      roomId,
      roomName: '观战房',
      blueName: 'A',
      redName: 'B',
      spectatorCount: 1,
    });
    const batch = viewer.messages().find((m) => m.type === 'frameBatch');
    expect(batch && batch.type === 'frameBatch' && batch.fromTick).toBe(1);
    expect(batch && batch.type === 'frameBatch' && batch.frames.length).toBeGreaterThan(0);

    expect(a.messages().some((m) => m.type === 'spectatorCount' && m.count === 1)).toBe(true);

    const list = manager.listRooms();
    expect(list.find((room) => room.roomId === roomId)).toMatchObject({
      phase: 'playing',
      spectatorCount: 1,
    });

    viewer.close();
    expect(a.messages().some((m) => m.type === 'spectatorCount' && m.count === 0)).toBe(true);
    manager.dispose();
  });

  it('观战者发 input 不影响权威帧，重放后 hash 与服务端一致', () => {
    vi.useFakeTimers();
    const room = new MatchRoom({ roomId: '077', roomName: '对账房' });
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    room.handleJoin(a as never, 'A');
    room.handleJoin(b as never, 'B');
    hostStart(a);
    vi.advanceTimersByTime(500);

    const framesBefore = countFrames(a);
    const viewer = new FakeWebSocket();
    expect(room.handleSpectate(viewer as never, '观众')).toBe(true);
    viewer.receive({
      type: 'input',
      tick: 999,
      commands: [],
    });
    vi.advanceTimersByTime(200);
    expect(countFrames(a)).toBe(framesBefore + 4);

    const welcome = viewer.messages().find((m) => m.type === 'spectateWelcome');
    const batch = viewer.messages().find((m) => m.type === 'frameBatch');
    expect(welcome && welcome.type === 'spectateWelcome').toBe(true);
    expect(batch && batch.type === 'frameBatch').toBe(true);
    if (!welcome || welcome.type !== 'spectateWelcome' || !batch || batch.type !== 'frameBatch') {
      throw new Error('missing spectate payload');
    }

    const replay = new MatchState(welcome.seed);
    replay.seedStartingCastles();
    for (const commands of batch.frames) {
      replay.step(commands);
    }
    const liveFrames = viewer
      .messages()
      .filter((m): m is Extract<ServerMessage, { type: 'frame' }> => m.type === 'frame');
    for (const frame of liveFrames) {
      replay.step(frame.commands);
    }
    expect(replay.world.tick).toBe(room.toOpsSnapshot().serverTick);
    expect(replay.hash()).toBe(room.currentMatchHash());
    room.dispose();
  });
});

function hostStart(ws: FakeWebSocket): void {
  ws.receive({ type: 'startMatch' });
}

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
