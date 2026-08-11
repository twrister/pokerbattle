// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECENT_BATTLES,
  PLAYER_PROFILE_CORRUPT_BACKUP_KEY,
  PLAYER_PROFILE_SCHEMA_VERSION,
  PLAYER_PROFILE_STORAGE_KEY,
  createLocalPlayerProfileStore,
  createPlayerProfileService,
  sanitizeProfile,
  type PlayerProfile,
  type PlayerProfileStore,
} from '../src/account/index.js';

describe('玩家档案服务', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('首次启动静默建档，再次加载保持同一设备 ID', () => {
    const first = createPlayerProfileService({ now: () => 1000 });
    const profile = first.getProfile();
    expect(profile.schemaVersion).toBe(PLAYER_PROFILE_SCHEMA_VERSION);
    expect(profile.deviceAccountId.length).toBeGreaterThan(0);
    expect(profile.displayName.startsWith('玩家-')).toBe(true);
    expect(profile.level).toBe(1);
    expect(profile.exp).toBe(0);
    expect(profile.stats).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      stageAttempts: 0,
      stageClears: 0,
    });

    const second = createPlayerProfileService({ now: () => 2000 });
    expect(second.getProfile().deviceAccountId).toBe(profile.deviceAccountId);
    expect(second.getProfile().displayName).toBe(profile.displayName);
  });

  it('损坏数据会备份并重建默认档案', () => {
    localStorage.setItem(PLAYER_PROFILE_STORAGE_KEY, '{not-json');
    const service = createPlayerProfileService({ now: () => 3000 });
    const profile = service.getProfile();
    expect(profile.createdAt).toBe(3000);
    expect(localStorage.getItem(PLAYER_PROFILE_CORRUPT_BACKUP_KEY)).toBe('{not-json');
    expect(localStorage.getItem(PLAYER_PROFILE_STORAGE_KEY)).toContain(profile.deviceAccountId);
  });

  it('旧字段缺失时迁移补齐并裁剪非法值', () => {
    const migrated = sanitizeProfile({
      deviceAccountId: 'device-1',
      displayName: '  测试玩家  ',
      createdAt: 10,
      level: 0,
      exp: -5,
      recentBattles: [
        {
          id: 'b1',
          mode: 'solo',
          outcome: 'win',
          reason: 'base_destroyed',
          recordedAt: 11,
        },
        { id: 'bad', mode: 'pve', outcome: 'win', reason: 'x', recordedAt: 12 },
      ],
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.displayName).toBe('测试玩家');
    expect(migrated!.level).toBe(1);
    expect(migrated!.exp).toBe(0);
    expect(migrated!.stats.wins).toBe(0);
    expect(migrated!.recentBattles).toHaveLength(1);
    expect(migrated!.recentBattles[0]?.id).toBe('b1');
  });

  it('改名会校验空名与长度，合法名称会持久化', () => {
    const service = createPlayerProfileService({ now: () => 4000 });
    expect(() => service.setDisplayName('   ')).toThrow('名字不能为空');
    expect(() => service.setDisplayName('测'.repeat(17))).toThrow('名字最多');
    const renamed = service.setDisplayName('  蓝方统帅  ');
    expect(renamed.displayName).toBe('蓝方统帅');
    expect(createPlayerProfileService().getProfile().displayName).toBe('蓝方统帅');
  });

  it('对战记录更新累计统计并限制最近 50 条', () => {
    let tick = 5000;
    let seq = 0;
    const service = createPlayerProfileService({
      now: () => ++tick,
      createId: () => `id-${++seq}`,
    });

    service.recordBattle({ mode: 'solo', outcome: 'win', reason: 'base_destroyed' });
    service.recordBattle({ mode: 'versus', outcome: 'loss', reason: 'abandoned' });
    service.recordBattle({ mode: 'versus', outcome: 'draw', reason: 'time_limit' });

    let profile = service.getProfile();
    expect(profile.stats).toMatchObject({ wins: 1, losses: 1, draws: 1 });
    expect(profile.recentBattles[0]?.reason).toBe('time_limit');

    for (let i = 0; i < MAX_RECENT_BATTLES; i += 1) {
      service.recordBattle({ mode: 'solo', outcome: 'win', reason: 'base_destroyed' });
    }
    profile = service.getProfile();
    expect(profile.recentBattles).toHaveLength(MAX_RECENT_BATTLES);
    expect(profile.stats.wins).toBe(1 + MAX_RECENT_BATTLES);
  });

  it('成长与关卡字段只接受显式写入', () => {
    const service = createPlayerProfileService({ now: () => 6000, createId: () => 'stage-1' });
    service.setProgression({ level: 3, exp: 120 });
    service.setCurrentStage('stage_forest_01');
    service.recordStageChallenge({ stageId: 'stage_forest_01', outcome: 'cleared' });
    service.recordStageChallenge({ stageId: 'stage_forest_01', outcome: 'failed' });

    const profile = service.getProfile();
    expect(profile.level).toBe(3);
    expect(profile.exp).toBe(120);
    expect(profile.currentStageId).toBe('stage_forest_01');
    expect(profile.stats.stageAttempts).toBe(2);
    expect(profile.stats.stageClears).toBe(1);
    expect(profile.recentStageChallenges).toHaveLength(2);
  });

  it('写入失败时保留内存态并抛出诊断错误', () => {
    const memory = new Map<string, string>();
    let failSave = false;
    const store: PlayerProfileStore = {
      load() {
        const raw = memory.get(PLAYER_PROFILE_STORAGE_KEY);
        return raw ? (JSON.parse(raw) as unknown) : null;
      },
      save(profile: PlayerProfile) {
        if (failSave) throw new Error('quota exceeded');
        memory.set(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
      },
    };

    const service = createPlayerProfileService({
      store,
      now: () => 7000,
      createId: () => 'battle-x',
    });
    failSave = true;
    expect(() =>
      service.recordBattle({ mode: 'versus', outcome: 'loss', reason: 'abandoned' }),
    ).toThrow('玩家档案写入失败');
    expect(service.getProfile().stats.losses).toBe(1);
    expect(service.getProfile().recentBattles[0]?.id).toBe('battle-x');
  });

  it('localStorage 仓库可读写 JSON 档案', () => {
    const store = createLocalPlayerProfileStore();
    const service = createPlayerProfileService({ store, now: () => 8000 });
    const saved = service.setDisplayName('仓库测试');
    const raw = store.load();
    expect(raw).toMatchObject({
      deviceAccountId: saved.deviceAccountId,
      displayName: '仓库测试',
    });
  });
});
