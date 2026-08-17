import type { Command, Faction, MatchEndReason, MatchMode } from '@pb/sim';

/** 本地录像 schema；不兼容时整仓丢弃。 */
export const REPLAY_SCHEMA_VERSION = 1;
/** 本地最多保留的联机录像条数。 */
export const MAX_REPLAYS = 10;
/** 独立于玩家档案，避免每次改名都重写整段录像。 */
export const REPLAY_STORAGE_KEY = 'pb.replays.v1';

/** 回放 HUD 用的席位与显示名；不参与仿真。 */
export interface ReplaySideContext {
  localFaction: Faction;
  localName: string;
  opponentName: string;
  localSlot?: number;
  teammateName?: string;
  teammateSlot?: number | null;
  opponentSlot?: number;
  extraOpponentName?: string;
  extraOpponentSlot?: number | null;
}

/** 只存有指令的权威帧；缺失 tick 回放时视为空帧。 */
export interface ReplayFrame {
  tick: number;
  commands: Command[];
}

/** 一局可重跑的联机录像。 */
export interface ReplayRecord {
  schemaVersion: number;
  id: string;
  recordedAt: number;
  seed: number;
  matchMode: MatchMode;
  endTick: number;
  result: { winner: Faction | null; reason: MatchEndReason };
  context: ReplaySideContext;
  frames: ReplayFrame[];
  /** 场地布局指纹，变更后提示回放可能失真。 */
  arenaSignature: string;
}

/** 写入仓库所需的最小字段；id / 时间由仓库补齐。 */
export type ReplayRecordInput = Omit<ReplayRecord, 'schemaVersion' | 'id' | 'recordedAt'>;
