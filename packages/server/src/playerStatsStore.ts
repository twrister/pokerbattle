import fs from 'node:fs';
import path from 'node:path';
import type { Faction } from '@pb/sim';

/** 与客户端展示名上限对齐，避免运维表被超长昵称撑开。 */
const DISPLAY_NAME_MAX_LENGTH = 16;
/** 覆盖 UUID 与 `pb-时间戳-随机串` 兜底格式。 */
const PLAYER_ID_MAX_LENGTH = 80;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const STORE_SCHEMA_VERSION = 1;

/** 磁盘/内存中的玩家战绩行；胜率由 list 时派生。 */
export interface PlayerStatsRecord {
  playerId: string;
  displayName: string;
  matches: number;
  wins: number;
  losses: number;
  firstSeenAt: number;
  lastPlayedAt: number;
  /** 最近一次入厅/入房或最后一条 WS 断开的时间。 */
  lastOnlineAt: number;
}

/** 运维接口行：在落盘字段上附加胜率。 */
export interface OpsPlayerRecord extends PlayerStatsRecord {
  /** 无场次时为 null，避免除零。 */
  winRate: number | null;
}

/** 当前在线身份，用来和历史战绩拼成运维行。 */
export interface OnlinePresence {
  playerId: string | null;
  name: string;
  location: 'lobby' | 'room' | 'solo';
  roomId: string | null;
  roomName: string | null;
}

/** 运维玩家行：当前连接位置或离线 + 历史战绩。 */
export interface OnlinePlayerView extends OpsPlayerRecord {
  location: 'lobby' | 'room' | 'solo' | 'offline';
  roomId: string | null;
  roomName: string | null;
}

export interface PlayerStatsStoreOptions {
  filePath: string;
  now?: () => number;
}

export interface DecisiveMatchSides {
  winnerId: string;
  loserId: string;
  names: { winner: string; loser: string };
}

/** 清洗设备 ID；空串或非法字符视为未上报，避免把同名玩家揉在一起。 */
export function normalizePlayerId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id || id.length > PLAYER_ID_MAX_LENGTH || !PLAYER_ID_PATTERN.test(id)) return null;
  return id;
}

/** 清洗展示名；空则回退，超长裁剪。 */
export function normalizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return 'player';
  const name = raw.trim();
  if (!name) return 'player';
  return name.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * 从席位与胜者阵营解析记账双方。
 * 平局、缺席或任一方未带 playerId 时返回 null，避免记半场或匿名对局。
 */
export function resolveDecisiveMatch(
  seats: ReadonlyArray<{ playerId: string | null; name: string; faction: Faction } | null>,
  winner: Faction | null,
): DecisiveMatchSides | null {
  if (winner === null) return null;
  const occupied = seats.filter((seat): seat is NonNullable<(typeof seats)[number]> => seat !== null);
  const winSeat = occupied.find((seat) => seat.faction === winner);
  const loseSeat = occupied.find((seat) => seat.faction !== winner);
  if (!winSeat?.playerId || !loseSeat?.playerId) return null;
  if (winSeat.playerId === loseSeat.playerId) return null;
  return {
    winnerId: winSeat.playerId,
    loserId: loseSeat.playerId,
    names: { winner: winSeat.name, loser: loseSeat.name },
  };
}

/**
 * 联机玩家战绩仓库：内存 Map + JSON 落盘。
 * 仅权威服在有胜负的 versus 结算时累加，进程重启后从文件恢复。
 */
export class PlayerStatsStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly players = new Map<string, PlayerStatsRecord>();

  constructor(options: PlayerStatsStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
    this.load();
  }

  /** 入厅/入房时登记昵称并刷新上次在线；无场次的玩家也会出现在运维表。 */
  upsertPlayer(playerId: string, name: string): void {
    const id = normalizePlayerId(playerId);
    if (!id) return;
    const displayName = normalizeDisplayName(name);
    const existing = this.players.get(id);
    const now = this.now();
    if (!existing) {
      this.players.set(id, {
        playerId: id,
        displayName,
        matches: 0,
        wins: 0,
        losses: 0,
        firstSeenAt: now,
        lastPlayedAt: now,
        lastOnlineAt: now,
      });
    } else {
      this.players.set(id, { ...existing, displayName, lastOnlineAt: now });
    }
    this.persist();
  }

  /** 设备最后一条 WS 断开时写入离开时刻，供运维表按上次在线排序。 */
  touchLastOnline(playerId: string): void {
    const id = normalizePlayerId(playerId);
    if (!id) return;
    const existing = this.players.get(id);
    if (!existing) return;
    this.players.set(id, { ...existing, lastOnlineAt: this.now() });
    this.persist();
  }

  /** 只在一方获胜时记账；双方各 +1 场，胜者 +1 胜，负者 +1 负。 */
  recordDecisiveMatch(
    winnerId: string,
    loserId: string,
    names: { winner: string; loser: string },
  ): void {
    const winId = normalizePlayerId(winnerId);
    const loseId = normalizePlayerId(loserId);
    if (!winId || !loseId || winId === loseId) return;
    this.ensurePlayer(winId, names.winner);
    this.ensurePlayer(loseId, names.loser);
    const now = this.now();
    this.applyOutcome(winId, 'win', now);
    this.applyOutcome(loseId, 'loss', now);
    this.persist();
  }

  /** 按 ID 取历史战绩；未登记过则返回 null。 */
  lookup(playerId: string): PlayerStatsRecord | null {
    return this.players.get(playerId) ?? null;
  }

  /** 运维清空单人档案；非法 ID 或未登记返回 false，不写盘。 */
  deletePlayer(playerId: string): boolean {
    const id = normalizePlayerId(playerId);
    if (!id || !this.players.has(id)) return false;
    this.players.delete(id);
    this.persist();
    return true;
  }

  /** 运维一键清空全部档案，返回删除条数；空表也落盘以免旧文件残留。 */
  clearAll(): number {
    const cleared = this.players.size;
    this.players.clear();
    this.persist();
    return cleared;
  }

  /** 按场次降序列出全部历史档案（含当前不在线）。 */
  listPlayers(): OpsPlayerRecord[] {
    return [...this.players.values()]
      .map((record) => ({
        ...record,
        winRate: record.matches > 0 ? record.wins / record.matches : null,
      }))
      .sort((a, b) => {
        if (b.matches !== a.matches) return b.matches - a.matches;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.lastPlayedAt !== a.lastPlayedAt) return b.lastPlayedAt - a.lastPlayedAt;
        return a.displayName.localeCompare(b.displayName, 'zh');
      });
  }

  private ensurePlayer(playerId: string, name: string): void {
    if (this.players.has(playerId)) {
      const displayName = normalizeDisplayName(name);
      const existing = this.players.get(playerId)!;
      if (existing.displayName !== displayName) {
        this.players.set(playerId, { ...existing, displayName });
      }
      return;
    }
    const now = this.now();
    this.players.set(playerId, {
      playerId,
      displayName: normalizeDisplayName(name),
      matches: 0,
      wins: 0,
      losses: 0,
      firstSeenAt: now,
      lastPlayedAt: now,
      lastOnlineAt: now,
    });
  }

  private applyOutcome(playerId: string, outcome: 'win' | 'loss', now: number): void {
    const existing = this.players.get(playerId);
    if (!existing) return;
    this.players.set(playerId, {
      ...existing,
      matches: existing.matches + 1,
      wins: existing.wins + (outcome === 'win' ? 1 : 0),
      losses: existing.losses + (outcome === 'loss' ? 1 : 0),
      lastPlayedAt: now,
    });
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
    const rows = (parsed as { players?: unknown }).players;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const record = sanitizeRecord(row);
      if (record) this.players.set(record.playerId, record);
    }
  }

  /** 先写临时文件再替换，避免进程崩溃留下半截 JSON。 */
  private persist(): void {
    const payload = {
      schemaVersion: STORE_SCHEMA_VERSION,
      players: [...this.players.values()],
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

/** 丢弃损坏行，避免一份坏档案拖垮整表。 */
function sanitizeRecord(raw: unknown): PlayerStatsRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const playerId = normalizePlayerId(row.playerId);
  if (!playerId) return null;
  const matches = readNonNegativeInt(row.matches);
  const wins = readNonNegativeInt(row.wins);
  const losses = readNonNegativeInt(row.losses);
  if (wins + losses > matches) return null;
  const firstSeenAt = readPositiveInt(row.firstSeenAt);
  const lastPlayedAt = Math.max(readPositiveInt(row.lastPlayedAt), firstSeenAt);
  // 旧档没有 lastOnlineAt 时回退到对局/首次见到时间，避免排序落到 0。
  const lastOnlineAt = Math.max(readPositiveInt(row.lastOnlineAt), lastPlayedAt);
  return {
    playerId,
    displayName: normalizeDisplayName(row.displayName),
    matches,
    wins,
    losses,
    firstSeenAt,
    lastPlayedAt,
    lastOnlineAt,
  };
}

function readNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * 输出全部历史档案，叠加上线位置；同一 ID 只留一行，房间优先于单机，单机优先于大厅。
 * 排序：当前在线优先，再按上次在线时间降序。
 */
export function listAllOpsPlayers(
  presences: readonly OnlinePresence[],
  store: PlayerStatsStore,
): OnlinePlayerView[] {
  const byKey = new Map<string, OnlinePresence>();
  for (const presence of presences) {
    const key = normalizePlayerId(presence.playerId);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || presenceRank(presence.location) > presenceRank(existing.location)) {
      byKey.set(key, { ...presence, playerId: key });
    }
  }

  const seen = new Set<string>();
  const rows: OnlinePlayerView[] = [];
  for (const record of store.listPlayers()) {
    seen.add(record.playerId);
    const presence = byKey.get(record.playerId);
    rows.push({
      ...record,
      displayName: presence ? normalizeDisplayName(presence.name) : record.displayName,
      location: presence?.location ?? 'offline',
      roomId: presence?.roomId ?? null,
      roomName: presence?.roomName ?? null,
    });
  }

  // 刚连上、档案尚未落盘的在线连接也要出现，避免运维表漏人。
  for (const [playerId, presence] of byKey) {
    if (seen.has(playerId)) continue;
    rows.push({
      playerId,
      displayName: normalizeDisplayName(presence.name),
      matches: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      firstSeenAt: 0,
      lastPlayedAt: 0,
      lastOnlineAt: 0,
      location: presence.location,
      roomId: presence.roomId,
      roomName: presence.roomName,
    });
  }

  return rows.sort((a, b) => {
    const aOnline = a.location !== 'offline';
    const bOnline = b.location !== 'offline';
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    if (b.lastOnlineAt !== a.lastOnlineAt) return b.lastOnlineAt - a.lastOnlineAt;
    return a.displayName.localeCompare(b.displayName, 'zh');
  });
}

/** 同一设备多连接时：房间 > 单机 > 大厅。 */
function presenceRank(location: OnlinePresence['location']): number {
  if (location === 'room') return 3;
  if (location === 'solo') return 2;
  return 1;
}

function readPositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
