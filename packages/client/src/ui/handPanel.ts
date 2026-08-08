import {
  getFormationsFor,
  UNIT_CONFIGS,
  type CardFormation,
  type UnitTypeId,
} from '@pb/sim';
import {
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  type PlayingCard,
} from '../cards/deck.js';
import { detectHandCategories, findStrongestHand } from '../cards/handCategory.js';

const PLAY_ANIMATION_MS = 360;
/** 手牌增删后，留存牌从旧坐标滑到新坐标的时长。 */
const LAYOUT_MOVE_MS = 280;
const MIN_DRAW_INTERVAL_MS = 250;

export interface HandPanelOptions {
  drawIntervalSeconds?: number;
  deck?: PokerDeck;
  /** 出牌完成回调；formation 为玩家点选的搭配，仅点出牌按钮且唯一搭配时也会带上。 */
  onPlay?: (cards: readonly PlayingCard[], formation: CardFormation | null) => void;
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
  const formationsElement = required<HTMLElement>('#hand-formations');
  const selectBestButton = required<HTMLButtonElement>('#btn-select-best');
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
  /** 当前选中牌对应的兵种搭配选项。 */
  let formations: CardFormation[] = [];

  let drawIntervalMs = toIntervalMs(options.drawIntervalSeconds ?? 3);
  let remainingMs = drawIntervalMs;
  let pointerId: number | null = null;
  /** true=松开后正式选中预览牌；false=松开后取消预览牌的正式选中。 */
  let dragSelectMode = true;
  /** 本轮滑选按下时的牌下标；与当前划到的牌组成闭区间，往回滑会收缩临时选中区间。 */
  let dragAnchorIndex: number | null = null;
  let playing = false;
  let disposed = false;
  /** 用于作废上一轮尚未结束的布局位移动画回调。 */
  let layoutGeneration = 0;

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
    const previousPreview = new Set(preview);
    preview.clear();
    for (let index = from; index <= to; index += 1) {
      const id = deck.hand[index]?.id;
      if (id) preview.add(id);
    }
    syncSelection();
    // 新划入预览的牌补播轻晃；pointer capture 下 :hover 不会落到这些牌上。
    for (const id of preview) {
      if (!previousPreview.has(id)) playCardWobble(id);
    }
  };

  /** 给指定牌重播划过轻晃；连滑同一牌时先卸类再挂，确保 animation 能重启。 */
  function playCardWobble(cardId: string): void {
    const cardElement = [...cardsElement.querySelectorAll<HTMLElement>('.playing-card')].find(
      (element) => element.dataset.cardId === cardId,
    );
    if (!cardElement || cardElement.classList.contains('is-playing') || cardElement.classList.contains('is-dealing')) {
      return;
    }
    cardElement.classList.remove('is-wobbling');
    void cardElement.offsetWidth;
    cardElement.classList.add('is-wobbling');
    const clearWobble = (event: AnimationEvent): void => {
      if (event.animationName !== 'card-wobble' || event.target !== cardElement) return;
      cardElement.classList.remove('is-wobbling');
      cardElement.removeEventListener('animationend', clearWobble);
    };
    cardElement.addEventListener('animationend', clearWobble);
  }

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
    playCardWobble(cardId);
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

  /**
   * 出牌共用流程：选项按钮带上指定搭配，出牌按钮仅在唯一搭配时可用并自动带上。
   * 飞出动画结束后再回收牌，保证 DOM 不会提前消失。
   */
  const playSelected = (formation: CardFormation | null): void => {
    if (playing || selected.size === 0) return;
    if (formations.length === 0) return;
    // 多个搭配时必须点选项，避免误用默认搭配。
    if (formation === null && formations.length !== 1) return;
    const chosen = formation ?? formations[0] ?? null;
    const playedIds = [...selected];
    playing = true;
    playButton.disabled = true;
    formationsElement.querySelectorAll<HTMLButtonElement>('.formation-option').forEach((button) => {
      button.disabled = true;
    });
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
      formations = [];
      playing = false;
      options.onPlay?.(playedCards, chosen);
      render();
    }, PLAY_ANIMATION_MS);
    pendingTimers.add(timer);
  };

  /** 工具栏出牌按钮：仅唯一搭配时等价于点该选项。 */
  const onPlayClick = (): void => {
    playSelected(null);
  };

  /** 一键选中手牌中最强合法牌型，并清空其余正式/临时选中。 */
  const onSelectBestClick = (): void => {
    if (playing) return;
    const best = findStrongestHand(deck.hand);
    if (best.length === 0) return;
    clearPreview();
    pointerId = null;
    dragAnchorIndex = null;
    selected.clear();
    for (const card of best) selected.add(card.id);
    syncSelection();
  };

  /** 搭配选项点击：直接确认该搭配并出牌。 */
  const onFormationClick = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.formation-option[data-formation-id]');
    if (!button || button.disabled) return;
    const formationId = button.dataset.formationId;
    const formation = formations.find((entry) => entry.id === formationId) ?? null;
    if (!formation) return;
    playSelected(formation);
  };

  cardsElement.addEventListener('pointerdown', onPointerDown);
  cardsElement.addEventListener('pointermove', onPointerMove);
  cardsElement.addEventListener('pointerup', finishPointerSelection);
  cardsElement.addEventListener('pointercancel', cancelPointerSelection);
  selectBestButton.addEventListener('click', onSelectBestClick);
  playButton.addEventListener('click', onPlayClick);
  formationsElement.addEventListener('click', onFormationClick);

  /** 记录当前手牌屏幕坐标，供重建 DOM 后做 FLIP 位移。 */
  function captureCardRects(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>();
    for (const cardElement of cardsElement.querySelectorAll<HTMLElement>('.playing-card')) {
      const cardId = cardElement.dataset.cardId;
      if (cardId) rects.set(cardId, cardElement.getBoundingClientRect());
    }
    return rects;
  }

  /**
   * 对仍留在手牌中的牌做 FLIP：先瞬移回旧位置，再过渡到新布局。
   * 新发入的牌走独立的 is-dealing，不参与位移。
   */
  function animateLayoutShift(previousRects: Map<string, DOMRect>): void {
    if (previousRects.size === 0) return;
    const generation = ++layoutGeneration;
    for (const cardElement of cardsElement.querySelectorAll<HTMLElement>('.playing-card')) {
      const cardId = cardElement.dataset.cardId;
      if (!cardId || cardElement.classList.contains('is-dealing')) continue;
      const previous = previousRects.get(cardId);
      if (!previous) continue;
      const next = cardElement.getBoundingClientRect();
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      cardElement.classList.add('is-reflowing');
      cardElement.style.transition = 'none';
      // 先叠加上旧→新的位移差，视觉上停在原位；清掉后由 CSS 过渡到目标 transform。
      cardElement.style.transform = `translate(${dx}px, ${dy}px) translateY(var(--card-lift)) rotate(calc((var(--card-index) - 4.5) * 0.35deg))`;
      void cardElement.offsetWidth;
      cardElement.style.transition = `transform ${LAYOUT_MOVE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      cardElement.style.transform = '';

      const clearReflow = (event: TransitionEvent): void => {
        if (event.propertyName !== 'transform' || event.target !== cardElement) return;
        cardElement.removeEventListener('transitionend', clearReflow);
        if (disposed || generation !== layoutGeneration) return;
        cardElement.classList.remove('is-reflowing');
        cardElement.style.transition = '';
        cardElement.style.transform = '';
      };
      cardElement.addEventListener('transitionend', clearReflow);
    }
  }

  /** 重建最多十张牌的轻量 DOM，并只给本次新牌附加翻转发牌动画。 */
  function render(): void {
    const previousRects = captureCardRects();
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
    // 先恢复选中拉高，再量新坐标，避免 FLIP 把选中态高度差算进去。
    syncSelection();
    animateLayoutShift(previousRects);
  }

  /** 只更新选择态，避免 pointermove 时反复创建图片节点；加选/取消预览都置灰，划过轻晃另由 playCardWobble 触发。 */
  function syncSelection(): void {
    for (const cardElement of cardsElement.querySelectorAll<HTMLElement>('.playing-card')) {
      const cardId = cardElement.dataset.cardId ?? '';
      const isSelected = selected.has(cardId);
      const isPreview = preview.has(cardId);
      cardElement.classList.toggle('is-selected', isSelected);
      // 取消模式也挂预览置灰；正式选中拉高仍保留到 pointerup 再提交。
      cardElement.classList.toggle('is-preview', isPreview);
      cardElement.setAttribute('aria-pressed', String(isSelected));
    }
    renderFormations();
    selectBestButton.disabled = playing || deck.hand.length === 0;
    // 出牌按钮仅在恰好一个合法搭配时可用，多个搭配必须点选项确认。
    playButton.disabled = playing || formations.length !== 1;
    playButton.textContent =
      formations.length === 1
        ? `出牌 ${selected.size}`
        : selected.size > 0
          ? `选搭配 ${selected.size}`
          : '出牌';
  }

  /** 根据正式选中牌识别牌型并列出兵种搭配按钮。 */
  function renderFormations(): void {
    const selectedCards = deck.hand.filter((card) => selected.has(card.id));
    const categories = detectHandCategories(selectedCards);
    formations = getFormationsFor(categories);
    formationsElement.replaceChildren();
    formationsElement.classList.toggle('is-visible', formations.length > 0 && !playing);
    if (formations.length === 0 || playing) return;

    const fragment = document.createDocumentFragment();
    for (const formation of formations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'formation-option';
      button.dataset.formationId = formation.id;
      button.innerHTML = `
        <strong>${formation.name}</strong>
        <span>${formatFormationUnits(formation)}</span>
      `;
      fragment.appendChild(button);
    }
    formationsElement.appendChild(fragment);
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
      selectBestButton.removeEventListener('click', onSelectBestClick);
      playButton.removeEventListener('click', onPlayClick);
      formationsElement.removeEventListener('click', onFormationClick);
      cardsElement.replaceChildren();
      formationsElement.replaceChildren();
      formationsElement.classList.remove('is-visible');
      root.classList.remove('is-active');
    },
  };
}

/** 把阵型 rows 格式化为「前：铁卫x2 / 后：弓手x2」，突出前后站位。 */
function formatFormationUnits(formation: CardFormation): string {
  if (formation.rows.length === 0) return '';
  if (formation.rows.length === 1) {
    return formatRowUnits(formation.rows[0]!);
  }
  return formation.rows
    .map((row, index) => {
      const label = index === 0 ? '前' : index === formation.rows.length - 1 ? '后' : `排${index + 1}`;
      return `${label}：${formatRowUnits(row)}`;
    })
    .join(' / ');
}

/** 单排兵种短标签，如「铁卫x2 · 弓手x1」。 */
function formatRowUnits(row: readonly UnitTypeId[]): string {
  const counts = new Map<UnitTypeId, number>();
  const order: UnitTypeId[] = [];
  for (const typeId of row) {
    if (!counts.has(typeId)) order.push(typeId);
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1);
  }
  return order
    .map((typeId) => {
      const name = UNIT_CONFIGS[typeId]?.name.replace(/（.*?）/, '') ?? typeId;
      return `${name}x${counts.get(typeId)}`;
    })
    .join(' · ');
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
