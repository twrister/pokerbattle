import type { LeaderboardEntry, LeaderboardMessage } from '@pb/net';

export interface LeaderboardPageOptions {
  onBack: () => void;
  loadLeaderboard: () => Promise<LeaderboardMessage>;
}

export interface LeaderboardPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 积分排行榜：按服务端权威分排序，右侧展示胜率。 */
export function createLeaderboardPage(options: LeaderboardPageOptions): LeaderboardPageHandle {
  const root = required<HTMLElement>('#leaderboard');
  const backButton = required<HTMLButtonElement>('#btn-leaderboard-back', root);
  const refreshButton = required<HTMLButtonElement>('#btn-leaderboard-refresh', root);
  const list = required<HTMLElement>('#leaderboard-list', root);
  const status = required<HTMLElement>('#leaderboard-status', root);

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

  const renderBoard = (board: LeaderboardMessage): void => {
    list.replaceChildren();
    if (board.entries.length === 0) {
      renderEmpty('暂无排行数据');
      return;
    }

    const selfId = board.self?.playerId ?? '';
    for (const entry of board.entries) {
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
      stats.textContent = formatEntryStats(entry);

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
        renderBoard(board);
      })
      .catch((error: unknown) => {
        if (requestId !== listRequestId) return;
        renderEmpty(error instanceof Error ? error.message : '加载排行榜失败');
        showStatus('加载排行榜失败');
      });
  };

  backButton.addEventListener('click', options.onBack);
  refreshButton.addEventListener('click', refreshBoard);

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      clearStatus();
      refreshBoard();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      backButton.removeEventListener('click', options.onBack);
      refreshButton.removeEventListener('click', refreshBoard);
    },
  };
}

/** 积分后跟胜率；无场次时胜率显示为 --。 */
function formatEntryStats(entry: LeaderboardEntry): string {
  const rate =
    entry.matches > 0 && entry.winRate != null ? `${Math.round(entry.winRate * 100)}%` : '--';
  return `胜点 ${entry.score} · 胜率 ${rate}`;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`排行榜缺少元素：${selector}`);
  return element;
}
