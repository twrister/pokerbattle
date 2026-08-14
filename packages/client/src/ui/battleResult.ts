import {
  Faction,
  opposingFaction,
  toFloat,
  type MatchResult,
  type MatchState,
} from '@pb/sim';

export interface BattleResultContext {
  localName: string;
  opponentName: string;
}

export interface BattleResultHandle {
  /** 写入双方显示名，结算时与残血一起展示。 */
  setContext(context: BattleResultContext): void;
  show(result: MatchResult, playerFaction: Faction, match?: MatchState): void;
  hide(): void;
}

/** 展示本局权威结算，并将阵营结果转换为本地玩家视角。 */
export function createBattleResult(onReturnToMenu: () => void): BattleResultHandle {
  const root = requiredElement<HTMLElement>('#battle-result-dialog');
  const title = requiredElement<HTMLElement>('#battle-result-title');
  const detail = requiredElement<HTMLElement>('#battle-result-detail');
  const selfCard = requiredElement<HTMLElement>('#battle-result-self');
  const oppCard = requiredElement<HTMLElement>('#battle-result-opp');
  const selfName = requiredElement<HTMLElement>('#battle-result-self-name');
  const oppName = requiredElement<HTMLElement>('#battle-result-opp-name');
  const selfHp = requiredElement<HTMLElement>('#battle-result-self-hp');
  const oppHp = requiredElement<HTMLElement>('#battle-result-opp-hp');
  const selfBar = requiredElement<HTMLElement>('#battle-result-self-bar');
  const oppBar = requiredElement<HTMLElement>('#battle-result-opp-bar');
  const button = requiredElement<HTMLButtonElement>('#btn-battle-result-return');
  button.addEventListener('click', onReturnToMenu);

  let context: BattleResultContext = {
    localName: '玩家',
    opponentName: '对手',
  };

  return {
    setContext(next) {
      context = {
        localName: next.localName || '玩家',
        opponentName: next.opponentName || '对手',
      };
    },
    show(result, playerFaction, match) {
      const outcome = result.winner === null ? '平局' : result.winner === playerFaction ? '胜利' : '失败';
      title.textContent = outcome;
      root.dataset.outcome = outcome;
      detail.textContent = resultDetail(result);
      fillSide(
        selfCard,
        selfName,
        selfHp,
        selfBar,
        context.localName,
        playerFaction,
        result,
        match,
      );
      fillSide(
        oppCard,
        oppName,
        oppHp,
        oppBar,
        context.opponentName,
        opposingFaction(playerFaction),
        result,
        match,
      );
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

/** 按本地视角填一侧名字、残血和胜负高亮。 */
function fillSide(
  card: HTMLElement,
  nameEl: HTMLElement,
  hpEl: HTMLElement,
  barEl: HTMLElement,
  name: string,
  faction: Faction,
  result: MatchResult,
  match?: MatchState,
): void {
  nameEl.textContent = name;
  const draw = result.winner === null;
  const won = result.winner === faction;
  card.classList.toggle('is-winner', won);
  card.classList.toggle('is-loser', !draw && !won);
  if (!match) {
    hpEl.textContent = '—';
    barEl.style.width = '0%';
    return;
  }
  const hp = toFloat(match.getCastleHp(faction));
  const maxHp = toFloat(match.getCastleMaxHp(faction));
  hpEl.textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
  barEl.style.width = `${maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0}%`;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
