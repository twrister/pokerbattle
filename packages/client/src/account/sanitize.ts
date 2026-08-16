import { defaultDisplayName, createAccountId } from './id.js';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RECENT_BATTLES,
  MAX_RECENT_STAGE_CHALLENGES,
  MIN_DISPLAY_NAME_LENGTH,
  PLAYER_PROFILE_SCHEMA_VERSION,
  type BattleEndReason,
  type BattleMode,
  type BattleOutcome,
  type BattleRecordSummary,
  type PlayerProfile,
  type PlayerProfileStats,
  type StageChallengeOutcome,
  type StageChallengeSummary,
} from './types.js';

/** 创建一份合法默认档案（首次启动或损坏重建）。 */
export function createDefaultProfile(now = Date.now()): PlayerProfile {
  const deviceAccountId = createAccountId();
  return {
    schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
    deviceAccountId,
    displayName: defaultDisplayName(deviceAccountId),
    createdAt: now,
    updatedAt: now,
    battleScore: 0,
    exp: 0,
    currentStageId: null,
    stats: emptyStats(),
    recentBattles: [],
    recentStageChallenges: [],
  };
}

/** 校验并规范化展示名；非法时返回错误文案。 */
export function validateDisplayName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (value.length < MIN_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: '名字不能为空' };
  }
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: `名字最多 ${MAX_DISPLAY_NAME_LENGTH} 个字符` };
  }
  return { ok: true, value };
}

/**
 * 将任意存储载荷迁移/清洗为合法档案。
 * 损坏或类型完全不对时返回 null，由调用方决定重建。
 */
export function sanitizeProfile(raw: unknown, now = Date.now()): PlayerProfile | null {
  if (!isRecord(raw)) return null;

  const deviceAccountId =
    typeof raw.deviceAccountId === 'string' && raw.deviceAccountId.trim().length > 0
      ? raw.deviceAccountId.trim()
      : null;
  if (!deviceAccountId) return null;

  const createdAt = readPositiveInt(raw.createdAt, now);
  const updatedAt = Math.max(readPositiveInt(raw.updatedAt, createdAt), createdAt);
  const nameResult = validateDisplayName(
    typeof raw.displayName === 'string' ? raw.displayName : defaultDisplayName(deviceAccountId),
  );

  return {
    schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
    deviceAccountId,
    displayName: nameResult.ok ? nameResult.value : defaultDisplayName(deviceAccountId),
    createdAt,
    updatedAt,
    // 旧档只有 level，丢弃后等服务端下发权威积分。
    battleScore: Math.max(0, readNonNegativeInt(raw.battleScore, 0)),
    exp: Math.max(0, readNonNegativeInt(raw.exp, 0)),
    currentStageId: readStageId(raw.currentStageId),
    stats: sanitizeStats(raw.stats),
    recentBattles: sanitizeBattles(raw.recentBattles),
    recentStageChallenges: sanitizeStageChallenges(raw.recentStageChallenges),
  };
}

/** 裁剪最近列表并刷新 updatedAt，保证写盘前结构合法。 */
export function finalizeProfile(profile: PlayerProfile, now = Date.now()): PlayerProfile {
  return {
    ...profile,
    schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
    updatedAt: now,
    battleScore: Math.max(0, Math.floor(profile.battleScore)),
    exp: Math.max(0, Math.floor(profile.exp)),
    recentBattles: profile.recentBattles.slice(0, MAX_RECENT_BATTLES),
    recentStageChallenges: profile.recentStageChallenges.slice(0, MAX_RECENT_STAGE_CHALLENGES),
  };
}

function emptyStats(): PlayerProfileStats {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    stageAttempts: 0,
    stageClears: 0,
  };
}

function sanitizeStats(raw: unknown): PlayerProfileStats {
  const fallback = emptyStats();
  if (!isRecord(raw)) return fallback;
  return {
    wins: readNonNegativeInt(raw.wins, 0),
    losses: readNonNegativeInt(raw.losses, 0),
    draws: readNonNegativeInt(raw.draws, 0),
    stageAttempts: readNonNegativeInt(raw.stageAttempts, 0),
    stageClears: readNonNegativeInt(raw.stageClears, 0),
  };
}

function sanitizeBattles(raw: unknown): BattleRecordSummary[] {
  if (!Array.isArray(raw)) return [];
  const items: BattleRecordSummary[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    const mode = readBattleMode(entry.mode);
    const outcome = readBattleOutcome(entry.outcome);
    const reason = readBattleReason(entry.reason);
    const recordedAt = readPositiveInt(entry.recordedAt, 0);
    if (!id || !mode || !outcome || !reason || recordedAt <= 0) continue;
    items.push({ id, mode, outcome, reason, recordedAt });
    if (items.length >= MAX_RECENT_BATTLES) break;
  }
  return items;
}

function sanitizeStageChallenges(raw: unknown): StageChallengeSummary[] {
  if (!Array.isArray(raw)) return [];
  const items: StageChallengeSummary[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    const stageId = typeof entry.stageId === 'string' && entry.stageId.trim() ? entry.stageId.trim() : null;
    const outcome = readStageOutcome(entry.outcome);
    const recordedAt = readPositiveInt(entry.recordedAt, 0);
    if (!id || !stageId || !outcome || recordedAt <= 0) continue;
    items.push({ id, stageId, outcome, recordedAt });
    if (items.length >= MAX_RECENT_STAGE_CHALLENGES) break;
  }
  return items;
}

function readStageId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBattleMode(value: unknown): BattleMode | null {
  return value === 'solo' || value === 'versus' ? value : null;
}

function readBattleOutcome(value: unknown): BattleOutcome | null {
  return value === 'win' || value === 'loss' || value === 'draw' ? value : null;
}

function readBattleReason(value: unknown): BattleEndReason | null {
  return value === 'base_destroyed' ||
    value === 'time_limit' ||
    value === 'simultaneous_destroyed' ||
    value === 'abandoned'
    ? value
    : null;
}

function readStageOutcome(value: unknown): StageChallengeOutcome | null {
  return value === 'cleared' || value === 'failed' || value === 'abandoned' ? value : null;
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n > 0 ? n : fallback;
}

function readNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n >= 0 ? n : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
