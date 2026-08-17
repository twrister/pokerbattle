import fs from 'node:fs';
import path from 'node:path';
import { normalizeDisplayName, normalizePlayerId } from './playerStatsStore.js';
import type { OpsFeedbackRecord } from './opsTypes.js';

const STORE_SCHEMA_VERSION = 1;
/** 正文上限，与客户端 textarea maxlength 对齐。 */
export const FEEDBACK_CONTENT_MAX_LENGTH = 500;
/** 同一设备两次提交的最短间隔，避免连点刷屏。 */
export const FEEDBACK_RATE_LIMIT_MS = 30_000;
/** 总量上限，超出丢最旧，避免文件无限涨。 */
export const FEEDBACK_MAX_RECORDS = 500;
const FEEDBACK_ID_MAX_LENGTH = 80;
const APP_VERSION_MAX_LENGTH = 32;

/** 磁盘/内存中的一条玩家意见。 */
export interface FeedbackRecord {
  id: string;
  content: string;
  playerId: string;
  displayName: string;
  appVersion: string;
  createdAt: number;
}

export interface FeedbackStoreOptions {
  filePath: string;
  now?: () => number;
}

export interface AddFeedbackInput {
  content: unknown;
  playerId?: unknown;
  displayName?: unknown;
  appVersion?: unknown;
}

export type AddFeedbackResult =
  | { ok: true; record: FeedbackRecord }
  | { ok: false; reason: 'empty' | 'too-fast' };

/**
 * 玩家意见仓库：内存数组 + JSON 落盘。
 * 仅权威服接收 POST /feedback 时写入，进程重启后从文件恢复。
 */
export class FeedbackStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly records: FeedbackRecord[] = [];
  /** 每个 playerId 最近一次成功提交的时间，进程内限频。 */
  private readonly lastSubmitAt = new Map<string, number>();
  private seq = 0;

  constructor(options: FeedbackStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
    this.load();
  }

  /**
   * 写入一条意见。空正文拒绝；超长截断；同一 playerId 30 秒内重复返回 too-fast。
   */
  add(input: AddFeedbackInput): AddFeedbackResult {
    const content = normalizeContent(input.content);
    if (!content) return { ok: false, reason: 'empty' };

    const playerId = normalizePlayerId(input.playerId) ?? '';
    const now = this.now();
    const lastAt = this.lastSubmitAt.get(playerId);
    if (lastAt !== undefined && now - lastAt < FEEDBACK_RATE_LIMIT_MS) {
      return { ok: false, reason: 'too-fast' };
    }

    const record: FeedbackRecord = {
      id: this.nextId(now),
      content,
      playerId,
      displayName: normalizeDisplayName(input.displayName),
      appVersion: normalizeAppVersion(input.appVersion),
      createdAt: now,
    };
    this.records.push(record);
    while (this.records.length > FEEDBACK_MAX_RECORDS) {
      this.records.shift();
    }
    this.lastSubmitAt.set(playerId, now);
    this.persist();
    return { ok: true, record };
  }

  /** 按创建时间倒序，供运维站展示最新意见。 */
  list(): OpsFeedbackRecord[] {
    return [...this.records].sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      return b.id.localeCompare(a.id);
    });
  }

  private nextId(now: number): string {
    this.seq += 1;
    return `fb-${now}-${this.seq}`;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const rows = (parsed as { feedback?: unknown }).feedback;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const record = sanitizeRecord(row);
      if (record) this.records.push(record);
    }
    this.records.sort((a, b) => a.createdAt - b.createdAt);
    if (this.records.length > FEEDBACK_MAX_RECORDS) {
      this.records.splice(0, this.records.length - FEEDBACK_MAX_RECORDS);
    }
    for (const record of this.records) {
      const match = /^fb-\d+-(\d+)$/.exec(record.id);
      if (match) this.seq = Math.max(this.seq, Number(match[1]));
    }
  }

  /** 先写临时文件再替换，避免进程崩溃留下半截 JSON。 */
  private persist(): void {
    const payload = {
      schemaVersion: STORE_SCHEMA_VERSION,
      feedback: this.records,
    };
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, 'utf8');
    try {
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Windows 上 rename 不能覆盖已有文件，先删再替。
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        /* ignore */
      }
      fs.renameSync(tmpPath, this.filePath);
    }
  }
}

/** 丢弃损坏行，避免一份坏意见拖垮整表。 */
function sanitizeRecord(raw: unknown): FeedbackRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  const id = row.id.trim();
  if (!id || id.length > FEEDBACK_ID_MAX_LENGTH) return null;
  const content = normalizeContent(row.content);
  if (!content) return null;
  const createdAt = readPositiveInt(row.createdAt);
  if (!createdAt) return null;
  return {
    id,
    content,
    playerId: normalizePlayerId(row.playerId) ?? '',
    displayName: normalizeDisplayName(row.displayName),
    appVersion: normalizeAppVersion(row.appVersion),
    createdAt,
  };
}

function normalizeContent(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  return text.slice(0, FEEDBACK_CONTENT_MAX_LENGTH);
}

function normalizeAppVersion(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, APP_VERSION_MAX_LENGTH);
}

function readPositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
