import { Faction, teamSlots, type MatchState, type PlayingCard } from '@pb/sim';
import { cardImageUrl } from '../cards/cardImageUrl.js';

/** 观战手牌按 9 张满幅定宽；超过则由 CSS 按 --spec-count 自适应重叠。 */
const SPECTATOR_FULL_COUNT = 9;

export interface SpectatorHandsHandle {
  show(): void;
  hide(): void;
  setNames(blueName: string, redName: string): void;
  update(match: MatchState): void;
  dispose(): void;
}

/** 观战上帝视角：只读展示双方手牌正面，不复用出牌面板。 */
export function createSpectatorHands(): SpectatorHandsHandle {
  const root = required<HTMLElement>('#spectator-hands');
  const blueLabel = required<HTMLElement>('#spectator-hand-blue-label', root);
  const redLabel = required<HTMLElement>('#spectator-hand-red-label', root);
  const blueCards = required<HTMLElement>('#spectator-hand-blue', root);
  const redCards = required<HTMLElement>('#spectator-hand-red', root);

  let lastBlueKey = '';
  let lastRedKey = '';

  return {
    show() {
      root.classList.remove('is-hidden');
      root.classList.add('is-active');
    },
    hide() {
      root.classList.add('is-hidden');
      root.classList.remove('is-active');
      lastBlueKey = '';
      lastRedKey = '';
      blueCards.replaceChildren();
      redCards.replaceChildren();
    },
    setNames(blueName, redName) {
      blueLabel.textContent = blueName || '蓝方';
      redLabel.textContent = redName || '红方';
    },
    update(match) {
      syncRow(blueCards, teamHand(match, Faction.Blue), (key) => {
        lastBlueKey = key;
      }, lastBlueKey);
      syncRow(redCards, teamHand(match, Faction.Red), (key) => {
        lastRedKey = key;
      }, lastRedKey);
    },
    dispose() {
      this.hide();
    },
  };
}

/** 同队各席手牌拼成一排，2v2 观战也能看到全队牌。 */
function teamHand(match: MatchState, faction: Faction): PlayingCard[] {
  const cards: PlayingCard[] = [];
  for (const slot of teamSlots(faction, match.mode)) {
    cards.push(...match.decks[slot]!.hand);
  }
  return cards;
}

/** 手牌 id 序列变化时才重渲，避免每帧刷 DOM。 */
function syncRow(
  container: HTMLElement,
  hand: readonly PlayingCard[],
  assign: (key: string) => void,
  current: string,
): void {
  const key = hand.map((card) => card.id).join(',');
  if (key === current) return;
  container.replaceChildren();
  container.style.setProperty('--spec-count', String(hand.length));
  container.style.setProperty('--spec-full', String(SPECTATOR_FULL_COUNT));
  for (const card of hand) {
    const el = document.createElement('span');
    el.className = 'spectator-hand-card';
    el.style.backgroundImage = `url("${cardImageUrl(card)}")`;
    el.title = card.label;
    el.setAttribute('aria-label', card.label);
    container.append(el);
  }
  assign(key);
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`观战手牌缺少元素：${selector}`);
  return element;
}
