import type { Command, Faction, MatchEndReason } from '@pb/sim';

/** 默认输入延迟（tick），约 200ms @ 20Hz。 */
export const DEFAULT_INPUT_DELAY = 4;
/** 每隔多少 tick 对一次 hash。 */
export const HASH_INTERVAL_TICKS = 20;
/** 对局中断线后保留席位的毫秒数；超时才判对手离开。 */
export const RECONNECT_TIMEOUT_MS = 30_000;
/** 对局中双方均离线超过该时长则直接关房，避免空转占坑。 */
export const BOTH_OFFLINE_CLOSE_MS = 3_000;
/** 房号为三位数字，前后端共用同一校验。 */
export const ROOM_ID_PATTERN = /^\d{3}$/;
/** 房间名最大长度（字符）。 */
export const ROOM_NAME_MAX_LENGTH = 24;

/** 规范化并校验房号；非法时返回 null。 */
export function normalizeRoomId(raw: string): string | null {
  const id = raw.trim();
  if (!ROOM_ID_PATTERN.test(id)) return null;
  return id;
}

/** 规范化房间名；空串返回 null，超长则裁剪。 */
export function normalizeRoomName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  return name.slice(0, ROOM_NAME_MAX_LENGTH);
}

/** 加入方式：快速匹配 / 加入已有房 / 创建新房。 */
export type JoinMode = 'quick' | 'room' | 'create';

/** 可加入房间的列表摘要。 */
export interface RoomListEntry {
  roomId: string;
  roomName: string;
  playerCount: number;
  maxPlayers: number;
}

/** C→S：加入房间。 */
export interface JoinMessage {
  type: 'join';
  /** quick/create 时可为空；room 模式必须是合法房号。 */
  roomId: string;
  name: string;
  /** 客户端设备档案 ID；缺省则服务端不记该席战绩。 */
  playerId?: string;
  mode?: JoinMode;
  /** create 时可带；空则由服务端按玩家名生成默认房间名。 */
  roomName?: string;
}

/** C→S：凭令牌恢复已断开的席位，并声明本地已确认的最后 tick。 */
export interface RejoinMessage {
  type: 'rejoin';
  roomId: string;
  token: string;
  lastTick: number;
}

/** C→S：查询当前可加入房间列表（不占用 join 握手）。 */
export interface ListRoomsMessage {
  type: 'listRooms';
}

/** 未入联机房时的页面活动，供运维站区分大厅与单机。 */
export type LobbyActivity = 'lobby' | 'solo';

/** C→S：登记大厅 presence（停在主菜单、尚未入房）。 */
export interface LobbyMessage {
  type: 'lobby';
  /** 展示名，供运维站列出大厅在线玩家。 */
  name?: string;
  /** 设备档案 ID；缺省则运维站仍能看到连接，但不挂战绩。 */
  playerId?: string;
  /** 缺省视为大厅，兼容旧客户端。 */
  activity?: LobbyActivity;
}

/** 清洗大厅活动；未知值回退大厅，避免坏包污染运维表。 */
export function normalizeLobbyActivity(raw: unknown): LobbyActivity {
  return raw === 'solo' ? 'solo' : 'lobby';
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

/** C→S：房主请求开局；仅 waiting 且双方已准备时生效。 */
export interface StartMatchMessage {
  type: 'startMatch';
}

/** C→S：非房主切换准备；房主始终准备，取消会被拒绝。 */
export interface SetReadyMessage {
  type: 'setReady';
  ready: boolean;
}

export type ClientMessage =
  | JoinMessage
  | RejoinMessage
  | ListRoomsMessage
  | LobbyMessage
  | StartMatchMessage
  | SetReadyMessage
  | InputMessage
  | HashMessage
  | PingMessage;

/** 房间阶段：等待开局 / 对局中。结算后立刻回到 waiting。 */
export type RoomPhase = 'waiting' | 'playing';

/** 房间成员摘要，供房间页展示准备与房主。 */
export interface RoomMember {
  seat: number;
  name: string;
  ready: boolean;
  isHost: boolean;
}

/** 可展示给玩家的房间/重连错误码。 */
export type RoomErrorCode =
  | 'invalid_room'
  | 'room_full'
  | 'already_started'
  | 'rejoin_failed'
  | 'not_host'
  | 'not_ready'
  | 'is_host';

/** S→C：入座成功，带上种子、房间号与重连令牌。 */
export interface WelcomeMessage {
  type: 'welcome';
  seat: number;
  faction: Faction;
  seed: number;
  inputDelay: number;
  roomId: string;
  roomName: string;
  reconnectToken: string;
  /** 对手席位显示名；尚未入座时为空串。 */
  opponentName: string;
}

/** S→C：可加入房间列表。 */
export interface RoomListMessage {
  type: 'roomList';
  rooms: RoomListEntry[];
}

/** S→C：房间成员与阶段快照，入座/离座/回房后都会广播。 */
export interface RoomStateMessage {
  type: 'roomState';
  roomId: string;
  roomName: string;
  hostSeat: number;
  phase: RoomPhase;
  members: RoomMember[];
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
  | RoomListMessage
  | RoomStateMessage
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
