import { Faction, opposingFaction, TICK_RATE, toFloat, type MatchState } from '@pb/sim';
import { matchPhaseLabel } from './matchPhaseLabel.js';

export interface BattleHudContext {
  localFaction: Faction;
  localName: string;
  opponentName: string;
}

export interface BattleHudHandle {
  show(): void;
  hide(): void;
  setContext(context: BattleHudContext): void;
  update(match: MatchState): void;
}

/** 将共享仿真状态投射到顶部信息条；左右始终是「己方蓝 / 对阵红」。 */
export function createBattleHud(): BattleHudHandle {
  const root = requiredElement<HTMLElement>('#battle-hud');
  const selfName = requiredElement<HTMLElement>('#battle-self-name');
  const oppName = requiredElement<HTMLElement>('#battle-opp-name');
  const selfHp = requiredElement<HTMLElement>('#battle-self-hp');
  const oppHp = requiredElement<HTMLElement>('#battle-opp-hp');
  const selfBar = requiredElement<HTMLElement>('#battle-self-bar');
  const oppBar = requiredElement<HTMLElement>('#battle-opp-bar');
  const phaseLabel = requiredElement<HTMLElement>('#battle-phase-label');
  const timerLabel = requiredElement<HTMLElement>('#battle-timer-label');
  const timer = requiredElement<HTMLElement>('#battle-timer');
  const oppHand = requiredElement<HTMLElement>('#battle-opp-hand');

  let context: BattleHudContext = {
    localFaction: Faction.Blue,
    localName: '玩家',
    opponentName: '电脑',
  };

  return {
    show: () => root.classList.remove('is-hidden'),
    hide: () => root.classList.add('is-hidden'),
    setContext(next) {
      context = next;
      selfName.textContent = next.localName || '玩家';
      oppName.textContent = next.opponentName || '对手';
    },
    update(match) {
      const local = context.localFaction;
      const opp = opposingFaction(local);
      selfName.textContent = context.localName || '玩家';
      oppName.textContent = context.opponentName || '对手';
      updateCastle(local, selfHp, selfBar, match);
      updateCastle(opp, oppHp, oppBar, match);

      const phaseText = matchPhaseLabel(match.phase) || matchPhaseLabel('normal');
      phaseLabel.textContent = phaseText;

      const remainingTicks = Math.max(0, match.getPhaseDeadlineTick() - match.world.tick);
      timerLabel.textContent = match.phase === 'final' ? '决胜剩余：' : '剩余时间：';
      timer.textContent = formatTicks(remainingTicks);

      syncOpponentHand(oppHand, match.decks[opp].hand.length, match.getMaxHandSize());
    },
  };
}

function updateCastle(
  faction: Faction,
  label: HTMLElement,
  bar: HTMLElement,
  match: MatchState,
): void {
  const hp = toFloat(match.getCastleHp(faction));
  const maxHp = toFloat(match.getCastleMaxHp(faction));
  label.textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
  bar.style.width = `${maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0}%`;
}

/** 用缩小牌背数量表示对手手牌数，不展示正面。 */
function syncOpponentHand(container: HTMLElement, count: number, maxHandSize: number): void {
  const clamped = Math.max(0, Math.min(maxHandSize, count | 0));
  const current = container.childElementCount;
  if (current === clamped) return;
  if (current > clamped) {
    while (container.childElementCount > clamped) {
      container.lastElementChild?.remove();
    }
    return;
  }
  for (let i = current; i < clamped; i += 1) {
    const card = document.createElement('span');
    card.className = 'battle-opp-card';
    card.setAttribute('aria-hidden', 'true');
    container.appendChild(card);
  }
  container.setAttribute('aria-label', `对手手牌 ${clamped} 张`);
}

function formatTicks(ticks: number): string {
  const seconds = Math.ceil(ticks / TICK_RATE);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
