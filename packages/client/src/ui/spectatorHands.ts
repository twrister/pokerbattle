import { Faction, teamSlots, type MatchState, type PlayingCard } from '@pb/sim';
import { cardImageUrl } from '../cards/cardImageUrl.js';

/** 观战手牌按 9 张满幅定宽；超过则由 CSS 按 --spec-count 自适应重叠。 */
const SPECTATOR_FULL_COUNT = 9;

export interface SpectatorHandNames {
  blue: string;
  red: string;
  blueMate?: string;
  redMate?: string;
}

export interface SpectatorHandsHandle {
  show(): void;
  hide(): void;
  setNames(names: SpectatorHandNames): void;
  update(match: MatchState): void;
  dispose(): void;
}

interface HandRow {
  group: HTMLElement | null;
  label: HTMLElement;
  cards: HTMLElement;
  lastKey: string;
}

/** 观战上帝视角：只读展示各席手牌正面，2v2 同队分栏不混排。 */
export function createSpectatorHands(): SpectatorHandsHandle {
  const root = required<HTMLElement>('#spectator-hands');
  const blue = createRow(
    required<HTMLElement>('#spectator-hand-blue-label', root),
    required<HTMLElement>('#spectator-hand-blue', root),
    null,
  );
  const blueMate = createRow(
    required<HTMLElement>('#spectator-hand-blue-mate-label', root),
    required<HTMLElement>('#spectator-hand-blue-mate', root),
    required<HTMLElement>('#spectator-hand-blue-mate-group', root),
  );
  const red = createRow(
    required<HTMLElement>('#spectator-hand-red-label', root),
    required<HTMLElement>('#spectator-hand-red', root),
    null,
  );
  const redMate = createRow(
    required<HTMLElement>('#spectator-hand-red-mate-label', root),
    required<HTMLElement>('#spectator-hand-red-mate', root),
    required<HTMLElement>('#spectator-hand-red-mate-group', root),
  );

  return {
    show() {
      root.classList.remove('is-hidden');
      root.classList.add('is-active');
    },
    hide() {
      root.classList.add('is-hidden');
      root.classList.remove('is-active', 'is-2v2');
      clearRow(blue);
      clearRow(blueMate);
      clearRow(red);
      clearRow(redMate);
      setMateVisible(blueMate, false);
      setMateVisible(redMate, false);
    },
    setNames(names) {
      blue.label.textContent = names.blue || '蓝方';
      red.label.textContent = names.red || '红方';
      blueMate.label.textContent = names.blueMate || '蓝方2';
      redMate.label.textContent = names.redMate || '红方2';
    },
    update(match) {
      const is2v2 = match.mode === '2v2';
      root.classList.toggle('is-2v2', is2v2);
      setMateVisible(blueMate, is2v2);
      setMateVisible(redMate, is2v2);
      syncSeatRow(blue, match, Faction.Blue, 0);
      syncSeatRow(red, match, Faction.Red, 0);
      if (is2v2) {
        syncSeatRow(blueMate, match, Faction.Blue, 1);
        syncSeatRow(redMate, match, Faction.Red, 1);
      } else {
        clearRow(blueMate);
        clearRow(redMate);
      }
    },
    dispose() {
      this.hide();
    },
  };
}

function createRow(label: HTMLElement, cards: HTMLElement, group: HTMLElement | null): HandRow {
  return { group, label, cards, lastKey: '' };
}

/** 2v2 才露出队友栏；1v1 收起以免空出半行。 */
function setMateVisible(row: HandRow, visible: boolean): void {
  row.group?.classList.toggle('is-hidden', !visible);
}

function syncSeatRow(row: HandRow, match: MatchState, faction: Faction, teamIndex: number): void {
  const slot = teamSlots(faction, match.mode)[teamIndex];
  const hand = slot == null ? [] : (match.decks[slot]?.hand ?? []);
  syncRow(row, hand);
}

function clearRow(row: HandRow): void {
  row.lastKey = '';
  row.cards.replaceChildren();
}

/** 手牌 id 序列变化时才重渲，避免每帧刷 DOM。 */
function syncRow(row: HandRow, hand: readonly PlayingCard[]): void {
  const key = hand.map((card) => card.id).join(',');
  if (key === row.lastKey) return;
  row.cards.replaceChildren();
  row.cards.style.setProperty('--spec-count', String(hand.length));
  row.cards.style.setProperty('--spec-full', String(SPECTATOR_FULL_COUNT));
  for (const card of hand) {
    const el = document.createElement('span');
    el.className = 'spectator-hand-card';
    el.style.backgroundImage = `url("${cardImageUrl(card)}")`;
    el.title = card.label;
    el.setAttribute('aria-label', card.label);
    row.cards.append(el);
  }
  row.lastKey = key;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`观战手牌缺少元素：${selector}`);
  return element;
}
