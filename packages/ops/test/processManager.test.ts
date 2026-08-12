import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/processManager.js';

class FakeChild extends EventEmitter {
  pid = 4321;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0, null));
    return true;
  }
}

function createManager(
  overrides: Partial<ConstructorParameters<typeof ProcessManager>[0]> = {},
): ProcessManager {
  return new ProcessManager({
    id: 'game',
    label: '游戏服务器',
    port: 9090,
    pnpmArgs: ['--filter', '@pb/server', 'start'],
    ...overrides,
  });
}

describe('ProcessManager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('端口被外部占用时报告冲突，不拉起子进程', async () => {
    const spawnFn = vi.fn();
    const manager = createManager({
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => true,
    });

    const result = await manager.start();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('占用');
    expect(spawnFn).not.toHaveBeenCalled();
    expect(manager.getInfo()).toMatchObject({
      state: 'error',
      externalConflict: true,
      pid: null,
    });
  });

  it('可启动并在 exit 后回到 stopped；重复启动直接成功', async () => {
    let open = false;
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child);
    const manager = createManager({
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => open,
    });

    const startPromise = manager.start();
    // 模拟子进程稍后开始监听端口
    open = true;
    const started = await startPromise;
    expect(started.ok).toBe(true);
    expect(manager.getInfo().state).toBe('running');
    expect(manager.getInfo().pid).toBe(4321);

    const again = await manager.start();
    expect(again.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    child.emit('exit', 1, null);
    expect(manager.getInfo().state).toBe('error');
    expect(manager.getInfo().lastError).toContain('异常退出');
  });

  it('stop 会结束托管进程；无进程时视为已停止', async () => {
    let open = false;
    const child = new FakeChild();
    const manager = createManager({
      spawnFn: (() => child) as never,
      isPortOpenFn: async () => open,
    });

    // Windows 路径会调用 taskkill；这里用 stub 直接触发 exit
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (pid === -child.pid || pid === child.pid) {
        child.emit('exit', 0, 'SIGTERM');
      }
      return true;
    }) as typeof process.kill);

    const startPromise = manager.start();
    open = true;
    await startPromise;

    const stopped = await manager.stop();
    expect(stopped.ok).toBe(true);
    expect(manager.getInfo().state).toBe('stopped');
    expect(manager.getInfo().pid).toBeNull();
    expect(killSpy).toHaveBeenCalled();

    const again = await manager.stop();
    expect(again.ok).toBe(true);
  });

  it('restart 先停后启', async () => {
    let open = false;
    /** 仅在本站托管进程存活时视为端口已开，避免 stop 后被误判为外部占用。 */
    let managedAlive = false;
    let child = new FakeChild();
    const spawnFn = vi.fn(() => {
      child = new FakeChild();
      child.pid = 2000 + spawnFn.mock.calls.length;
      managedAlive = true;
      child.on('exit', () => {
        managedAlive = false;
        open = false;
      });
      return child;
    });
    const manager = createManager({
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => open || managedAlive,
    });
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'kill').mockImplementation((() => {
      child.emit('exit', 0, 'SIGTERM');
      return true;
    }) as typeof process.kill);

    const started = await manager.start();
    expect(started.ok).toBe(true);
    open = true;

    const restarted = await manager.restart();
    expect(restarted.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(manager.getInfo().state).toBe('running');
  });

  it('启动时使用 resolvePnpmArgs 动态命令', async () => {
    let open = false;
    const child = new FakeChild();
    const calls: unknown[][] = [];
    const spawnFn = vi.fn((...args: unknown[]) => {
      calls.push(args);
      return child;
    });
    const manager = createManager({
      pnpmArgs: ['preview'],
      resolvePnpmArgs: () => ['official'],
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => open,
    });

    const startPromise = manager.start();
    open = true;
    await startPromise;
    expect(calls[0]?.[1]).toEqual(['official']);
  });

  it('轮询时识别外部占用，端口关闭后清除标记', async () => {
    let open = true;
    const manager = createManager({
      spawnFn: vi.fn() as never,
      isPortOpenFn: async () => open,
    });

    await manager.refreshFromPort();
    expect(manager.getInfo()).toMatchObject({
      state: 'stopped',
      externalConflict: true,
      pid: null,
    });

    open = false;
    await manager.refreshFromPort();
    expect(manager.getInfo()).toMatchObject({
      state: 'stopped',
      externalConflict: false,
    });
  });

  it('redeploy 在外部占用时拒绝', async () => {
    const spawnFn = vi.fn();
    const manager = createManager({
      id: 'clientOfficial',
      label: '正式服',
      port: 9080,
      pnpmArgs: ['preview'],
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => true,
    });

    const result = await manager.redeploy({ buildPnpmArgs: ['build'] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('占用');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('redeploy 构建失败时不启动 preview', async () => {
    const buildChild = new FakeChild();
    const spawnFn = vi.fn(() => buildChild);
    const manager = createManager({
      id: 'clientOfficial',
      label: '正式服',
      port: 9080,
      pnpmArgs: ['preview'],
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => false,
    });

    const promise = manager.redeploy({ buildPnpmArgs: ['build'] });
    queueMicrotask(() => buildChild.emit('exit', 1, null));
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('构建失败');
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(manager.getInfo().state).toBe('error');
  });

  it('redeploy 构建成功后启动 preview', async () => {
    let open = false;
    let call = 0;
    let current = new FakeChild();
    const spawnFn = vi.fn(() => {
      call += 1;
      current = new FakeChild();
      current.pid = 1000 + call;
      if (call === 1) {
        queueMicrotask(() => current.emit('exit', 0, null));
      } else {
        queueMicrotask(() => {
          open = true;
        });
      }
      return current;
    });
    const manager = createManager({
      id: 'clientOfficial',
      label: '正式服',
      port: 9080,
      pnpmArgs: ['--filter', '@pb/client', 'preview'],
      spawnFn: spawnFn as never,
      isPortOpenFn: async () => open,
    });

    const result = await manager.redeploy({
      buildPnpmArgs: ['--filter', '@pb/client', 'build'],
    });
    expect(result.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    const firstArgs = spawnFn.mock.calls[0] as unknown as [string, string[]];
    const secondArgs = spawnFn.mock.calls[1] as unknown as [string, string[]];
    expect(firstArgs[1]).toEqual(['--filter', '@pb/client', 'build']);
    expect(secondArgs[1]).toEqual(['--filter', '@pb/client', 'preview']);
    expect(manager.getInfo().state).toBe('running');
  });
});
