/**
 * 单键存档，存放在 sessionStorage：按标签页隔离。
 * 同一浏览器开两个窗口对战时各自的凭据互不覆盖，刷新后仍能读回本页那一局。
 */
export const REJOIN_TICKET_KEY = 'pb.rejoin.ticket.v1';

/** 局外自救凭据：凭 roomId + token 才能接回原来那一席。 */
export interface RejoinTicket {
  playerId: string;
  roomId: string;
  token: string;
  /** 写入时刻，仅用于排查；是否过期以服务端探测结果为准。 */
  savedAt: number;
}

export interface RejoinTicketStore {
  /** 读取属于该设备的凭据；不存在、损坏或不属于该设备都返回 null。 */
  load(playerId: string): RejoinTicket | null;
  /** 开局拿到令牌时保存；覆盖旧凭据，保证只跟最近一局。 */
  save(ticket: { playerId: string; roomId: string; token: string }): void;
  /** 结算、掉线放弃或玩家拒绝时清除。 */
  clear(): void;
}

/**
 * 基于 sessionStorage 的重连凭据仓库：
 * 每个标签页独占一份，避免同浏览器双开时互相顶掉席位。
 * 写入失败（隐私模式/配额满）时静默降级，不影响对局主流程。
 */
export function createRejoinTicketStore(
  storage: Storage = sessionStorage,
  now: () => number = Date.now,
): RejoinTicketStore {
  /** 结构损坏或换号时整条清掉，避免留着误导后续判断。 */
  const discard = (): null => {
    try {
      storage.removeItem(REJOIN_TICKET_KEY);
    } catch {
      /* ignore */
    }
    return null;
  };

  return {
    load(playerId) {
      if (!playerId) return null;
      const raw = storage.getItem(REJOIN_TICKET_KEY);
      if (!raw) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return discard();
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return discard();
      const ticket = parsed as Partial<RejoinTicket>;
      if (
        typeof ticket.playerId !== 'string' ||
        typeof ticket.roomId !== 'string' ||
        typeof ticket.token !== 'string' ||
        !ticket.playerId ||
        !ticket.roomId ||
        !ticket.token
      ) {
        return discard();
      }
      if (ticket.playerId !== playerId) return discard();
      return {
        playerId: ticket.playerId,
        roomId: ticket.roomId,
        token: ticket.token,
        savedAt: typeof ticket.savedAt === 'number' ? ticket.savedAt : 0,
      };
    },
    save(ticket) {
      if (!ticket.playerId || !ticket.roomId || !ticket.token) return;
      try {
        storage.setItem(
          REJOIN_TICKET_KEY,
          JSON.stringify({
            playerId: ticket.playerId,
            roomId: ticket.roomId,
            token: ticket.token,
            savedAt: now(),
          } satisfies RejoinTicket),
        );
      } catch {
        /* 存储不可用时放弃局外自救，对局本身不受影响 */
      }
    },
    clear() {
      discard();
    },
  };
}
