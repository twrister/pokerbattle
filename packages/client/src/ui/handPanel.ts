import {
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  type PlayingCard,
} from '../cards/deck.js';

const PLAY_ANIMATION_MS = 360;
const MIN_DRAW_INTERVAL_MS = 250;

export interface HandPanelOptions {
  drawIntervalSeconds?: number;
  deck?: PokerDeck;
  onPlay?: (cards: readonly PlayingCard[]) => void;
}

export interface HandPanelHandle {
  readonly deck: PokerDeck;
  update: (deltaMs: number) => void;
  setDrawInterval: (seconds: number) => void;
  dispose: () => void;
}

/** 创建单机手牌会话，并把牌堆状态、拖划选择和表现动画限制在 HUD 内。 */
export function createHandPanel(options: HandPanelOptions = {}): HandPanelHandle {
  const root = required<HTMLElement>('#solo-hand');
  const cardsElement = required<HTMLElement>('#hand-cards');
  const playButton = required<HTMLButtonElement>('#btn-play-cards');
  const pileCount = required<HTMLElement>('#hand-pile-count');
  const handCount = required<HTMLElement>('#hand-count');
  const countdown = required<HTMLElement>('#hand-draw-countdown');
  const deck = options.deck ?? new PokerDeck();
  /** 正式选中：松开后确认，可出牌；表现上拉高出牌堆半截。 */
  const selected = new Set<string>();
  /** 临时选中：按下/滑选预览，松开后按本轮模式统一加选或取消。 */
  const preview = new Set<string>();
  const knownCardIds = new Set<string>();
  const pendingTimers = new Set<number>();

  let drawIntervalMs = toIntervalMs(options.drawIntervalSeconds ?? 3);
  let remainingMs = drawIntervalMs;
  let pointerId: number | null = null;
  /** true=松开后正式选中预览牌；false=松开后取消预览牌的正式选中。 */
  let dragSelectMode = true;
  /** 本轮滑选按下时的牌下标；与当前划到的牌组成闭区间，往回滑会收缩临时选中区间。 */
  let dragAnchorIndex: number | null = null;
  let playing = false;
  let disposed = false;

  root.classList.add('is-active');
  for (const card of deck.drawMany(INITIAL_HAND_SIZE)) knownCardIds.delete(card.id);
  render();

  /** 按锚点到当前牌刷新临时选中闭区间；绝不在按下期间改正式选中。 */
  const applyPointerCard = (clientX: number, clientY: number): void => {
    if (dragAnchorIndex === null) return;
    const cardElement = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('.playing-card[data-card-id]');
    if (!cardElement || !cardsElement.contains(cardElement)) return;
    const cardId = cardElement.dataset.cardId;
    if (!cardId) return;
    const currentIndex = deck.hand.findIndex((card) => card.id === cardId);
    if (currentIndex < 0) return;

    const from = Math.min(dragAnchorIndex, currentIndex);
    const to = Math.max(dragAnchorIndex, currentIndex);
    preview.clear();
    for (let index = from; index <= to; index += 1) {
      const id = deck.hand[index]?.id;
      if (id) preview.add(id);
    }
    syncSelection();
  };

  /** 捕获指针确保划出单张牌边界后仍能完成一次连续临时选牌。 */
  const onPointerDown = (event: PointerEvent): void => {
    if (playing || event.button !== 0) return;
    const cardElement = (event.target as Element).closest<HTMLElement>('.playing-card[data-card-id]');
    const cardId = cardElement?.dataset.cardId;
    if (!cardId || !cardsElement.contains(cardElement)) return;
    const anchorIndex = deck.hand.findIndex((card) => card.id === cardId);
    if (anchorIndex < 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    // 起点已正式选中则本轮为取消模式；正式选中仍保留到 pointerup 再统一提交。
    dragSelectMode = !selected.has(cardId);
    dragAnchorIndex = anchorIndex;
    preview.clear();
    preview.add(cardId);
    syncSelection();
    cardsElement.setPointerCapture(event.pointerId);
    applyPointerCard(event.clientX, event.clientY);
  };

  /** 使用命中测试而非 event.target，兼容 pointer capture 下跨多张牌拖划。 */
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    applyPointerCard(event.clientX, event.clientY);
  };

  /** 松开时才提交本轮加选/取消，保证起点正式选中牌也不会提前落下。 */
  const finishPointerSelection = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (cardsElement.hasPointerCapture(event.pointerId)) cardsElement.releasePointerCapture(event.pointerId);
    for (const cardId of preview) {
      if (dragSelectMode) selected.add(cardId);
      else selected.delete(cardId);
    }
    clearPreview();
    pointerId = null;
    dragAnchorIndex = null;
    syncSelection();
  };

  /** 中断手势时丢弃临时选中，不改动正式选中。 */
  const cancelPointerSelection = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (cardsElement.hasPointerCapture(event.pointerId)) cardsElement.releasePointerCapture(event.pointerId);
    clearPreview();
    pointerId = null;
    dragAnchorIndex = null;
    syncSelection();
  };

  /** 清空临时选中集合，避免松开后仍残留预览态。 */
  function clearPreview(): void {
    preview.clear();
  }

  /** 等飞出动画结束后再回收牌，保证 DOM 不会提前消失。 */
  const onPlayClick = (): void => {
    if (playing || selected.size === 0) return;
    const playedIds = [...selected];
    playing = true;
    playButton.disabled = true;
    for (const cardId of playedIds) {
      [...cardsElement.querySelectorAll<HTMLElement>('.playing-card')].find(
        (element) => element.dataset.cardId === cardId,
      )?.classList.add('is-playing');
    }

    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      if (disposed) return;
      const playedCards = deck.play(playedIds);
      for (const card of playedCards) knownCardIds.delete(card.id);
      selected.clear();
      playing = false;
      options.onPlay?.(playedCards);
      render();
    }, PLAY_ANIMATION_MS);
    pendingTimers.add(timer);
  };

  cardsElement.addEventListener('pointerdown', onPointerDown);
  cardsElement.addEventListener('pointermove', onPointerMove);
  cardsElement.addEventListener('pointerup', finishPointerSelection);
  cardsElement.addEventListener('pointercancel', cancelPointerSelection);
  playButton.addEventListener('click', onPlayClick);

  /** 重建最多十张牌的轻量 DOM，并只给本次新牌附加翻转发牌动画。 */
  function render(): void {
    const fragment = document.createDocumentFragment();
    deck.hand.forEach((card, index) => {
      const isNew = !knownCardIds.has(card.id);
      knownCardIds.add(card.id);
      const cardElement = document.createElement('button');
      cardElement.type = 'button';
      cardElement.className = `playing-card${isNew ? ' is-dealing' : ''}`;
      cardElement.dataset.cardId = card.id;
      cardElement.setAttribute('aria-label', card.label);
      cardElement.setAttribute('aria-pressed', String(selected.has(card.id)));
      cardElement.style.setProperty('--card-index', String(index));
      cardElement.style.setProperty('--deal-delay', `${Math.min(index, INITIAL_HAND_SIZE - 1) * 90}ms`);
      cardElement.innerHTML = `
        <span class="playing-card-inner">
          <span class="playing-card-face playing-card-back"></span>
          <span class="playing-card-face playing-card-front">
            <img src="${card.imageUrl}" alt="${card.label}" draggable="false" />
          </span>
        </span>
      `;
      fragment.appendChild(cardElement);
      // 发牌动画结束后去掉类，避免 fill-mode:both 永久锁死 transform。
      if (isNew) {
        const clearDeal = (event: AnimationEvent): void => {
          if (event.animationName !== 'card-deal') return;
          cardElement.classList.remove('is-dealing');
          cardElement.removeEventListener('animationend', clearDeal);
        };
        cardElement.addEventListener('animationend', clearDeal);
      }
    });
    cardsElement.replaceChildren(fragment);
    syncStatus();
    syncSelection();
  }

  /** 只更新选择态，避免 pointermove 时反复创建图片节点；临时选中只改描边不改位置。 */
  function syncSelection(): void {
    for (const cardElement of cardsElement.querySelectorAll<HTMLElement>('.playing-card')) {
      const cardId = cardElement.dataset.cardId ?? '';
      const isSelected = selected.has(cardId);
      const isPreview = preview.has(cardId);
      cardElement.classList.toggle('is-selected', isSelected);
      cardElement.classList.toggle('is-preview', isPreview);
      cardElement.setAttribute('aria-pressed', String(isSelected));
    }
    playButton.disabled = playing || selected.size === 0;
    playButton.textContent = selected.size > 0 ? `出牌 ${selected.size}` : '出牌';
  }

  /** 同步牌数和补牌倒计时，满手牌时明确显示暂停而不是归零。 */
  function syncStatus(): void {
    pileCount.textContent = String(deck.availableCount);
    handCount.textContent = `${deck.hand.length}/${MAX_HAND_SIZE}`;
    countdown.textContent =
      deck.hand.length >= MAX_HAND_SIZE ? '已满' : `${Math.max(remainingMs, 0) / 1000}`.replace(/(\.\d).*$/, '$1') + 's';
  }

  return {
    deck,
    update(deltaMs: number) {
      if (disposed || playing || deck.hand.length >= MAX_HAND_SIZE) {
        syncStatus();
        return;
      }
      remainingMs -= Math.max(deltaMs, 0);
      if (remainingMs <= 0) {
        deck.draw();
        remainingMs += drawIntervalMs;
        render();
      } else {
        syncStatus();
      }
    },
    setDrawInterval(seconds: number) {
      const nextInterval = toIntervalMs(seconds);
      drawIntervalMs = nextInterval;
      remainingMs = Math.min(remainingMs, nextInterval);
      syncStatus();
    },
    dispose() {
      disposed = true;
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      cardsElement.removeEventListener('pointerdown', onPointerDown);
      cardsElement.removeEventListener('pointermove', onPointerMove);
      cardsElement.removeEventListener('pointerup', finishPointerSelection);
      cardsElement.removeEventListener('pointercancel', cancelPointerSelection);
      playButton.removeEventListener('click', onPlayClick);
      cardsElement.replaceChildren();
      root.classList.remove('is-active');
    },
  };
}

/** 将面板输入收敛为安全的毫秒值，避免零间隔导致单帧连续抽牌。 */
function toIntervalMs(seconds: number): number {
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : 3000;
  return Math.max(milliseconds, MIN_DRAW_INTERVAL_MS);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`手牌 HUD 缺少元素：${selector}`);
  return element;
}
