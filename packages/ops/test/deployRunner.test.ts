import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployRunner, workspaceReady } from '../src/deployRunner.js';

class FakeChild extends EventEmitter {
  pid = 7788;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('close', 1));
    return true;
  }
}

describe('DeployRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('workspaceReady 检查 package.json', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-deploy-ws-'));
    try {
      expect(workspaceReady(dir)).toBe(false);
      await fs.promises.writeFile(path.join(dir, 'package.json'), '{}');
      expect(workspaceReady(dir)).toBe(true);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('工作区缺失时拒绝执行', async () => {
    const runner = new DeployRunner({
      commandLabel: 'pnpm deploy',
      command: 'pnpm',
      args: ['deploy'],
      cwd: '.',
      workspaceExists: false,
      spawnFn: vi.fn() as never,
    });
    const result = await runner.run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('工作区不存在');
    expect(runner.getInfo().available).toBe(false);
  });

  it('成功执行后 lastOk=true，并可在落盘后重启运维', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-deploy-ok-'));
    const statusFile = path.join(dir, 'last-deploy.json');
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child);
    const restartOpsFn = vi.fn();
    const runner = new DeployRunner({
      commandLabel: 'pnpm deploy',
      command: 'pnpm',
      args: ['deploy'],
      cwd: dir,
      spawnFn: spawnFn as never,
      statusFile,
      restartOpsAfterSuccess: true,
      restartOpsFn,
    });

    const started = runner.start();
    expect(started.started).toBe(true);
    expect(runner.getInfo().running).toBe(true);

    child.stderr.emit('data', 'building...\n');
    const resultPromise = runner.run();
    child.emit('close', 0);
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(runner.getInfo()).toMatchObject({ running: false, lastOk: true, lastError: null });
    expect(restartOpsFn).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await fs.promises.readFile(statusFile, 'utf8')) as { lastOk: boolean };
    expect(saved.lastOk).toBe(true);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('失败时保留 stderr 尾行，不重启运维', async () => {
    const child = new FakeChild();
    const restartOpsFn = vi.fn();
    const runner = new DeployRunner({
      commandLabel: 'pnpm deploy',
      command: 'pnpm',
      args: ['deploy'],
      cwd: '.',
      spawnFn: vi.fn(() => child) as never,
      restartOpsAfterSuccess: true,
      restartOpsFn,
    });

    const promise = runner.run();
    child.stderr.emit('data', 'esbuild failed\n');
    child.emit('close', 1);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('esbuild failed');
    expect(restartOpsFn).not.toHaveBeenCalled();
    expect(runner.getInfo().lastOk).toBe(false);
  });

  it('重复 start 会拒绝', async () => {
    const child = new FakeChild();
    const runner = new DeployRunner({
      commandLabel: 'pnpm deploy',
      command: 'pnpm',
      args: ['deploy'],
      cwd: '.',
      spawnFn: vi.fn(() => child) as never,
    });
    expect(runner.start().started).toBe(true);
    expect(runner.start().started).toBe(false);
    const done = runner.run();
    child.emit('close', 0);
    await done;
  });

  it('新进程读到他人 pid 的 running 标记时视为中断', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-deploy-stale-'));
    const statusFile = path.join(dir, 'last-deploy.json');
    await fs.promises.writeFile(
      statusFile,
      JSON.stringify({ running: true, pid: 1, lastOk: null, lastError: null, lastFinishedAt: null }),
    );
    const runner = new DeployRunner({
      commandLabel: 'pnpm deploy',
      command: 'pnpm',
      args: ['deploy'],
      cwd: dir,
      spawnFn: vi.fn() as never,
      statusFile,
    });
    expect(runner.getInfo().running).toBe(false);
    expect(runner.getInfo().lastOk).toBe(false);
    expect(runner.getInfo().lastError).toContain('中断');
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
