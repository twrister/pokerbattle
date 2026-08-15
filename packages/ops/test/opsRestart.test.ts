import { describe, expect, it } from 'vitest';
import { planOpsRestart } from '../src/opsRestart.js';

describe('planOpsRestart', () => {
  it('线上走 systemd 重启运维单元', () => {
    expect(
      planOpsRestart({
        production: true,
        systemdUnit: 'poker-battle-ops',
      }),
    ).toEqual({
      kind: 'systemd',
      command: 'systemctl',
      args: ['restart', 'poker-battle-ops'],
    });
  });

  it('本机 pnpm ops 拉起新的 start 进程', () => {
    expect(
      planOpsRestart({
        production: false,
        workspaceRoot: '/repo',
        lifecycleEvent: 'start',
        platform: 'linux',
      }),
    ).toEqual({
      kind: 'local-pnpm',
      command: 'pnpm',
      args: ['--filter', '@pb/ops', 'start'],
      cwd: '/repo',
    });
  });

  it('tsx watch 开发模式只退出，交给 watch 拉起', () => {
    expect(
      planOpsRestart({
        production: false,
        workspaceRoot: '/repo',
        lifecycleEvent: 'dev',
      }),
    ).toEqual({ kind: 'exit-for-watch' });
  });
});
