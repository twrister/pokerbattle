import { Faction, type MatchResult } from '@pb/sim';

export interface BattleResultHandle {
  show(result: MatchResult, playerFaction: Faction): void;
  hide(): void;
}

/** 展示本局权威结算，并将阵营结果转换为本地玩家视角。 */
export function createBattleResult(onReturnToMenu: () => void): BattleResultHandle {
  const root = requiredElement<HTMLElement>('#battle-result-dialog');
  const title = requiredElement<HTMLElement>('#battle-result-title');
  const detail = requiredElement<HTMLElement>('#battle-result-detail');
  const button = requiredElement<HTMLButtonElement>('#btn-battle-result-return');
  button.addEventListener('click', onReturnToMenu);

  return {
    show(result, playerFaction) {
      const outcome = result.winner === null ? '平局' : result.winner === playerFaction ? '胜利' : '失败';
      title.textContent = outcome;
      root.dataset.outcome = outcome;
      detail.textContent = resultDetail(result);
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
  };
}

function resultDetail(result: MatchResult): string {
  if (result.reason === 'base_destroyed') return '基地被摧毁，对局提前结束。';
  if (result.reason === 'simultaneous_destroyed') return '双方基地同时被摧毁。';
  return result.winner === null ? '加时赛结束，双方基地血量相同。' : '时间结束，基地血量更高的一方获胜。';
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
