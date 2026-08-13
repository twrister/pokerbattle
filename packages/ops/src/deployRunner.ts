import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { OpsDeployInfo } from './types.js';

export type DeployInfo = OpsDeployInfo;

export interface DeployRunnerOptions {
  /** 展示用命令名，如 pnpm deploy。 */
  commandLabel: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  spawnFn?: typeof spawn;
  /** 工作区不存在时 available=false。 */
  workspaceExists?: boolean;
  /** 生产环境把进度落到磁盘，避免重启运维站后丢失结果。 */
  statusFile?: string | null;
  /** 构建成功后再重启运维自身；须先把 lastOk 写入 statusFile。 */
  restartOpsAfterSuccess?: boolean;
  restartOpsFn?: () => void;
}

interface PersistedDeployStatus {
  running?: boolean;
  pid?: number;
  lastError?: string | null;
  lastFinishedAt?: number | null;
  lastOk?: boolean | null;
}

/**
 * 一次性执行发布命令：本机为 pnpm deploy，线上为工作区 apply-on-server。
 * 不停止当前游戏进程；线上脚本在构建结束后 restart 游戏，运维站由本类最后重启。
 */
export class DeployRunner {
  private readonly commandLabel: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly timeoutMs: number;
  private readonly spawnFn: typeof spawn;
  private readonly workspaceExists: boolean;
  private readonly statusFile: string | null;
  private readonly restartOpsAfterSuccess: boolean;
  private readonly restartOpsFn?: () => void;

  private running = false;
  private lastError: string | null = null;
  private lastFinishedAt: number | null = null;
  private lastOk: boolean | null = null;
  private inflight: Promise<{ ok: boolean; message: string }> | null = null;

  constructor(options: DeployRunnerOptions) {
    this.commandLabel = options.commandLabel;
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.env = options.env ?? {};
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.spawnFn = options.spawnFn ?? spawn;
    this.workspaceExists = options.workspaceExists ?? true;
    this.statusFile = options.statusFile ?? null;
    this.restartOpsAfterSuccess = Boolean(options.restartOpsAfterSuccess);
    this.restartOpsFn = options.restartOpsFn;
    this.hydrateFromFile();
  }

  getInfo(): DeployInfo {
    return {
      running: this.running,
      available: this.workspaceExists,
      command: this.commandLabel,
      lastError: this.lastError,
      lastFinishedAt: this.lastFinishedAt,
      lastOk: this.lastOk,
    };
  }

  /**
   * 立即返回并在后台执行。HTTP 接口用这个，避免发布把请求挂到超时。
   */
  start(): { ok: boolean; started: boolean; message: string } {
    if (!this.workspaceExists) {
      return {
        ok: false,
        started: false,
        message: '服务器工作区不存在，请先在开发机执行一次 pnpm deploy 以上传源码',
      };
    }
    if (this.running || this.inflight) {
      return { ok: false, started: false, message: '正在执行 pnpm deploy，请稍候' };
    }
    this.running = true;
    this.lastError = null;
    this.persist();
    this.inflight = this.execute().finally(() => {
      this.inflight = null;
    });
    return { ok: true, started: true, message: `已开始 ${this.commandLabel}` };
  }

  /** 测试或同步调用：等到发布结束。 */
  async run(): Promise<{ ok: boolean; message: string }> {
    if (this.inflight) return this.inflight;
    const started = this.start();
    if (!started.started) {
      return { ok: false, message: started.message };
    }
    return this.inflight ?? { ok: false, message: started.message };
  }

  private async execute(): Promise<{ ok: boolean; message: string }> {
    let output = '';
    try {
      const code = await this.spawnOnce((chunk) => {
        output += chunk;
        if (output.length > 8000) output = output.slice(-8000);
      });
      this.lastFinishedAt = Date.now();
      if (code !== 0) {
        this.lastOk = false;
        this.lastError = tailMessage(output, `${this.commandLabel} 失败（code=${code}）`);
        return { ok: false, message: this.lastError };
      }
      this.lastOk = true;
      this.lastError = null;
      const message = `${this.commandLabel} 已完成`;
      // 先落盘再重启运维，新进程才能读到成功结果
      this.running = false;
      this.persist();
      if (this.restartOpsAfterSuccess) {
        this.restartOpsFn?.();
      }
      return { ok: true, message };
    } catch (error) {
      this.lastFinishedAt = Date.now();
      this.lastOk = false;
      this.lastError = error instanceof Error ? error.message : `${this.commandLabel} 失败`;
      return { ok: false, message: this.lastError };
    } finally {
      this.running = false;
      this.persist();
    }
  }

  private spawnOnce(onChunk: (chunk: string) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env } as NodeJS.ProcessEnv,
        shell: true,
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${this.commandLabel} 超时（${Math.round(this.timeoutMs / 1000)}s）`));
      }, this.timeoutMs);

      child.stdout?.on('data', (buf: Buffer | string) => onChunk(String(buf)));
      child.stderr?.on('data', (buf: Buffer | string) => onChunk(String(buf)));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });
  }

  /** 从磁盘恢复上次发布结果；若标记 running 但 pid 已变，视为中断。 */
  private hydrateFromFile(): void {
    const saved = this.readStatusFile();
    if (!saved) return;
    this.lastError = saved.lastError ?? null;
    this.lastFinishedAt = saved.lastFinishedAt ?? null;
    this.lastOk = saved.lastOk ?? null;
    if (saved.running && saved.pid !== process.pid) {
      this.running = false;
      this.lastOk = false;
      this.lastError = this.lastError ?? '发布中断（运维进程已重启）';
      this.lastFinishedAt = this.lastFinishedAt ?? Date.now();
      this.persist();
    }
  }

  private persist(): void {
    if (!this.statusFile) return;
    const payload: PersistedDeployStatus = {
      running: this.running,
      pid: process.pid,
      lastError: this.lastError,
      lastFinishedAt: this.lastFinishedAt,
      lastOk: this.lastOk,
    };
    fs.mkdirSync(path.dirname(this.statusFile), { recursive: true });
    fs.writeFileSync(this.statusFile, `${JSON.stringify(payload)}\n`);
  }

  private readStatusFile(): PersistedDeployStatus | null {
    if (!this.statusFile) return null;
    try {
      return JSON.parse(fs.readFileSync(this.statusFile, 'utf8')) as PersistedDeployStatus;
    } catch {
      return null;
    }
  }
}

function tailMessage(output: string, fallback: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) || fallback;
}

/** 工作区根目录是否已同步源码（有 package.json）。 */
export function workspaceReady(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'package.json'));
}
