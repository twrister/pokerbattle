import type { Command, Faction, MatchEndReason } from '@pb/sim';

/** 默认输入延迟（tick），约 200ms @ 20Hz。 */
export const DEFAULT_INPUT_DELAY = 4;
/** 每隔多少 tick 对一次 hash。 */
export const HASH_INTERVAL_TICKS = 20;
/** 对局中断线后保留席位的毫秒数；超时才判对手离开。 */
export const RECONNECT_TIMEOUT_MS = 30_000;
/** 自定义房号允许的字符与长度，前后端共用同一校验。 */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

/** 规范化并校验房号；非法时返回 null。 */
export function normalizeRoomId(raw: string): string | null {
  const id = raw.trim();
  if (!ROOM_ID_PATTERN.test(id)) return null;
  return id;
}

/** 加入方式：快速匹配由服务端分房；自定义房间按房号创建或加入。 */
export type JoinMode = 'quick' | 'room';

/** C→S：加入房间。 */
export interface JoinMessage {
  type: 'join';
  /** quick 时可为空；room 模式必须是合法房号。 */
  roomId: string;
  name: string;
  mode?: JoinMode;
}

/** C→S：凭令牌恢复已断开的席位，并声明本地已确认的最后 tick。 */
export interface RejoinMessage {
  type: 'rejoin';
  roomId: string;
  token: string;
  lastTick: number;
}

/** C→S：上报某一逻辑 tick 的输入（通常为当前可见 tick + inputDelay）。 */
export interface InputMessage {
  type: 'input';
  tick: number;
  commands: Command[];
}

/** C→S：客户端本地 hash，供服务端对账。 */
export interface HashMessage {
  type: 'hash';
  tick: number;
  hash: number;
}

/** C→S：心跳。 */
export interface PingMessage {
  type: 'ping';
  t?: number;
}

export type ClientMessage =
  | JoinMessage
  | RejoinMessage
  | InputMessage
  | HashMessage
  | PingMessage;

/** 可展示给玩家的房间/重连错误码。 */
export type RoomErrorCode =
  | 'invalid_room'
  | 'room_full'
  | 'already_started'
  | 'rejoin_failed';

/** S→C：入座成功，带上种子、房间号与重连令牌。 */
export interface WelcomeMessage {
  type: 'welcome';
  seat: number;
  faction: Faction;
  seed: number;
  inputDelay: number;
  roomId: string;
  reconnectToken: string;
}

/** S→C：对局开始，告知首个逻辑 tick。 */
export interface StartMessage {
  type: 'start';
  startTick: number;
}

/** S→C：权威帧（含空帧，客户端靠它驱动）。 */
export interface FrameMessage {
  type: 'frame';
  tick: number;
  commands: Command[];
}

/** S→C：两端 hash 不一致。 */
export interface DesyncMessage {
  type: 'desync';
  tick: number;
  serverHash: number;
}

/** S→C：对手暂时断线，对局仍继续推进。 */
export interface PeerDisconnectedMessage {
  type: 'peerDisconnected';
}

/** S→C：对手已在重连窗口内恢复。 */
export interface PeerReconnectedMessage {
  type: 'peerReconnected';
}

/** S→C：对手离开（含重连超时）。 */
export interface PeerLeftMessage {
  type: 'peerLeft';
}

/** S→C：权威仿真已结算，客户端停止接受本局输入并展示结果。 */
export interface MatchEndMessage {
  type: 'matchEnd';
  endTick: number;
  winner: Faction | null;
  reason: MatchEndReason;
}

/** S→C：心跳回复。 */
export interface PongMessage {
  type: 'pong';
  t?: number;
}

/** S→C：入房/重连失败等可展示错误。 */
export interface ErrorMessage {
  type: 'error';
  code: RoomErrorCode;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | StartMessage
  | FrameMessage
  | DesyncMessage
  | PeerDisconnectedMessage
  | PeerReconnectedMessage
  | PeerLeftMessage
  | MatchEndMessage
  | PongMessage
  | ErrorMessage;

export type NetMessage = ClientMessage | ServerMessage;
