import { describe, expect, it, vi } from 'vitest';
import { parseSystemdShow, SystemdManager } from '../src/systemdManager.js';

describe('parseSystemdShow', () => {
  it('maps active running unit', () => {
    const snap = parseSystemdShow(
      [
        'ActiveState=active',
        'SubState=running',
        'MainPID=4242',
        'ExecMainStartTimestampUSec=1700000000000000',
      ].join('\n'),
    );
    expect(snap).toEqual({
      activeState: 'active',
      subState: 'running',
      mainPid: 4242,
      startedAt: 1700000000000,
    });
  });
});

describe('SystemdManager', () => {
  it('start 调用 systemctl start 并在端口就绪后标记 running', async () => {
    const execFn = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'start') return { code: 0, stdout: '', stderr: '' };
      return {
        code: 0,
        stdout: 'ActiveState=active\nSubState=running\nMainPID=9\nExecMainStartTimestampUSec=1000000\n',
        stderr: '',
      };
    });
    const manager = new SystemdManager({
      unit: 'poker-battle',
      resolvePort: () => 3001,
      execFn,
      isPortOpenFn: async () => true,
    });
    const result = await manager.start();
    expect(result.ok).toBe(true);
    expect(execFn).toHaveBeenCalledWith('systemctl', ['start', 'poker-battle']);
    expect(manager.getInfo()).toMatchObject({ state: 'running', pid: 9, externalConflict: false });
  });

  it('unit inactive 但端口仍开时标记外部占用', async () => {
    const manager = new SystemdManager({
      unit: 'poker-battle',
      resolvePort: () => 3001,
      execFn: async () => ({
        code: 0,
        stdout: 'ActiveState=inactive\nSubState=dead\nMainPID=0\nExecMainStartTimestampUSec=0\n',
        stderr: '',
      }),
      isPortOpenFn: async () => true,
    });
    await manager.refreshFromPort();
    expect(manager.getInfo()).toMatchObject({
      state: 'stopped',
      externalConflict: true,
      pid: null,
    });
  });

  it('dispose 不调用 systemctl stop', async () => {
    const execFn = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const manager = new SystemdManager({
      unit: 'poker-battle',
      resolvePort: () => 3001,
      execFn,
      isPortOpenFn: async () => false,
    });
    await manager.dispose();
    expect(execFn).not.toHaveBeenCalled();
  });
});
