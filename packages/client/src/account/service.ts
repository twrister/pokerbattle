import { createAccountId } from './id.js';
import {
  createDefaultProfile,
  finalizeProfile,
  sanitizeProfile,
  validateDisplayName,
} from './sanitize.js';
import { createLocalPlayerProfileStore } from './storage.js';
import type {
  PlayerProfile,
  PlayerProfileStore,
  ProgressionPatch,
  RecordBattleInput,
  RecordStageChallengeInput,
} from './types.js';

export interface PlayerProfileService {
  /** 当前内存中的档案快照。 */
  getProfile(): PlayerProfile;
  /** 改名；校验失败抛出 Error。 */
  setDisplayName(displayName: string): PlayerProfile;
  /** 显式写入等级/经验，不自动升级。 */
  setProgression(patch: ProgressionPatch): PlayerProfile;
  /** 设置当前关卡；传 null 表示清空。 */
  setCurrentStage(stageId: string | null): PlayerProfile;
  /** 写入一条对战摘要并更新累计胜负。 */
  recordBattle(input: RecordBattleInput): PlayerProfile;
  /** 写入一条关卡挑战摘要并更新累计次数。 */
  recordStageChallenge(input: RecordStageChallengeInput): PlayerProfile;
}

export interface CreatePlayerProfileServiceOptions {
  store?: PlayerProfileStore;
  now?: () => number;
  createId?: () => string;
}

/**
 * 加载或创建设备档案，并提供低感知读写 API。
 * 写入失败时保留内存态，同时抛出可诊断错误。
 */
export function createPlayerProfileService(
  options: CreatePlayerProfileServiceOptions = {},
): PlayerProfileService {
  const store = options.store ?? createLocalPlayerProfileStore();
  const now = options.now ?? Date.now;
  const createId = options.createId ?? createAccountId;

  let profile = loadOrCreate(store, now);

  const persist = (): PlayerProfile => {
    profile = finalizeProfile(profile, now());
    try {
      store.save(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`玩家档案写入失败：${message}`);
    }
    return cloneProfile(profile);
  };

  return {
    getProfile() {
      return cloneProfile(profile);
    },

    setDisplayName(displayName) {
      const result = validateDisplayName(displayName);
      if (!result.ok) throw new Error(result.error);
      profile = { ...profile, displayName: result.value };
      return persist();
    },

    setProgression(patch) {
      const level =
        typeof patch.level === 'number' && Number.isFinite(patch.level)
          ? Math.max(1, Math.floor(patch.level))
          : profile.level;
      const exp =
        typeof patch.exp === 'number' && Number.isFinite(patch.exp)
          ? Math.max(0, Math.floor(patch.exp))
          : profile.exp;
      profile = { ...profile, level, exp };
      return persist();
    },

    setCurrentStage(stageId) {
      const next =
        stageId === null
          ? null
          : typeof stageId === 'string' && stageId.trim()
            ? stageId.trim()
            : profile.currentStageId;
      profile = { ...profile, currentStageId: next };
      return persist();
    },

    recordBattle(input) {
      const recordedAt = now();
      const record = {
        id: createId(),
        mode: input.mode,
        outcome: input.outcome,
        reason: input.reason,
        recordedAt,
      };
      const stats = { ...profile.stats };
      if (input.outcome === 'win') stats.wins += 1;
      else if (input.outcome === 'loss') stats.losses += 1;
      else stats.draws += 1;

      profile = {
        ...profile,
        stats,
        recentBattles: [record, ...profile.recentBattles],
      };
      return persist();
    },

    recordStageChallenge(input) {
      const stageId = input.stageId.trim();
      if (!stageId) throw new Error('关卡 ID 不能为空');
      const recordedAt = now();
      const record = {
        id: createId(),
        stageId,
        outcome: input.outcome,
        recordedAt,
      };
      const stats = {
        ...profile.stats,
        stageAttempts: profile.stats.stageAttempts + 1,
        stageClears:
          input.outcome === 'cleared' ? profile.stats.stageClears + 1 : profile.stats.stageClears,
      };
      profile = {
        ...profile,
        stats,
        recentStageChallenges: [record, ...profile.recentStageChallenges],
      };
      return persist();
    },
  };
}

/** 从仓库加载；损坏则备份并重建默认档案。 */
function loadOrCreate(store: PlayerProfileStore, now: () => number): PlayerProfile {
  const raw = store.load();
  if (raw == null) {
    const created = createDefaultProfile(now());
    try {
      store.save(created);
    } catch {
      // 首次写失败仍返回内存档案，后续操作会再尝试
    }
    return created;
  }

  const sanitized = sanitizeProfile(raw, now());
  if (!sanitized) {
    if (typeof raw === 'string') store.backupCorrupt?.(raw);
    else {
      try {
        store.backupCorrupt?.(JSON.stringify(raw));
      } catch {
        /* ignore */
      }
    }
    const created = createDefaultProfile(now());
    try {
      store.save(created);
    } catch {
      /* ignore */
    }
    return created;
  }

  // 迁移后的结构写回，保证下次读到当前 schema
  try {
    store.save(finalizeProfile(sanitized, now()));
  } catch {
    /* ignore */
  }
  return sanitized;
}

/** 对外返回深拷贝，避免调用方改坏内存态。 */
function cloneProfile(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    stats: { ...profile.stats },
    recentBattles: profile.recentBattles.map((item) => ({ ...item })),
    recentStageChallenges: profile.recentStageChallenges.map((item) => ({ ...item })),
  };
}
