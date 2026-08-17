import { createAccountId } from '../account/id.js';
import { cloneCommand } from './recorder.js';
import {
  MAX_REPLAYS,
  REPLAY_SCHEMA_VERSION,
  REPLAY_STORAGE_KEY,
  type ReplayFrame,
  type ReplayRecord,
  type ReplayRecordInput,
  type ReplaySideContext,
} from './types.js';

export interface ReplayStore {
  /** 按时间倒序返回已落盘录像。 */
  list(): ReplayRecord[];
  /**
   * 新录像插到队首并裁到上限。
   * 配额不足时丢最旧再试；仍失败则返回 false，不抛错。
   */
  save(input: ReplayRecordInput): boolean;
}

export interface CreateReplayStoreOptions {
  storage?: Storage;
  now?: () => number;
  createId?: () => string;
}

/** 基于 localStorage 的联机录像仓库，FIFO 只留最近 10 场。 */
export function createReplayStore(options: CreateReplayStoreOptions = {}): ReplayStore {
  const storage = options.storage ?? localStorage;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? createAccountId;

  const readAll = (): ReplayRecord[] => {
    const raw = storage.getItem(REPLAY_STORAGE_KEY);
    if (!raw) return [];
    try {
      return sanitizeStore(JSON.parse(raw));
    } catch {
      return [];
    }
  };

  const writeAll = (replays: ReplayRecord[]): void => {
    storage.setItem(REPLAY_STORAGE_KEY, JSON.stringify({
      schemaVersion: REPLAY_SCHEMA_VERSION,
      replays,
    }));
  };

  return {
    list() {
      return readAll().map(cloneRecord);
    },

    save(input) {
      const record: ReplayRecord = {
        ...cloneRecord({
          schemaVersion: REPLAY_SCHEMA_VERSION,
          id: createId(),
          recordedAt: now(),
          ...input,
        }),
        schemaVersion: REPLAY_SCHEMA_VERSION,
      };
      let next = [record, ...readAll()].slice(0, MAX_REPLAYS);
      while (next.length > 0) {
        try {
          writeAll(next);
          return true;
        } catch (error) {
          if (!isQuotaError(error) || next.length <= 1) {
            console.warn('[replay] 录像写入失败', error);
            return false;
          }
          // 配额不够就先丢掉最旧的再试，保证新对局优先留下
          next = next.slice(0, -1);
        }
      }
      return false;
    },
  };
}

/** 顶层 schema 不符或解析失败时整仓丢弃，避免半残数据回放。 */
function sanitizeStore(raw: unknown): ReplayRecord[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const value = raw as { schemaVersion?: unknown; replays?: unknown };
  if (value.schemaVersion !== REPLAY_SCHEMA_VERSION) return [];
  if (!Array.isArray(value.replays)) return [];
  const records: ReplayRecord[] = [];
  for (const item of value.replays) {
    const record = sanitizeRecord(item);
    if (record) records.push(record);
  }
  return records.slice(0, MAX_REPLAYS);
}

function sanitizeRecord(raw: unknown): ReplayRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<ReplayRecord>;
  if (value.schemaVersion !== REPLAY_SCHEMA_VERSION) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (!isFiniteNumber(value.recordedAt) || !isFiniteNumber(value.seed) || !isFiniteNumber(value.endTick)) {
    return null;
  }
  if (value.matchMode !== '1v1' && value.matchMode !== '2v2') return null;
  if (!value.result || typeof value.result !== 'object') return null;
  if (value.result.reason !== 'base_destroyed'
    && value.result.reason !== 'time_limit'
    && value.result.reason !== 'simultaneous_destroyed') {
    return null;
  }
  if (value.result.winner !== null && value.result.winner !== 0 && value.result.winner !== 1) {
    return null;
  }
  const context = sanitizeContext(value.context);
  if (!context) return null;
  if (!Array.isArray(value.frames)) return null;
  const frames: ReplayFrame[] = [];
  for (const frame of value.frames) {
    const sanitized = sanitizeFrame(frame);
    if (sanitized) frames.push(sanitized);
  }
  if (typeof value.arenaSignature !== 'string') return null;
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: value.id,
    recordedAt: value.recordedAt,
    seed: value.seed,
    matchMode: value.matchMode,
    endTick: value.endTick,
    result: { winner: value.result.winner, reason: value.result.reason },
    context,
    frames,
    arenaSignature: value.arenaSignature,
  };
}

function sanitizeContext(raw: unknown): ReplaySideContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<ReplaySideContext>;
  if (value.localFaction !== 0 && value.localFaction !== 1) return null;
  if (typeof value.localName !== 'string' || typeof value.opponentName !== 'string') return null;
  return {
    localFaction: value.localFaction,
    localName: value.localName,
    opponentName: value.opponentName,
    localSlot: isFiniteNumber(value.localSlot) ? value.localSlot : undefined,
    teammateName: typeof value.teammateName === 'string' ? value.teammateName : undefined,
    teammateSlot: value.teammateSlot === null || isFiniteNumber(value.teammateSlot) ? value.teammateSlot : undefined,
    opponentSlot: isFiniteNumber(value.opponentSlot) ? value.opponentSlot : undefined,
    extraOpponentName: typeof value.extraOpponentName === 'string' ? value.extraOpponentName : undefined,
    extraOpponentSlot:
      value.extraOpponentSlot === null || isFiniteNumber(value.extraOpponentSlot)
        ? value.extraOpponentSlot
        : undefined,
  };
}

function sanitizeFrame(raw: unknown): ReplayFrame | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<ReplayFrame>;
  if (!isFiniteNumber(value.tick) || !Array.isArray(value.commands)) return null;
  return {
    tick: value.tick,
    commands: value.commands.filter(isCommandLike).map(cloneCommand),
  };
}

function isCommandLike(value: unknown): value is ReplayFrame['commands'][number] {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'kind' in value);
}

function cloneRecord(record: ReplayRecord): ReplayRecord {
  return {
    ...record,
    result: { ...record.result },
    context: { ...record.context },
    frames: record.frames.map((frame) => ({
      tick: frame.tick,
      commands: frame.commands.map(cloneCommand),
    })),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; code?: number };
  return value.name === 'QuotaExceededError' || value.code === 22;
}
