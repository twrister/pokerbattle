import { type ChildProcess, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManagedProcessInfo, ManagedProcessState } from './types.js';

export interface ProcessManagerOptions {
  /** 服务标识，用于日志与 API 路由。 */
  id: string;
  /** 展示用名称，如「游戏服务器」「开发服」。 */
  label: string;
  /** 监听端口，用于冲突探测与就绪判断。 */
  port: number;
  host?: string;
  /** 传给 pnpm 的参数，例如 ['--filter','@pb/server','start']。 */
  pnpmArgs: string[];
  /** 启动时动态解析命令（例如正式服按是否已有 dist 选择 preview/official）。 */
  resolvePnpmArgs?: () => string[];
  /** 额外环境变量。 */
  env?: Record<string, string | undefined>;
  logPrefix?: string;
  /** 等待端口就绪的超时；正式服首次 build 可能较久。 */
  readyTimeoutMs?: number;
  resolveReadyTimeoutMs?: () => number;
  workspaceRoot?: string;
  spawnFn?: typeof spawn;
  isPortOpenFn?: (host: string, port: number) => Promise<boolean>;
}

/**
 * 托管单个 pnpm 子进程：启动/停止/重启，并识别端口被外部占用的冲突。
 * 运维站不把外部进程伪装成“本站管理”。
 */
export class ProcessManager {
  readonly id: string;
  readonly label: string;
  readonly port: number;

  private readonly host: string;
  private readonly pnpmArgs: string[];
  private readonly resolvePnpmArgs?: () => string[];
  private readonly env: Record<string, string | undefined>;
  private readonly logPrefix: string;
  private readonly readyTimeoutMs: number;
  private readonly resolveReadyTimeoutMs?: () => number;
  private readonly workspaceRoot: string;
  private readonly spawnFn: typeof spawn;
  private readonly isPortOpenFn: (host: string, port: number) => Promise<boolean>;

  private child: ChildProcess | null = null;
  private state: ManagedProcessState = 'stopped';
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private externalConflict = false;
  private stopWaiters: Array<(ok: boolean) => void> = [];

  constructor(options: ProcessManagerOptions) {
    this.id = options.id;
    this.label = options.label;
    this.port = options.port;
    this.host = options.host ?? '127.0.0.1';
    this.pnpmArgs = options.pnpmArgs;
    this.resolvePnpmArgs = options.resolvePnpmArgs;
    this.env = options.env ?? {};
    this.logPrefix = options.logPrefix ?? options.id;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 8000;
    this.resolveReadyTimeoutMs = options.resolveReadyTimeoutMs;
    this.workspaceRoot =
      options.workspaceRoot ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    this.spawnFn = options.spawnFn ?? spawn;
    this.isPortOpenFn = options.isPortOpenFn ?? isPortOpen;
  }

  /** 供仪表盘展示的进程摘要。 */
  getInfo(): ManagedProcessInfo {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : null,
      lastError: this.lastError,
      externalConflict: this.externalConflict,
    };
  }

  /** 探测本服务端口是否已有监听（含外部进程）。 */
  async isReachable(): Promise<boolean> {
    return this.isPortOpenFn(this.host, this.port);
  }

  /**
   * 启动服务；已在跑则直接成功，端口被外部占用则报冲突。
   */
  async start(): Promise<{ ok: boolean; message: string }> {
    if (this.state === 'running' || this.state === 'starting') {
      return { ok: true, message: `${this.label}已在运行或正在启动` };
    }
    if (this.state === 'stopping') {
      return { ok: false, message: `${this.label}正在停止，请稍后再试` };
    }

    const open = await this.isPortOpenFn(this.host, this.port);
    if (open) {
      this.externalConflict = true;
      this.state = 'error';
      this.lastError = `端口 ${this.port} 已被其他进程占用，无法由运维站托管启动`;
      return { ok: false, message: this.lastError };
    }

    this.externalConflict = false;
    this.lastError = null;
    this.state = 'starting';

    try {
      const pnpmArgs = this.resolvePnpmArgs?.() ?? this.pnpmArgs;
      const readyTimeoutMs = this.resolveReadyTimeoutMs?.() ?? this.readyTimeoutMs;
      const child = this.spawnFn(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        pnpmArgs,
        {
          cwd: this.workspaceRoot,
          env: {
            ...process.env,
            ...this.env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          // Windows 下用独立进程树，便于 taskkill /T 回收
          detached: process.platform !== 'win32',
          shell: process.platform === 'win32',
        },
      );
      this.child = child;
      this.startedAt = Date.now();

      child.stdout?.on('data', (chunk: Buffer | string) => {
        process.stdout.write(`[${this.logPrefix}] ${chunk}`);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        process.stderr.write(`[${this.logPrefix}:err] ${chunk}`);
      });

      child.on('exit', (code, signal) => {
        const unexpected = this.state === 'running' || this.state === 'starting';
        this.child = null;
        this.resolveStopWaiters(true);
        if (this.state === 'stopping') {
          this.state = 'stopped';
          this.startedAt = null;
          return;
        }
        if (unexpected) {
          this.state = 'error';
          this.lastError = `${this.label}异常退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`;
          this.startedAt = null;
          return;
        }
        this.state = 'stopped';
        this.startedAt = null;
      });

      child.on('error', (error) => {
        this.lastError = error.message;
        this.state = 'error';
        this.child = null;
        this.startedAt = null;
        this.resolveStopWaiters(false);
      });

      // 短暂等待端口就绪，便于按钮操作后立即轮询到 running
      const ready = await this.waitUntilPortOpen(readyTimeoutMs);
      if (!ready) {
        // 子进程可能仍在启动；不立刻杀掉，标记 starting 让前端继续轮询
        if (this.child && !this.child.killed) {
          this.state = 'starting';
          return { ok: true, message: `${this.label}已拉起，正在等待端口就绪` };
        }
        this.state = 'error';
        this.lastError = this.lastError ?? `${this.label}启动超时`;
        return { ok: false, message: this.lastError };
      }

      this.state = 'running';
      return { ok: true, message: `${this.label}已启动` };
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error.message : '启动失败';
      this.child = null;
      this.startedAt = null;
      return { ok: false, message: this.lastError };
    }
  }

  /** 停止本站托管的子进程；外部占用时不尝试强杀。 */
  async stop(): Promise<{ ok: boolean; message: string }> {
    if (this.externalConflict && !this.child) {
      return { ok: false, message: '检测到外部占用端口，运维站不会强制结束未知进程' };
    }
    if (!this.child) {
      this.state = 'stopped';
      this.startedAt = null;
      this.externalConflict = false;
      return { ok: true, message: `${this.label}已停止` };
    }
    if (this.state === 'stopping') {
      return { ok: true, message: `${this.label}正在停止` };
    }

    this.state = 'stopping';
    const child = this.child;
    const exited = new Promise<boolean>((resolve) => {
      this.stopWaiters.push(resolve);
      // 兜底超时，避免永远卡在 stopping
      setTimeout(() => resolve(false), 8000);
    });

    try {
      await terminateChild(child);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : '停止失败';
      this.state = 'error';
      return { ok: false, message: this.lastError };
    }

    const ok = await exited;
    if (!ok && this.child) {
      try {
        await forceKill(this.child);
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.state = 'stopped';
    this.startedAt = null;
    this.externalConflict = false;
    return { ok: true, message: `${this.label}已停止` };
  }

  /** 先停后启，保证运维站托管的是新进程。 */
  async restart(): Promise<{ ok: boolean; message: string }> {
    const stopped = await this.stop();
    if (!stopped.ok) return stopped;
    return this.start();
  }

  /** 运维站退出时清理子进程，避免孤儿进程残留。 */
  async dispose(): Promise<void> {
    await this.stop();
  }

  /** 在状态轮询时同步：若我们有 child 且端口已开，则升为 running。 */
  async refreshFromPort(): Promise<void> {
    if (this.state !== 'starting' && this.state !== 'running') return;
    const open = await this.isPortOpenFn(this.host, this.port);
    if (open && this.child && this.state === 'starting') {
      this.state = 'running';
    }
  }

  private async waitUntilPortOpen(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.child) return false;
      if (await this.isPortOpenFn(this.host, this.port)) return true;
      await sleep(200);
    }
    return false;
  }

  private resolveStopWaiters(ok: boolean): void {
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    for (const resolve of waiters) resolve(ok);
  }
}

/** 探测 TCP 端口是否已有监听方。 */
export function isPortOpen(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** 温和终止子进程：Unix 发 SIGTERM，Windows 用 taskkill 树杀。 */
async function terminateChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true,
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/** 强制结束仍存活的子进程。 */
async function forceKill(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await terminateChild(child);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
