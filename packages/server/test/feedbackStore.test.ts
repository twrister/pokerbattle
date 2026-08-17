import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FEEDBACK_CONTENT_MAX_LENGTH,
  FEEDBACK_MAX_RECORDS,
  FEEDBACK_RATE_LIMIT_MS,
  FeedbackStore,
} from '../src/feedbackStore.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

function tempStore(now = () => 1_700_000_000_000): FeedbackStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-feedback-'));
  dirs.push(dir);
  return new FeedbackStore({
    filePath: path.join(dir, 'feedback.json'),
    now,
  });
}

function tempPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-feedback-'));
  dirs.push(dir);
  return path.join(dir, 'feedback.json');
}

describe('FeedbackStore', () => {
  it('写入后按时间倒序读出，并落盘', () => {
    let now = 1_700_000_000_000;
    const store = tempStore(() => now);
    const first = store.add({
      content: '  第一意见  ',
      playerId: 'player-a',
      displayName: '甲',
      appVersion: '0.1.5',
    });
    now += FEEDBACK_RATE_LIMIT_MS;
    const second = store.add({
      content: '第二意见',
      playerId: 'player-b',
      displayName: '乙',
      appVersion: '0.1.5',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(store.list().map((row) => row.content)).toEqual(['第二意见', '第一意见']);
    expect(store.list()[1]).toMatchObject({
      playerId: 'player-a',
      displayName: '甲',
      appVersion: '0.1.5',
    });
  });

  it('空正文或纯空白拒绝写入', () => {
    const store = tempStore();
    expect(store.add({ content: '' }).ok).toBe(false);
    expect(store.add({ content: '   \n' })).toMatchObject({ ok: false, reason: 'empty' });
    expect(store.add({ content: 12 })).toMatchObject({ ok: false, reason: 'empty' });
    expect(store.list()).toEqual([]);
  });

  it('超长正文截断到上限', () => {
    const store = tempStore();
    const result = store.add({
      content: '哈'.repeat(FEEDBACK_CONTENT_MAX_LENGTH + 20),
      playerId: 'player-a',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.content).toHaveLength(FEEDBACK_CONTENT_MAX_LENGTH);
    }
  });

  it('同一 playerId 在限频窗口内第二次提交失败', () => {
    let now = 1_700_000_000_000;
    const store = tempStore(() => now);
    expect(store.add({ content: '一次', playerId: 'player-a' }).ok).toBe(true);
    expect(store.add({ content: '二次', playerId: 'player-a' })).toMatchObject({
      ok: false,
      reason: 'too-fast',
    });
    now += FEEDBACK_RATE_LIMIT_MS - 1;
    expect(store.add({ content: '仍太快', playerId: 'player-a' })).toMatchObject({
      ok: false,
      reason: 'too-fast',
    });
    now += 1;
    expect(store.add({ content: '可以了', playerId: 'player-a' }).ok).toBe(true);
    expect(store.list()).toHaveLength(2);
  });

  it('不同 playerId 不受彼此限频影响', () => {
    const store = tempStore();
    expect(store.add({ content: '甲', playerId: 'player-a' }).ok).toBe(true);
    expect(store.add({ content: '乙', playerId: 'player-b' }).ok).toBe(true);
    expect(store.list()).toHaveLength(2);
  });

  it('超过总量上限时丢掉最旧的', () => {
    let now = 1_700_000_000_000;
    const store = tempStore(() => now);
    for (let i = 0; i < FEEDBACK_MAX_RECORDS + 3; i += 1) {
      const result = store.add({
        content: `意见 ${i}`,
        playerId: `player-${i}`,
      });
      expect(result.ok).toBe(true);
      now += FEEDBACK_RATE_LIMIT_MS;
    }
    const list = store.list();
    expect(list).toHaveLength(FEEDBACK_MAX_RECORDS);
    expect(list[list.length - 1]?.content).toBe('意见 3');
    expect(list[0]?.content).toBe(`意见 ${FEEDBACK_MAX_RECORDS + 2}`);
  });

  it('重启后从文件恢复已写入的意见', () => {
    const filePath = tempPath();
    let now = 1_700_000_000_000;
    const first = new FeedbackStore({ filePath, now: () => now });
    expect(
      first.add({
        content: '重启前',
        playerId: 'player-a',
        displayName: '甲',
        appVersion: '0.1.5',
      }).ok,
    ).toBe(true);

    const second = new FeedbackStore({ filePath, now: () => now + FEEDBACK_RATE_LIMIT_MS });
    expect(second.list()).toEqual([
      expect.objectContaining({
        content: '重启前',
        playerId: 'player-a',
        displayName: '甲',
        appVersion: '0.1.5',
      }),
    ]);
    expect(second.add({ content: '重启后', playerId: 'player-a' }).ok).toBe(true);
    expect(second.list().map((row) => row.content)).toEqual(['重启后', '重启前']);
  });
});
