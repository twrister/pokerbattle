// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardEntry, LeaderboardMessage } from '@pb/net';
import { createLeaderboardPage } from '../src/ui/leaderboardPage.js';

function mountLeaderboardDom(): void {
  document.body.innerHTML = `
    <main id="leaderboard" class="is-hidden">
      <button id="btn-leaderboard-back"></button>
      <button id="btn-leaderboard-refresh"></button>
      <div class="leaderboard-tabs" role="tablist">
        <button id="leaderboard-tab-score" class="leaderboard-tab is-active" role="tab" aria-selected="true"></button>
        <button id="leaderboard-tab-campaign" class="leaderboard-tab" role="tab" aria-selected="false"></button>
      </div>
      <div id="leaderboard-list"></div>
      <div id="leaderboard-status"></div>
    </main>
  `;
}

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    playerId: 'p1',
    displayName: '甲',
    score: 24,
    matches: 10,
    wins: 6,
    losses: 4,
    winRate: 0.6,
    campaignStars: 3,
    ...overrides,
  };
}

function board(overrides: Partial<LeaderboardMessage> = {}): LeaderboardMessage {
  return {
    type: 'leaderboard',
    entries: [entry()],
    self: entry(),
    campaignEntries: [entry()],
    campaignSelf: entry(),
    ...overrides,
  };
}

describe('排行榜页', () => {
  beforeEach(() => {
    mountLeaderboardDom();
  });

  it('渲染名次、积分、胜率，并高亮自己', async () => {
    const page = createLeaderboardPage({
      onBack: vi.fn(),
      loadLeaderboard: vi.fn(async () =>
        board({
          entries: [
            entry({ rank: 1, playerId: 'top', displayName: '冠军', score: 24, winRate: 0.62, matches: 8 }),
            entry({
              rank: 2,
              playerId: 'me',
              displayName: '我',
              score: 11,
              matches: 4,
              wins: 2,
              losses: 2,
              winRate: 0.5,
            }),
          ],
          self: entry({ rank: 2, playerId: 'me', displayName: '我', score: 11 }),
        }),
      ),
    });
    page.show();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.leaderboard-row')).toHaveLength(2);
    });

    const rows = Array.from(document.querySelectorAll('.leaderboard-row'));
    expect(rows[0]?.querySelector('.leaderboard-rank')?.textContent).toBe('1');
    expect(rows[0]?.querySelector('.leaderboard-name')?.textContent).toBe('冠军');
    expect(rows[0]?.querySelector('.leaderboard-stats')?.textContent).toBe('胜点 24 · 胜率 62%');
    expect(rows[0]?.classList.contains('is-self')).toBe(false);

    expect(rows[1]?.querySelector('.leaderboard-stats')?.textContent).toBe('胜点 11 · 胜率 50%');
    expect(rows[1]?.classList.contains('is-self')).toBe(true);
    page.dispose();
  });

  it('切到战役榜只重渲染不重发请求，按星数展示并高亮自己', async () => {
    const loadLeaderboard = vi.fn(async () =>
      board({
        entries: [entry({ rank: 1, playerId: 'score-top', displayName: '胜点王', score: 40 })],
        self: entry({ rank: 1, playerId: 'score-top', displayName: '胜点王', score: 40 }),
        campaignEntries: [
          entry({ rank: 1, playerId: 'star-top', displayName: '星星王', campaignStars: 12 }),
          entry({ rank: 2, playerId: 'me', displayName: '我', campaignStars: 4 }),
        ],
        campaignSelf: entry({ rank: 2, playerId: 'me', displayName: '我', campaignStars: 4 }),
      }),
    );
    const page = createLeaderboardPage({ onBack: vi.fn(), loadLeaderboard });
    page.show();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.leaderboard-row')).toHaveLength(1);
    });
    expect(loadLeaderboard).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLButtonElement>('#leaderboard-tab-campaign')!.click();
    const rows = Array.from(document.querySelectorAll('.leaderboard-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.leaderboard-name')?.textContent).toBe('星星王');
    expect(rows[0]?.querySelector('.leaderboard-stats')?.textContent).toBe('★ 12 星');
    expect(rows[1]?.querySelector('.leaderboard-stats')?.textContent).toBe('★ 4 星');
    expect(rows[1]?.classList.contains('is-self')).toBe(true);
    expect(document.querySelector('#leaderboard-tab-campaign')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('#leaderboard-tab-score')?.getAttribute('aria-selected')).toBe('false');
    // 页签切换复用同一份回包，不再请求
    expect(loadLeaderboard).toHaveBeenCalledTimes(1);
    page.dispose();
  });

  it('可直接打开战役榜页签，空榜给出引导文案', async () => {
    const page = createLeaderboardPage({
      onBack: vi.fn(),
      loadLeaderboard: vi.fn(async () => board({ entries: [], self: null, campaignEntries: [], campaignSelf: null })),
    });
    page.show('campaign');
    await vi.waitFor(() => {
      expect(document.querySelector('.leaderboard-empty')?.textContent).toBe('暂无战役排行，先打通一关吧');
    });
    expect(document.querySelector('#leaderboard-tab-campaign')?.classList.contains('is-active')).toBe(true);
    page.dispose();
  });

  it('无场次显示胜率 --，空榜提示暂无数据', async () => {
    const page = createLeaderboardPage({
      onBack: vi.fn(),
      loadLeaderboard: vi.fn(async () =>
        board({
          entries: [entry({ matches: 0, wins: 0, losses: 0, winRate: null, score: 0 })],
          self: null,
        }),
      ),
    });
    page.show();
    await vi.waitFor(() => {
      expect(document.querySelector('.leaderboard-stats')?.textContent).toBe('胜点 0 · 胜率 --');
    });
    page.dispose();

    mountLeaderboardDom();
    const emptyPage = createLeaderboardPage({
      onBack: vi.fn(),
      loadLeaderboard: vi.fn(async () => board({ entries: [], self: null })),
    });
    emptyPage.show();
    await vi.waitFor(() => {
      expect(document.querySelector('.leaderboard-empty')?.textContent).toBe('暂无排行数据');
    });
    emptyPage.dispose();
  });

  it('加载失败展示错误态', async () => {
    const page = createLeaderboardPage({
      onBack: vi.fn(),
      loadLeaderboard: vi.fn(async () => {
        throw new Error('无法连接联机服务');
      }),
    });
    page.show();
    await vi.waitFor(() => {
      expect(document.querySelector('.leaderboard-empty')?.textContent).toBe('无法连接联机服务');
    });
    expect(document.querySelector('#leaderboard-status')?.textContent).toBe('加载排行榜失败');
    page.dispose();
  });

  it('点击返回触发回调', () => {
    const onBack = vi.fn();
    const page = createLeaderboardPage({
      onBack,
      loadLeaderboard: vi.fn(async () => board({ entries: [], self: null })),
    });
    document.querySelector<HTMLButtonElement>('#btn-leaderboard-back')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    page.dispose();
  });
});
