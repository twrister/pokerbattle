import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Faction } from '@pb/sim';
import {
  PlayerStatsStore,
  listAllOpsPlayers,
  normalizePlayerId,
  resolveDecisiveMatch,
} from '../src/playerStatsStore.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

function tempStore(now = () => 1_700_000_000_000): PlayerStatsStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
  dirs.push(dir);
  return new PlayerStatsStore({
    filePath: path.join(dir, 'player-stats.json'),
    now,
  });
}

describe('normalizePlayerId', () => {
  it('接受 UUID 与兜底格式，拒绝空串和非法字符', () => {
    expect(normalizePlayerId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(normalizePlayerId('  pb-lm8abc-xyz12  ')).toBe('pb-lm8abc-xyz12');
    expect(normalizePlayerId('')).toBeNull();
    expect(normalizePlayerId('  ')).toBeNull();
    expect(normalizePlayerId('id with space')).toBeNull();
    expect(normalizePlayerId('<script>')).toBeNull();
  });
});

describe('resolveDecisiveMatch', () => {
  const seats = [
    { playerId: 'blue-1', name: '蓝', faction: Faction.Blue },
    { playerId: 'red-1', name: '红', faction: Faction.Red },
  ];

  it('有胜者且双方都有 ID 时返回记账双方', () => {
    expect(resolveDecisiveMatch(seats, Faction.Blue)).toEqual({
      winnerId: 'blue-1',
      loserId: 'red-1',
      names: { winner: '蓝', loser: '红' },
    });
  });

  it('平局或缺 ID 不记账', () => {
    expect(resolveDecisiveMatch(seats, null)).toBeNull();
    expect(
      resolveDecisiveMatch(
        [
          { playerId: null, name: '蓝', faction: Faction.Blue },
          { playerId: 'red-1', name: '红', faction: Faction.Red },
        ],
        Faction.Red,
      ),
    ).toBeNull();
  });
});

describe('PlayerStatsStore', () => {
  it('入座登记昵称，改名不拆档', () => {
    const store = tempStore();
    store.upsertPlayer('player-a', '旧名');
    store.upsertPlayer('player-a', '新名');
    expect(store.listPlayers()).toEqual([
      expect.objectContaining({
        playerId: 'player-a',
        displayName: '新名',
        matches: 0,
        wins: 0,
        losses: 0,
        winRate: null,
      }),
    ]);
  });

  it('只在有胜负时累加场次，并派生胜率', () => {
    const store = tempStore();
    store.recordDecisiveMatch('winner-1', 'loser-1', { winner: '胜', loser: '负' });
    store.recordDecisiveMatch('winner-1', 'loser-1', { winner: '胜', loser: '负' });
    const [first, second] = store.listPlayers();
    expect(first).toMatchObject({
      playerId: 'winner-1',
      displayName: '胜',
      matches: 2,
      wins: 2,
      losses: 0,
      winRate: 1,
    });
    expect(second).toMatchObject({
      playerId: 'loser-1',
      matches: 2,
      wins: 0,
      losses: 2,
      winRate: 0,
    });
  });

  it('缺 playerId 或胜负双方同一人时不记', () => {
    const store = tempStore();
    store.recordDecisiveMatch('', 'loser-1', { winner: '胜', loser: '负' });
    store.recordDecisiveMatch('same', 'same', { winner: 'A', loser: 'B' });
    expect(store.listPlayers()).toEqual([]);
  });

  it('重连刷新 lastOnlineAt，断线再写离开时刻', () => {
    let now = 1_000;
    const store = tempStore(() => now);
    store.upsertPlayer('player-a', '甲');
    expect(store.lookup('player-a')?.lastOnlineAt).toBe(1_000);
    now = 2_000;
    store.upsertPlayer('player-a', '甲');
    expect(store.lookup('player-a')?.lastOnlineAt).toBe(2_000);
    now = 3_000;
    store.touchLastOnline('player-a');
    expect(store.lookup('player-a')?.lastOnlineAt).toBe(3_000);
  });

  it('全量名单含离线，在线优先并按上次在线降序', () => {
    let now = 100;
    const store = tempStore(() => now);
    store.upsertPlayer('offline-old', '旧离线');
    now = 200;
    store.upsertPlayer('offline-new', '新离线');
    now = 50;
    store.upsertPlayer('online-1', '在线');
    const rows = listAllOpsPlayers(
      [
        { playerId: 'online-1', name: '在线', location: 'lobby', roomId: null, roomName: null },
        { playerId: 'online-1', name: '在线', location: 'room', roomId: '042', roomName: '对局房' },
        { playerId: null, name: '匿名', location: 'lobby', roomId: null, roomName: null },
      ],
      store,
    );
    expect(rows.map((row) => row.playerId)).toEqual(['online-1', 'offline-new', 'offline-old']);
    expect(rows[0]).toMatchObject({
      displayName: '在线',
      location: 'room',
      roomId: '042',
      roomName: '对局房',
    });
    expect(rows[1]).toMatchObject({ location: 'offline', lastOnlineAt: 200 });
    expect(rows[2]).toMatchObject({ location: 'offline', lastOnlineAt: 100 });
  });

  it('旧档缺 lastOnlineAt 时回退 lastPlayedAt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'player-stats.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        players: [
          {
            playerId: 'legacy-1',
            displayName: '旧档',
            matches: 0,
            wins: 0,
            losses: 0,
            firstSeenAt: 10,
            lastPlayedAt: 20,
          },
        ],
      }),
    );
    const store = new PlayerStatsStore({ filePath, now: () => 99 });
    expect(store.lookup('legacy-1')).toMatchObject({
      lastPlayedAt: 20,
      lastOnlineAt: 20,
    });
  });

  it('落盘后新实例能恢复战绩', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'player-stats.json');
    const first = new PlayerStatsStore({ filePath, now: () => 100 });
    first.upsertPlayer('keep-me', '甲');
    first.recordDecisiveMatch('keep-me', 'other', { winner: '甲', loser: '乙' });

    const second = new PlayerStatsStore({ filePath, now: () => 200 });
    expect(second.listPlayers()).toEqual([
      expect.objectContaining({
        playerId: 'keep-me',
        displayName: '甲',
        matches: 1,
        wins: 1,
        winRate: 1,
      }),
      expect.objectContaining({
        playerId: 'other',
        displayName: '乙',
        matches: 1,
        losses: 1,
        winRate: 0,
      }),
    ]);
  });
});
