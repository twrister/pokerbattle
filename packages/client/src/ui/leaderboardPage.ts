import type { LeaderboardEntry, LeaderboardMessage } from '@pb/net';

/** 排行榜页签：胜点榜按联机积分，战役榜按战役星数。 */
export type LeaderboardTab = 'score' | 'campaign';

export interface LeaderboardPageOptions {
  onBack: () => void;
  loadLeaderboard: () => Promise<LeaderboardMessage>;
}

export interface LeaderboardPageHandle {
  show(tab?: LeaderboardTab): void;
  hide(): void;
  dispose(): void;
}

/** 当前页签与最近一次回包：切页签只重渲染，不再发请求。 */
interface BoardState {
  tab: LeaderboardTab;
  board: LeaderboardMessage | null;
  /** 上次加载失败原因；board 为空时优先展示它而不是「加载中」。 */
  error: string | null;
}

/**
 * 排行榜页：胜点榜 / 战役榜双页签。
 * 一次请求同时拿回两张榜，切页签立即重排，刷新按钮才走网络。
 */
export function createLeaderboardPage(options: LeaderboardPageOptions): LeaderboardPageHandle {
  const root = required<HTMLElement>('#leaderboard');
  const backButton = required<HTMLButtonElement>('#btn-leaderboard-back', root);
  const refreshButton = required<HTMLButtonElement>('#btn-leaderboard-refresh', root);
  const list = required<HTMLElement>('#leaderboard-list', root);
  const status = required<HTMLElement>('#leaderboard-status', root);
  const scoreTab = required<HTMLButtonElement>('#leaderboard-tab-score', root);
  const campaignTab = required<HTMLButtonElement>('#leaderboard-tab-campaign', root);
  const tabs: ReadonlyArray<{ id: LeaderboardTab; tab: HTMLButtonElement }> = [
    { id: 'score', tab: scoreTab },
    { id: 'campaign', tab: campaignTab },
  ];

  const state: BoardState = { tab: 'score', board: null, error: null };
  let listRequestId = 0;

  const clearStatus = (): void => {
    status.textContent = '';
    status.classList.remove('is-visible');
  };

  const showStatus = (message: string): void => {
    status.textContent = message;
    status.classList.toggle('is-visible', Boolean(message));
  };

  const renderEmpty = (message: string): void => {
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'leaderboard-empty';
    empty.textContent = message;
    list.append(empty);
  };

  /** 当前页签对应的榜单数据与查询者本人；老服务端缺战役榜时按空榜处理。 */
  const currentBoard = (): { entries: LeaderboardEntry[]; self: LeaderboardEntry | null } => {
    const board = state.board;
    if (!board) return { entries: [], self: null };
    if (state.tab === 'campaign') {
      return { entries: board.campaignEntries ?? [], self: board.campaignSelf ?? null };
    }
    return { entries: board.entries, self: board.self };
  };

  const renderBoard = (): void => {
    clearStatus();
    const isCampaign = state.tab === 'campaign';
    for (const item of tabs) {
      const active = item.id === state.tab;
      item.tab.classList.toggle('is-active', active);
      item.tab.setAttribute('aria-selected', String(active));
    }

    if (!state.board) {
      renderEmpty(state.error ?? '加载中…');
      return;
    }

    const { entries, self } = currentBoard();
    if (entries.length === 0) {
      renderEmpty(isCampaign ? '暂无战役排行，先打通一关吧' : '暂无排行数据');
      return;
    }

    list.replaceChildren();
    const selfId = self?.playerId ?? '';
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      if (selfId && entry.playerId === selfId) row.classList.add('is-self');
      row.setAttribute('role', 'listitem');

      const rank = document.createElement('div');
      rank.className = 'leaderboard-rank';
      rank.textContent = String(entry.rank);

      const name = document.createElement('div');
      name.className = 'leaderboard-name';
      name.textContent = entry.displayName;

      const stats = document.createElement('div');
      stats.className = 'leaderboard-stats';
      stats.textContent = isCampaign ? formatCampaignStats(entry) : formatEntryStats(entry);

      row.append(rank, name, stats);
      list.append(row);
    }
  };

  const refreshBoard = (): void => {
    const requestId = ++listRequestId;
    if (list.childElementCount === 0) {
      renderEmpty('加载中…');
    }
    clearStatus();

    void options
      .loadLeaderboard()
      .then((board) => {
        if (requestId !== listRequestId) return;
        state.board = board;
        state.error = null;
        renderBoard();
      })
      .catch((error: unknown) => {
        if (requestId !== listRequestId) return;
        const message = error instanceof Error ? error.message : '加载排行榜失败';
        state.board = null;
        state.error = message;
        renderEmpty(message);
        showStatus('加载排行榜失败');
      });
  };

  /** 切换页签：已有回包就地重渲染，没有则在 currentBoard 里显示加载中。 */
  const setTab = (tab: LeaderboardTab): void => {
    if (state.tab === tab) return;
    state.tab = tab;
    renderBoard();
  };

  const onScoreTab = (): void => setTab('score');
  const onCampaignTab = (): void => setTab('campaign');

  backButton.addEventListener('click', options.onBack);
  refreshButton.addEventListener('click', refreshBoard);
  scoreTab.addEventListener('click', onScoreTab);
  campaignTab.addEventListener('click', onCampaignTab);

  return {
    show(tab?: LeaderboardTab) {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      state.tab = tab ?? 'score';
      // 丢弃上次回包：星数/积分可能已变，等本次刷新后再渲染
      state.board = null;
      state.error = null;
      clearStatus();
      renderBoard();
      refreshBoard();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      backButton.removeEventListener('click', options.onBack);
      refreshButton.removeEventListener('click', refreshBoard);
      scoreTab.removeEventListener('click', onScoreTab);
      campaignTab.removeEventListener('click', onCampaignTab);
    },
  };
}

/** 胜点榜一行：积分后跟胜率；无场次时胜率显示为 --。 */
function formatEntryStats(entry: LeaderboardEntry): string {
  const rate =
    entry.matches > 0 && entry.winRate != null ? `${Math.round(entry.winRate * 100)}%` : '--';
  return `胜点 ${entry.score} · 胜率 ${rate}`;
}

/** 战役榜一行：只比星数，老服务端缺字段时按 0 星展示。 */
function formatCampaignStats(entry: LeaderboardEntry): string {
  return `★ ${Math.max(0, Math.floor(entry.campaignStars ?? 0))} 星`;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`排行榜缺少元素：${selector}`);
  return element;
}
