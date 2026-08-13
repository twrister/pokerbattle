import type { ManagedProcessInfo } from './types.js';

/** 仪表盘对托管目标的最小接口：本机 pnpm 与线上 systemd 共用。 */
export interface ServiceController {
  start(): Promise<{ ok: boolean; message: string }>;
  stop(): Promise<{ ok: boolean; message: string }>;
  restart(): Promise<{ ok: boolean; message: string }>;
  getInfo(): ManagedProcessInfo;
  refreshFromPort(): Promise<void>;
  isReachable(): Promise<boolean>;
  dispose(): Promise<void>;
}
