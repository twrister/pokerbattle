import type { Command, Faction } from '@pb/sim';

/** 默认输入延迟（tick），约 200ms @ 20Hz。 */
export const DEFAULT_INPUT_DELAY = 4;
/** 每隔多少 tick 对一次 hash。 */
export const HASH_INTERVAL_TICKS = 20;

/** C→S：加入房间。 */
export interface JoinMessage {
  type: 'join';
  roomId: string;
  name: string;
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

export type ClientMessage = JoinMessage | InputMessage | HashMessage | PingMessage;

/** S→C：入座成功，带上种子与输入延迟。 */
export interface WelcomeMessage {
  type: 'welcome';
  seat: number;
  faction: Faction;
  seed: number;
  inputDelay: number;
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

/** S→C：对手离开。 */
export interface PeerLeftMessage {
  type: 'peerLeft';
}

/** S→C：心跳回复。 */
export interface PongMessage {
  type: 'pong';
  t?: number;
}

export type ServerMessage =
  | WelcomeMessage
  | StartMessage
  | FrameMessage
  | DesyncMessage
  | PeerLeftMessage
  | PongMessage;

export type NetMessage = ClientMessage | ServerMessage;
