import fs from 'node:fs';
import path from 'node:path';
import type { OpsMetricsPayload } from './opsTypes.js';
import { normalizePlayerId } from './playerStatsStore.js';

/** 小时桶保留 7 天：7×24 个整点。 */
export const HOURLY_RETENTION_HOURS = 168;
/** 日桶保留 30 天，供 DAU 趋势。 */
export const DAILY_RETENTION_DAYS = 30;
/** 采样间隔：1 分钟一次，一小时 60 个样本足够画均值/峰值。 */
export const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;
/** 单日 DAU 去重集合上限；超出后只停止扩充 DAU，在线人数照常统计。 */
export const DAILY_ACTIVE_ID_CAP = 20_000;
const STORE_SCHEMA_VERSION = 1;
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 一次在线人数采样的即时快照。 */
export interface OnlineSample {
  /** 上报了设备 ID 的在线玩家（同一设备多连接只算 1）。 */
  devices: number;
  /** 未上报设备 ID 的匿名连接数，只计入在线人数，不计入 DAU。 */
  anonymous: number;
  /** 全部 WebSocket 连接数，含观战与重复连接，仅供展示口径对照。 */
  connections: number;
  /** 停在大厅（含卡组/图鉴等）的连接数。 */
  lobby: number;
  /** 单机/战役页面的连接数。 */
  solo: number;
  /** 已入座联机房的对局玩家数。 */
  room: number;
}

export interface MetricsStoreOptions {
  filePath: string;
  /** 注入时钟，便于单测固定「此刻」。 */
  now?: () => number;
  /** 日/小时边界所在时区；非法值回落 Asia/Shanghai。 */
  timeZone?: string;
  sampleIntervalMs?: number;
  /** 单日 DAU 去重上限，默认 DAILY_ACTIVE_ID_CAP。 */
  dailyIdCap?: number;
}

/** 构建载荷的外部输入：新增玩家来自玩家档案，不额外采集。 */
export interface MetricsPayloadInput {
  /** day('YYYY-MM-DD') → 当日首次出现的玩家数。 */
  newPlayersByDay: Map<string, number>;
  totalPlayers: number;
}

interface HourBucket {
  /** 按 timeZone 对齐的整点毫秒值（用当地时间的 UTC 表示，保证单调可比）。 */
  hourStart: number;
  samples: number;
  onlineSum: number;
  onlinePeak: number;
  lobbySum: number;
  soloSum: number;
  roomSum: number;
}

interface DayBucket {
  day: string;
  /** 自 1970-01-01 起的当地天数，用于保留裁剪与补零。 */
  dayIndex: number;
  /** 当日去重活跃玩家数；跨天后仍保留，供 DAU 折线用。 */
  dau: number;
  /** 当日已见到的设备 ID；仅当天持久化，跨天清空以控制文件体积。 */
  ids: Set<string>;
  peakOnline: number;
  matches: number;
  durationMsSum: number;
}

/** 当地时间的年月日时分，全部由 Intl 按指定时区解析。 */
interface LocalStamp {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/**
 * 运营时序数据仓库：内存桶 + JSON 落盘。
 * 采样由游戏服定时驱动（见 index.ts），运维站只读展示，因此重启与发布后历史仍在。
 */
export class MetricsStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly timeZone: string;
  private readonly dailyIdCap: number;
  private readonly sampleInterval: number;
  private readonly formatter: Intl.DateTimeFormat;
  private readonly hourly = new Map<number, HourBucket>();
  private readonly daily = new Map<string, DayBucket>();
  private lastSample: (OnlineSample & { sampledAt: number }) | null = null;
  private persistFailed = false;

  constructor(options: MetricsStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
    this.timeZone = resolveTimeZone(options.timeZone);
    this.dailyIdCap = Math.max(1, Math.floor(options.dailyIdCap ?? DAILY_ACTIVE_ID_CAP));
    this.sampleInterval = Math.max(
      1_000,
      Math.floor(options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS),
    );
    this.formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    this.load();
  }

  /** 采集间隔（毫秒），供运维页提示与前端展示。 */
  get sampleIntervalMs(): number {
    return this.sampleInterval;
  }

  /** 生效时区，供运维页直接展示，避免与浏览器时区混淆。 */
  get effectiveTimeZone(): string {
    return this.timeZone;
  }

  /** 记录一名玩家今日活跃；同一设备只算一次，非法/缺失 ID 直接忽略。 */
  notePlayerActive(rawId: string): void {
    const playerId = normalizePlayerId(rawId);
    if (!playerId) return;
    const bucket = this.ensureDay(this.now());
    if (bucket.ids.has(playerId)) return;
    if (bucket.ids.size >= this.dailyIdCap) return;
    bucket.ids.add(playerId);
    // 取大值：若当日桶是从磁盘读回且 ids 被截断，不能让计数倒退
    bucket.dau = Math.max(bucket.dau, bucket.ids.size);
    this.persist();
  }

  /** 记录一次在线人数采样：累加到当前小时桶，并刷新当日峰值。 */
  recordSample(sample: OnlineSample): void {
    const now = this.now();
    const online = countOnline(sample);
    const hourStart = this.hourStartOf(now);
    const bucket = this.hourly.get(hourStart) ?? {
      hourStart,
      samples: 0,
      onlineSum: 0,
      onlinePeak: 0,
      lobbySum: 0,
      soloSum: 0,
      roomSum: 0,
    };
    bucket.samples += 1;
    bucket.onlineSum += online;
    bucket.onlinePeak = Math.max(bucket.onlinePeak, online);
    bucket.lobbySum += readCount(sample.lobby);
    bucket.soloSum += readCount(sample.solo);
    bucket.roomSum += readCount(sample.room);
    this.hourly.set(hourStart, bucket);

    const day = this.ensureDay(now);
    day.peakOnline = Math.max(day.peakOnline, online);

    this.lastSample = {
      devices: readCount(sample.devices),
      anonymous: readCount(sample.anonymous),
      connections: readCount(sample.connections),
      lobby: readCount(sample.lobby),
      solo: readCount(sample.solo),
      room: readCount(sample.room),
      sampledAt: now,
    };
    this.prune(now);
    this.persist();
  }

  /** 记录一局结束：含平局与断线前已结算的局，按「有结算结果」口径统计。 */
  recordMatchEnd(durationMs: number): void {
    const now = this.now();
    const day = this.ensureDay(now);
    day.matches += 1;
    day.durationMsSum += Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0));
    this.persist();
  }

  /**
   * 组装运维只读载荷。
   * 日维度补满 30 天空桶便于表格对齐；小时维度只回有采样的桶，前端按缺桶断线。
   */
  buildPayload(input: MetricsPayloadInput): OpsMetricsPayload {
    const now = this.now();
    const todayIndex = dayIndexOf(this.stamp(now));
    const todayDay = this.dayKeyOf(now);
    const todayBucket = this.daily.get(todayDay);

    const daily: OpsMetricsPayload['daily'] = [];
    for (let offset = DAILY_RETENTION_DAYS - 1; offset >= 0; offset -= 1) {
      const index = todayIndex - offset;
      const day = dayKeyFromIndex(index);
      const bucket = this.daily.get(day);
      daily.push({
        day,
        label: dayLabel(day),
        dau: bucket?.dau ?? 0,
        peakOnline: bucket?.peakOnline ?? 0,
        matches: bucket?.matches ?? 0,
        avgMatchDurationMs: averageDuration(bucket?.durationMsSum ?? 0, bucket?.matches ?? 0),
        newPlayers: input.newPlayersByDay.get(day) ?? 0,
      });
    }

    const hourly: OpsMetricsPayload['hourly'] = [...this.hourly.values()]
      .filter((bucket) => bucket.samples > 0)
      .sort((a, b) => a.hourStart - b.hourStart)
      .map((bucket) => ({
        hourStart: bucket.hourStart,
        label: hourLabel(bucket.hourStart),
        avgOnline: round1(bucket.onlineSum / bucket.samples),
        peakOnline: bucket.onlinePeak,
      }));

    const retainedMatches = [...this.daily.values()].reduce((sum, day) => sum + day.matches, 0);

    return {
      ok: true,
      generatedAt: now,
      timeZone: this.timeZone,
      sampleIntervalMs: this.sampleInterval,
      hourlyRetentionHours: HOURLY_RETENTION_HOURS,
      dailyRetentionDays: DAILY_RETENTION_DAYS,
      current: {
        onlineDevices: this.lastSample?.devices ?? 0,
        anonymousConnections: this.lastSample?.anonymous ?? 0,
        connections: this.lastSample?.connections ?? 0,
        lobby: this.lastSample?.lobby ?? 0,
        solo: this.lastSample?.solo ?? 0,
        room: this.lastSample?.room ?? 0,
        sampledAt: this.lastSample?.sampledAt ?? null,
      },
      today: {
        day: todayDay,
        dau: todayBucket?.dau ?? 0,
        peakOnline: todayBucket?.peakOnline ?? 0,
        matches: todayBucket?.matches ?? 0,
        avgMatchDurationMs: averageDuration(
          todayBucket?.durationMsSum ?? 0,
          todayBucket?.matches ?? 0,
        ),
      },
      totals: {
        totalPlayers: Math.max(0, Math.floor(input.totalPlayers)),
        /** 只覆盖保留窗口（近 30 天）内的对局数，页面上注明口径。 */
        totalMatches: retainedMatches,
        newPlayersToday: input.newPlayersByDay.get(todayDay) ?? 0,
      },
      daily,
      hourly,
    };
  }

  /** 落盘当前快照；进程退出时调用，保证最后一分钟的数据不丢。 */
  dispose(): void {
    this.persist();
  }

  /** 按当地时区取当前日桶，必要时新建。 */
  private ensureDay(now: number): DayBucket {
    const stamp = this.stamp(now);
    const day = dayKeyOf(stamp);
    const existing = this.daily.get(day);
    if (existing) return existing;
    const created: DayBucket = {
      day,
      dayIndex: dayIndexOf(stamp),
      dau: 0,
      ids: new Set<string>(),
      peakOnline: 0,
      matches: 0,
      durationMsSum: 0,
    };
    this.daily.set(day, created);
    return created;
  }

  /** 按保留窗口裁掉过期桶；跨天的 DAU 去重集合清空以控制落盘体积。 */
  private prune(now: number): void {
    const currentHour = this.hourStartOf(now) / HOUR_MS;
    const hourCutoff = currentHour - HOURLY_RETENTION_HOURS;
    for (const [key, bucket] of [...this.hourly]) {
      if (bucket.hourStart / HOUR_MS < hourCutoff) this.hourly.delete(key);
    }

    const todayKey = this.dayKeyOf(now);
    const todayIndex = dayIndexOf(this.stamp(now));
    const dayCutoff = todayIndex - DAILY_RETENTION_DAYS;
    for (const [key, bucket] of [...this.daily]) {
      if (bucket.dayIndex < dayCutoff) {
        this.daily.delete(key);
        continue;
      }
      if (key !== todayKey && bucket.ids.size > 0) {
        bucket.dau = Math.max(bucket.dau, bucket.ids.size);
        bucket.ids.clear();
      }
    }
  }

  private dayKeyOf(now: number): string {
    return dayKeyOf(this.stamp(now));
  }

  /** 单调递增的整点键：当地时间的年月日时换算成 UTC 毫秒。 */
  private hourStartOf(now: number): number {
    const stamp = this.stamp(now);
    return Date.UTC(stamp.year, stamp.month - 1, stamp.day, stamp.hour);
  }

  private stamp(now: number): LocalStamp {
    const parts = this.formatter.formatToParts(new Date(now));
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const found = parts.find((part) => part.type === type);
      return found ? Number(found.value) : 0;
    };
    return {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour') % 24,
    };
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
    const root = parsed as { hourly?: unknown; daily?: unknown };
    if (Array.isArray(root.hourly)) {
      for (const row of root.hourly) {
        const bucket = sanitizeHourBucket(row);
        if (bucket) this.hourly.set(bucket.hourStart, bucket);
      }
    }
    if (Array.isArray(root.daily)) {
      for (const row of root.daily) {
        const bucket = sanitizeDayBucket(row, this.dailyIdCap);
        if (bucket) this.daily.set(bucket.day, bucket);
      }
    }
    // 只保留当天的去重集合，历史天的 id 不落盘也不参与去重
    const todayKey = this.dayKeyOf(this.now());
    for (const [key, bucket] of this.daily) {
      if (key !== todayKey) {
        bucket.dau = Math.max(bucket.dau, bucket.ids.size);
        bucket.ids.clear();
      }
    }
  }

  /** 先写临时文件再替换，避免崩溃留下半截 JSON；写失败只告警一次。 */
  private persist(): void {
    const todayKey = this.dayKeyOf(this.now());
    const payload = {
      schemaVersion: STORE_SCHEMA_VERSION,
      timeZone: this.timeZone,
      sampleIntervalMs: this.sampleInterval,
      hourly: [...this.hourly.values()].sort((a, b) => a.hourStart - b.hourStart),
      daily: [...this.daily.values()]
        .sort((a, b) => a.dayIndex - b.dayIndex)
        .map((bucket) => ({
          day: bucket.day,
          dayIndex: bucket.dayIndex,
          dau: bucket.dau,
          peakOnline: bucket.peakOnline,
          matches: bucket.matches,
          durationMsSum: bucket.durationMsSum,
          // 只有当天需要 id 集合去重，历史天只保留计数
          ids: bucket.day === todayKey ? [...bucket.ids] : [],
        })),
    };
    const dir = path.dirname(this.filePath);
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, 'utf8');
      try {
        fs.renameSync(tmpPath, this.filePath);
      } catch {
        // Windows 上 rename 不能覆盖已有文件，先删再替。
        fs.unlinkSync(this.filePath);
        fs.renameSync(tmpPath, this.filePath);
      }
      this.persistFailed = false;
    } catch (error) {
      // 只读盘 / 磁盘满等场景降级为内存统计，不影响游戏服主流程
      if (!this.persistFailed) {
        this.persistFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[pb-server] metrics persist failed: ${message}`);
      }
    }
  }
}

/** 在线人数口径：已识别设备 + 匿名连接，同一设备多开只算 1 人。 */
function countOnline(sample: OnlineSample): number {
  return readCount(sample.devices) + readCount(sample.anonymous);
}

function readCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** 无对局时平均时长没有意义，回 null 让前端显示「—」。 */
function averageDuration(sum: number, matches: number): number | null {
  if (matches <= 0) return null;
  return Math.round(sum / matches);
}

function round1(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

/** 非法时区回落默认值并告警一次，避免运维页显示空图。 */
function resolveTimeZone(raw: string | undefined): string {
  const candidate = (raw ?? '').trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    console.warn(`[pb-server] METRICS_TZ 非法（${candidate}），回落到 ${DEFAULT_TIME_ZONE}`);
    return DEFAULT_TIME_ZONE;
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dayKeyOf(stamp: LocalStamp): string {
  return `${stamp.year}-${pad2(stamp.month)}-${pad2(stamp.day)}`;
}

function dayIndexOf(stamp: LocalStamp): number {
  return Math.floor(Date.UTC(stamp.year, stamp.month - 1, stamp.day) / DAY_MS);
}

/** 反解当地日序号为日期串；时区边界已在采样时固定，这里只做日历换算。 */
function dayKeyFromIndex(dayIndex: number): string {
  const date = new Date(dayIndex * DAY_MS);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dayLabel(day: string): string {
  return day.slice(5);
}

/** 整点标签由「当地时间的年月日时」直接读出，无需再做时区换算。 */
function hourLabel(hourStart: number): string {
  const date = new Date(hourStart);
  const day = `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  return `${day} ${pad2(date.getUTCHours())}:00`;
}

function sanitizeHourBucket(raw: unknown): HourBucket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const hourStart = readCount(row.hourStart);
  if (!hourStart) return null;
  const samples = readCount(row.samples);
  if (!samples) return null;
  return {
    hourStart,
    samples,
    onlineSum: readCount(row.onlineSum),
    onlinePeak: readCount(row.onlinePeak),
    lobbySum: readCount(row.lobbySum),
    soloSum: readCount(row.soloSum),
    roomSum: readCount(row.roomSum),
  };
}

function sanitizeDayBucket(raw: unknown, idCap: number): DayBucket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const day = typeof row.day === 'string' ? row.day.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ids = new Set<string>();
  if (Array.isArray(row.ids)) {
    for (const rawId of row.ids) {
      if (ids.size >= idCap) break;
      const playerId = normalizePlayerId(rawId);
      if (playerId) ids.add(playerId);
    }
  }
  return {
    day,
    dayIndex: dayIndexOf({
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
      day: Number(day.slice(8, 10)),
      hour: 0,
    }),
    dau: Math.max(readCount(row.dau), ids.size),
    ids,
    peakOnline: readCount(row.peakOnline),
    matches: readCount(row.matches),
    durationMsSum: readCount(row.durationMsSum),
  };
}
