import { spawn, spawnSync } from 'node:child_process';

export type OpsRestartKind = 'systemd' | 'local-pnpm' | 'exit-for-watch';

export interface OpsRestartPlan {
  kind: OpsRestartKind;
  command?: string;
  args?: string[];
  cwd?: string;
}

export interface PlanOpsRestartOptions {
  production: boolean;
  workspaceRoot?: string;
  systemdUnit?: string;
  /** pnpm 脚本名：dev 表示 tsx watch，退出即可由 watch 拉起。 */
  lifecycleEvent?: string;
  platform?: NodeJS.Platform;
}

/** 按运行环境决定怎么重启运维进程，避免本机和线上两套逻辑散落。 */
export function planOpsRestart(options: PlanOpsRestartOptions): OpsRestartPlan {
  if (options.production) {
    return {
      kind: 'systemd',
      command: 'systemctl',
      args: ['restart', options.systemdUnit || 'poker-battle-ops'],
    };
  }
  if (options.lifecycleEvent === 'dev') {
    return { kind: 'exit-for-watch' };
  }
  const platform = options.platform ?? process.platform;
  return {
    kind: 'local-pnpm',
    command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['--filter', '@pb/ops', 'start'],
    cwd: options.workspaceRoot,
  };
}

/** 执行重启计划；调用方须先释放 9091。systemd 会结束当前进程。 */
export function executeOpsRestart(plan: OpsRestartPlan): { ok: boolean; message: string } {
  if (plan.kind === 'exit-for-watch') {
    return { ok: true, message: '已退出，等待 tsx watch 拉起' };
  }
  if (plan.kind === 'systemd') {
    const result = spawnSync(plan.command ?? 'systemctl', plan.args ?? ['restart'], {
      stdio: 'inherit',
      shell: true,
    });
    if ((result.status ?? 1) !== 0) {
      return { ok: false, message: 'systemctl restart 运维站失败' };
    }
    return { ok: true, message: '已请求 systemd 重启运维站' };
  }
  const child = spawn(plan.command ?? 'pnpm', plan.args ?? [], {
    cwd: plan.cwd,
    env: process.env,
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.unref();
  if (child.pid == null) {
    return { ok: false, message: '拉起新的 pnpm ops 失败' };
  }
  return { ok: true, message: '已拉起新的 pnpm ops' };
}
