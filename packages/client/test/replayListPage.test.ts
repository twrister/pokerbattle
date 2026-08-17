// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction } from '@pb/sim';
import { createArenaSignature } from '../src/replay/arenaSignature.js';
import type { ReplayRecord } from '../src/replay/types.js';
import { createReplayListPage } from '../src/ui/replayListPage.js';

function mountDom(): void {
  document.body.innerHTML = `
    <main id="replay-list" class="is-hidden">
      <button id="btn-replay-list-back"></button>
      <div id="replay-list-items"></div>
      <div id="replay-list-status"></div>
    </main>
  `;
}

function sampleRecord(overrides: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    schemaVersion: 1,
    id: 'r1',
    recordedAt: Date.UTC(2026, 7, 17, 2, 5),
    seed: 1,
    matchMode: '1v1',
    endTick: 20,
    result: { winner: Faction.Blue, reason: 'base_destroyed' },
    context: { localFaction: Faction.Blue, localName: '甲', opponentName: '乙' },
    frames: [],
    arenaSignature: createArenaSignature('1v1'),
    ...overrides,
  };
}

describe('回放列表页', () => {
  beforeEach(() => {
    mountDom();
  });

  it('空列表显示暂无对战记录', () => {
    const page = createReplayListPage({
      onBack: vi.fn(),
      onPlay: vi.fn(),
      listReplays: () => [],
    });
    page.show();
    expect(document.querySelector('.replay-list-empty')?.textContent).toBe('暂无对战记录');
    page.dispose();
  });

  it('渲染时间、对阵与胜负，点击进入回放', () => {
    const onPlay = vi.fn();
    const record = sampleRecord();
    const page = createReplayListPage({
      onBack: vi.fn(),
      onPlay,
      listReplays: () => [record],
    });
    page.show();
    const row = document.querySelector<HTMLButtonElement>('.replay-list-row');
    expect(row?.querySelector('.replay-list-title')?.textContent).toBe('1v1 · 甲 vs 乙');
    expect(row?.querySelector('.replay-list-meta')?.textContent).toBe('胜利 · 摧毁主堡');
    expect(row?.classList.contains('is-stale')).toBe(false);
    row?.click();
    expect(onPlay).toHaveBeenCalledWith(record);
    page.dispose();
  });

  it('场地指纹不匹配时标注场景已变更', () => {
    const page = createReplayListPage({
      onBack: vi.fn(),
      onPlay: vi.fn(),
      listReplays: () => [sampleRecord({ arenaSignature: 'old-layout' })],
    });
    page.show();
    const row = document.querySelector('.replay-list-row');
    expect(row?.classList.contains('is-stale')).toBe(true);
    expect(row?.querySelector('.replay-list-meta')?.textContent).toContain('场景已变更');
    page.dispose();
  });

  it('点击返回触发回调', () => {
    const onBack = vi.fn();
    const page = createReplayListPage({
      onBack,
      onPlay: vi.fn(),
      listReplays: () => [],
    });
    document.querySelector<HTMLButtonElement>('#btn-replay-list-back')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    page.dispose();
  });
});
