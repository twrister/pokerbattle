/** 玩家档案 schema 版本；读写时用于迁移。 */
export const PLAYER_PROFILE_SCHEMA_VERSION = 1;

/** 最近对战 / 关卡挑战摘要条数上限。 */
export const MAX_RECENT_BATTLES = 50;
export const MAX_RECENT_STAGE_CHALLENGES = 50;

/** 展示名长度限制（trim 后）。 */
export const MIN_DISPLAY_NAME_LENGTH = 1;
export const MAX_DISPLAY_NAME_LENGTH = 16;

export type BattleMode = 'solo' | 'versus';
export type BattleOutcome = 'win' | 'loss' | 'draw';
/** 含联机中途退出；与 sim MatchEndReason 对齐并扩展 abandoned。 */
export type BattleEndReason =
  | 'base_destroyed'
  | 'time_limit'
  | 'simultaneous_destroyed'
  | 'abandoned';

export type StageChallengeOutcome = 'cleared' | 'failed' | 'abandoned';

/** 单次对战摘要，供近期列表与后续上报复用。 */
export interface BattleRecordSummary {
  id: string;
  mode: BattleMode;
  outcome: BattleOutcome;
  reason: BattleEndReason;
  recordedAt: number;
}

/** 单次关卡挑战摘要；当前尚无关卡接线，仅预留数据面。 */
export interface StageChallengeSummary {
  id: string;
  stageId: string;
  outcome: StageChallengeOutcome;
  recordedAt: number;
}

export interface PlayerProfileStats {
  wins: number;
  losses: number;
  draws: number;
  stageAttempts: number;
  stageClears: number;
}

/** 设备级玩家档案：慢变 meta，不含局内仿真状态。 */
export interface PlayerProfile {
  schemaVersion: number;
  deviceAccountId: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  level: number;
  exp: number;
  currentStageId: string | null;
  stats: PlayerProfileStats;
  recentBattles: BattleRecordSummary[];
  recentStageChallenges: StageChallengeSummary[];
}

/** 记录对战所需的最小输入（id / 时间由服务生成）。 */
export interface RecordBattleInput {
  mode: BattleMode;
  outcome: BattleOutcome;
  reason: BattleEndReason;
}

/** 记录关卡挑战所需的最小输入。 */
export interface RecordStageChallengeInput {
  stageId: string;
  outcome: StageChallengeOutcome;
}

/** 显式写入成长字段，不自动推算升级。 */
export interface ProgressionPatch {
  level?: number;
  exp?: number;
}

/** 存储后端抽象，便于日后替换为云端仓库。 */
export interface PlayerProfileStore {
  load(): unknown;
  save(profile: PlayerProfile): void;
  /** 损坏数据备份；实现方可空操作。 */
  backupCorrupt?(raw: string): void;
}
