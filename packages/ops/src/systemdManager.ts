import { spawn } from 'node:child_process';
import { isPortOpen } from './processManager.js';
import type { ServiceController } from './serviceController.js';
import type { ManagedProcessInfo, ManagedProcessState } from './types.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

export interface SystemdManagerOptions {
  unit: string;
  /** 每次探测时解析游戏端口，便于游戏重新部署后 port 变化。 */
  resolvePort: () => number;
  host?: string;
  execFn?: ExecFn;
  isPortOpenFn?: (host: string, port: number) => Promise<boolean>;
  readyTimeoutMs?: number;
}

interface UnitSnapshot {
  activeState: string;
  subState: string;
  mainPid: number;
  startedAt: number | null;
}

/**
 * 线上用 systemctl 管游戏服，不 spawn pnpm。
 * dispose 为空操作，避免运维站退出时连带停掉正式服。
 */
export class SystemdManager implements ServiceController {
  readonly unit: string;

  private readonly resolvePort: () => number;
  private readonly host: string;
  private readonly execFn: ExecFn;
  private readonly isPortOpenFn: (host: string, port: number) => Promise<boolean>;
  private readonly readyTimeoutMs: number;

  private state: ManagedProcessState = 'stopped';
  private pid: number | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private externalConflict = false;

  constructor(options: SystemdManagerOptions) {
    this.unit = options.unit;
    this.resolvePort = options.resolvePort;
    this.host = options.host ?? '127.0.0.1';
    this.execFn = options.execFn ?? defaultExec;
    this.isPortOpenFn = options.isPortOpenFn ?? isPortOpen;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 8000;
  }

  getInfo(): ManagedProcessInfo {
    return {
      state: this.state,
      pid: this.pid,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : null,
      lastError: this.lastError,
      externalConflict: this.externalConflict,
    };
  }

  async isReachable(): Promise<boolean> {
    const port = this.resolvePort();
    if (port <= 0) return false;
    return this.isPortOpenFn(this.host, port);
  }

  async start(): Promise<{ ok: boolean; message: string }> {
    if (this.state === 'running' || this.state === 'starting') {
      return { ok: true, message: '游戏服务器已在运行或正在启动' };
    }
    if (this.state === 'stopping') {
      return { ok: false, message: '游戏服务器正在停止，请稍后再试' };
    }

    this.lastError = null;
    this.externalConflict = false;
    this.state = 'starting';
    const result = await this.execFn('systemctl', ['start', this.unit]);
    if (result.code !== 0) {
      this.state = 'error';
      this.lastError = result.stderr.trim() || `systemctl start 失败（code=${result.code}）`;
      return { ok: false, message: this.lastError };
    }

    const ready = await this.waitUntilPortOpen(this.readyTimeoutMs);
    await this.refreshFromPort();
    if (!ready && this.getInfo().state !== 'running') {
      this.state = 'starting';
      return { ok: true, message: '游戏服务器已发出启动指令，正在等待端口就绪' };
    }
    return { ok: true, message: '游戏服务器已启动' };
  }

  async stop(): Promise<{ ok: boolean; message: string }> {
    if (this.state === 'stopping') {
      return { ok: true, message: '游戏服务器正在停止' };
    }
    this.state = 'stopping';
    const result = await this.execFn('systemctl', ['stop', this.unit]);
    if (result.code !== 0) {
      this.state = 'error';
      this.lastError = result.stderr.trim() || `systemctl stop 失败（code=${result.code}）`;
      return { ok: false, message: this.lastError };
    }
    await this.refreshFromPort();
    this.state = 'stopped';
    this.pid = null;
    this.startedAt = null;
    this.externalConflict = false;
    return { ok: true, message: '游戏服务器已停止' };
  }

  async restart(): Promise<{ ok: boolean; message: string }> {
    this.state = 'starting';
    this.lastError = null;
    this.externalConflict = false;
    const result = await this.execFn('systemctl', ['restart', this.unit]);
    if (result.code !== 0) {
      this.state = 'error';
      this.lastError = result.stderr.trim() || `systemctl restart 失败（code=${result.code}）`;
      return { ok: false, message: this.lastError };
    }
    const ready = await this.waitUntilPortOpen(this.readyTimeoutMs);
    await this.refreshFromPort();
    if (!ready && this.getInfo().state !== 'running') {
      this.state = 'starting';
      return { ok: true, message: '游戏服务器已重启，正在等待端口就绪' };
    }
    return { ok: true, message: '游戏服务器已重启' };
  }

  /**
   * 与 unit 状态对齐：inactive 但端口仍在听 → 外部占用；
   * active/running 则视为本站托管。
   */
  async refreshFromPort(): Promise<void> {
    const snapshot = await this.readUnit();
    const port = this.resolvePort();
    const open = port > 0 ? await this.isPortOpenFn(this.host, port) : false;
    const managed =
      snapshot.activeState === 'active' || snapshot.activeState === 'activating';

    if (managed) {
      this.externalConflict = false;
      this.pid = snapshot.mainPid > 0 ? snapshot.mainPid : null;
      this.startedAt = snapshot.startedAt;
      if (snapshot.activeState === 'activating' || snapshot.subState === 'start') {
        this.state = 'starting';
      } else if (open || snapshot.subState === 'running') {
        this.state = 'running';
      } else {
        this.state = 'starting';
      }
      this.lastError = null;
      return;
    }

    this.pid = null;
    this.startedAt = null;
    if (snapshot.activeState === 'deactivating') {
      this.state = 'stopping';
      this.externalConflict = false;
      return;
    }
    if (snapshot.activeState === 'failed') {
      this.state = 'error';
      this.lastError = `systemd unit ${this.unit} 处于 failed`;
      this.externalConflict = open;
      return;
    }

    this.state = 'stopped';
    if (open) {
      this.externalConflict = true;
      this.lastError = '检测到游戏服可达，但 systemd unit 未处于 active';
      return;
    }
    this.externalConflict = false;
    this.lastError = null;
  }

  /** 运维站退出时不得停掉游戏服。 */
  async dispose(): Promise<void> {
    /* no-op */
  }

  private async readUnit(): Promise<UnitSnapshot> {
    const result = await this.execFn('systemctl', [
      'show',
      this.unit,
      '--property=ActiveState,SubState,MainPID,ExecMainStartTimestampUSec',
      '--no-pager',
    ]);
    if (result.code !== 0) {
      return { activeState: 'unknown', subState: 'unknown', mainPid: 0, startedAt: null };
    }
    return parseSystemdShow(result.stdout);
  }

  private async waitUntilPortOpen(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const port = this.resolvePort();
      if (port > 0 && (await this.isPortOpenFn(this.host, port))) return true;
      await sleep(200);
    }
    return false;
  }
}

/** 解析 systemctl show 的 KEY=VALUE 行。 */
export function parseSystemdShow(stdout: string): UnitSnapshot {
  const map: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    map[line.slice(0, idx)] = line.slice(idx + 1);
  }
  const usec = Number(map.ExecMainStartTimestampUSec ?? '0');
  return {
    activeState: map.ActiveState ?? 'unknown',
    subState: map.SubState ?? 'unknown',
    mainPid: Number(map.MainPID ?? '0') || 0,
    startedAt: usec > 0 ? Math.floor(usec / 1000) : null,
  };
}

function defaultExec(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
