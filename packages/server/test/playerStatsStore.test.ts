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

  it('同一 ID 单机优先于大厅，房间仍优先于单机', () => {
    const store = tempStore();
    store.upsertPlayer('player-a', '甲');
    const soloWins = listAllOpsPlayers(
      [
        { playerId: 'player-a', name: '甲', location: 'lobby', roomId: null, roomName: null },
        { playerId: 'player-a', name: '甲', location: 'solo', roomId: null, roomName: null },
      ],
      store,
    );
    expect(soloWins[0]).toMatchObject({ location: 'solo' });

    const roomWins = listAllOpsPlayers(
      [
        { playerId: 'player-a', name: '甲', location: 'solo', roomId: null, roomName: null },
        { playerId: 'player-a', name: '甲', location: 'room', roomId: '007', roomName: '对局房' },
      ],
      store,
    );
    expect(roomWins[0]).toMatchObject({ location: 'room', roomId: '007' });
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

  it('deletePlayer 删一人并落盘，未知 ID 返回 false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'player-stats.json');
    const store = new PlayerStatsStore({ filePath, now: () => 100 });
    store.upsertPlayer('keep-me', '甲');
    store.upsertPlayer('drop-me', '乙');
    expect(store.deletePlayer('missing')).toBe(false);
    expect(store.deletePlayer('')).toBe(false);
    expect(store.deletePlayer('drop-me')).toBe(true);
    expect(store.listPlayers().map((row) => row.playerId)).toEqual(['keep-me']);

    const reloaded = new PlayerStatsStore({ filePath, now: () => 200 });
    expect(reloaded.listPlayers().map((row) => row.playerId)).toEqual(['keep-me']);
  });

  it('clearAll 清空全部并落盘后再读为空', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'player-stats.json');
    const store = new PlayerStatsStore({ filePath, now: () => 100 });
    store.upsertPlayer('a', '甲');
    store.upsertPlayer('b', '乙');
    expect(store.clearAll()).toBe(2);
    expect(store.listPlayers()).toEqual([]);
    expect(store.clearAll()).toBe(0);

    const reloaded = new PlayerStatsStore({ filePath, now: () => 200 });
    expect(reloaded.listPlayers()).toEqual([]);
  });

  it('胜利积分 +1，未超过 10 分战败不扣，超过后才 -1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'player-stats.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        players: [
          {
            playerId: 'low-score',
            displayName: '低分',
            matches: 3,
            wins: 3,
            losses: 0,
            score: 3,
            firstSeenAt: 10,
            lastPlayedAt: 20,
            lastOnlineAt: 20,
          },
          {
            playerId: 'high-score',
            displayName: '高分',
            matches: 12,
            wins: 11,
            losses: 1,
            score: 11,
            firstSeenAt: 10,
            lastPlayedAt: 20,
            lastOnlineAt: 20,
          },
        ],
      }),
    );
    const store = new PlayerStatsStore({ filePath, now: () => 99 });
    store.recordDecisiveMatch('low-score', 'high-score', { winner: '低分', loser: '高分' });
    expect(store.lookup('low-score')).toMatchObject({ score: 4, wins: 4, losses: 0 });
    expect(store.lookup('high-score')).toMatchObject({ score: 10, wins: 11, losses: 2 });

    store.recordDecisiveMatch('low-score', 'high-score', { winner: '低分', loser: '高分' });
    expect(store.lookup('high-score')?.score).toBe(10);
  });

  it('排行榜按积分、胜率排序，未入前 N 也能查到自己的名次', () => {
    const store = tempStore();
    store.recordDecisiveMatch('ace', 'bronze', { winner: '王牌', loser: '铜牌' });
    store.recordDecisiveMatch('ace', 'silver', { winner: '王牌', loser: '银牌' });
    store.recordDecisiveMatch('silver', 'bronze', { winner: '银牌', loser: '铜牌' });

    const board = store.listLeaderboard();
    expect(board.map((row) => row.playerId)).toEqual(['ace', 'silver', 'bronze']);
    expect(board[0]).toMatchObject({ rank: 1, score: 2, winRate: 1 });
    expect(board[1]).toMatchObject({ rank: 2, score: 1, wins: 1, losses: 1 });
    expect(board[2]).toMatchObject({ rank: 3, score: 0, wins: 0, losses: 2 });

    expect(store.listLeaderboard(1).map((row) => row.playerId)).toEqual(['ace']);
    expect(store.lookupLeaderboardEntry('bronze')).toMatchObject({ rank: 3, playerId: 'bronze' });
    expect(store.lookupLeaderboardEntry('missing')).toBeNull();
  });

  it('旧档缺 score 时回退为 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-player-stats-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'player-stats.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        players: [
          {
            playerId: 'legacy-score',
            displayName: '旧档',
            matches: 2,
            wins: 1,
            losses: 1,
            firstSeenAt: 10,
            lastPlayedAt: 20,
            lastOnlineAt: 20,
          },
        ],
      }),
    );
    const store = new PlayerStatsStore({ filePath, now: () => 99 });
    expect(store.lookup('legacy-score')).toMatchObject({ score: 0, matches: 2 });
    expect(store.listLeaderboard()[0]).toMatchObject({ playerId: 'legacy-score', score: 0, rank: 1 });
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
