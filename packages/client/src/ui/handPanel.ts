import {
  getFormationsFor,
  isBuildingOnlyFormation,
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
import { getFormationThumbnail } from '../view/formationThumbnail.js';

const PLAY_ANIMATION_MS = 360;
/** 手牌增删后，留存牌从旧坐标滑到新坐标的时长。 */
const LAYOUT_MOVE_MS = 280;
const MIN_DRAW_INTERVAL_MS = 250;
/** 选了牌但拼不出牌型时的提示。 */
const STATUS_NO_CATEGORY = '未凑成有效牌型';
/** 拖到战场但整阵越界时的提示。 */
const STATUS_INVALID_DROP = '请在己方半场内放置完整阵型';
/** 拖拽建筑阵型时的操作提示。 */
const STATUS_BUILDING_DRAG = '拖到绿色格子上松手放置';
/** 箭头弧顶相对首尾连线的最大抬高像素。 */
const ARROW_MAX_LIFT = 180;

/** 一次出兵请求；point 为拖拽落点屏幕坐标，点按钮自动放置时为 null。 */
export interface FormationSpawnRequest {
  formation: CardFormation;
  cards: readonly PlayingCard[];
  point: { clientX: number; clientY: number } | null;
}

export interface HandPanelOptions {
  drawIntervalSeconds?: number;
  deck?: PokerDeck;
  /** 请求出兵；返回 false 表示落点非法，手牌不消耗、阵型按钮保留以便重试。 */
  onRequestSpawn?: (request: FormationSpawnRequest) => boolean;
  /** 开始拖拽单建筑阵型：进入放置预览（绿格）。 */
  onBuildingDragStart?: (formation: CardFormation) => void;
  /** 拖拽建筑时同步吸附预览位置。 */
  onBuildingDragMove?: (clientX: number, clientY: number) => void;
  /** 结束建筑拖拽（松手或取消）：卸下绿格预览。 */
  onBuildingDragEnd?: () => void;
  /** 出兵成功且出牌动画结束后的回调。 */
  onPlay?: (cards: readonly PlayingCard[], formation: CardFormation | null) => void;
}

export interface HandPanelHandle {
  readonly deck: PokerDeck;
  update: (deltaMs: number) => void;
  setDrawInterval: (seconds: number) => void;
  /** 取景参数变更后重渲当前阵型按钮缩略图。 */
  refreshFormations: () => void;
  dispose: () => void;
}

/** 创建单机手牌会话，并把牌堆状态、拖划选择和表现动画限制在 HUD 内。 */
export function createHandPanel(options: HandPanelOptions = {}): HandPanelHandle {
  const root = required<HTMLElement>('#solo-hand');
  const cardsElement = required<HTMLElement>('#hand-cards');
  const formationsElement = required<HTMLElement>('#hand-formations');
  const selectBestButton = required<HTMLButtonElement>('#btn-select-best');
  const statusElement = required<HTMLElement>('#hand-status');
  const arrowLayer = required<SVGElement>('#hand-arrow');
  const arrowPath = required<SVGPathElement>('#hand-arrow-path');
  const arrowHead = required<SVGPolygonElement>('#hand-arrow-head');
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
  /** 用于丢弃上一批阵型按钮尚未返回的缩略图。 */
  let thumbnailGeneration = 0;
  /** 正在拖拽的阵型 id；null 表示当前没有出兵手势。 */
  let dragFormationId: string | null = null;
  let dragPointerId: number | null = null;
  /** 按下时的按钮范围：在其内松开视为「原地自动放置」。 */
  let dragButtonRect: DOMRect | null = null;
  /** 指针手势已处理过一次放置，抑制紧随其后的合成 click。 */
  let suppressClick = false;
  /** 当前拖拽是否为单建筑阵型（决定是否走绿格预览）。 */
  let draggingBuilding = false;

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
   * 出兵共用流程：先向外请求落点，只有成功才播出牌动画并回收手牌。
   * 失败时保留选牌与阵型按钮，玩家可以换个位置重试。
   * 单建筑阵型同样走此处：拖拽预览在 pointerdown 已开启，松手带 point 落成。
   */
  const requestPlay = (
    formation: CardFormation,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (playing || selected.size === 0 || formations.length === 0) return false;
    const cards = deck.hand.filter((card) => selected.has(card.id));
    if (cards.length === 0) return false;
    if (options.onRequestSpawn?.({ formation, cards, point }) === false) {
      setStatus(STATUS_INVALID_DROP);
      return false;
    }

    setStatus('');
    const playedIds = cards.map((card) => card.id);
    playing = true;
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
      options.onPlay?.(playedCards, formation);
      render();
    }, PLAY_ANIMATION_MS);
    pendingTimers.add(timer);
    return true;
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

  /** 按下阵型按钮：捕获指针并开始画拖拽箭头；建筑则立刻进入绿格放置预览。 */
  const onFormationPointerDown = (event: PointerEvent): void => {
    if (playing || event.button !== 0) return;
    const button = (event.target as Element).closest<HTMLButtonElement>(
      '.formation-option[data-formation-id]',
    );
    if (!button || button.disabled) return;
    const formationId = button.dataset.formationId;
    const formation = formations.find((entry) => entry.id === formationId) ?? null;
    if (!formation) return;
    event.preventDefault();
    dragFormationId = formation.id;
    dragPointerId = event.pointerId;
    dragButtonRect = button.getBoundingClientRect();
    draggingBuilding = isBuildingOnlyFormation(formation);
    formationsElement.setPointerCapture(event.pointerId);
    drawArrow(event.clientX, event.clientY);
    if (draggingBuilding) {
      options.onBuildingDragStart?.(formation);
      options.onBuildingDragMove?.(event.clientX, event.clientY);
      setStatus(STATUS_BUILDING_DRAG);
    }
  };

  const onFormationPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    drawArrow(event.clientX, event.clientY);
    if (draggingBuilding) options.onBuildingDragMove?.(event.clientX, event.clientY);
  };

  /**
   * 松手判定：按钮内 = 自动放置，战场上 = 指定落点，其余区域 = 取消。
   * 建筑在按下时已进入预览；先落成再卸绿格，避免预览先 dispose 导致校验脱节。
   */
  const onFormationPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    const formation = formations.find((entry) => entry.id === dragFormationId) ?? null;
    const buttonRect = dragButtonRect;
    const wasBuilding = draggingBuilding;
    const clientX = event.clientX;
    const clientY = event.clientY;
    suppressClick = true;
    if (!formation) {
      endFormationDrag(event.pointerId);
      return;
    }

    if (buttonRect && isInsideRect(buttonRect, clientX, clientY)) {
      // 建筑点按不拖出：半场安全点自动落成
      requestPlay(formation, null);
    } else if (isOverBattlefield(clientX, clientY)) {
      requestPlay(formation, { clientX, clientY });
    } else if (wasBuilding) {
      setStatus('');
    }
    endFormationDrag(event.pointerId);
  };

  const onFormationPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    endFormationDrag(event.pointerId);
    setStatus('');
  };

  /** 键盘/辅助技术触发的点击等价于自动放置；指针手势已处理过的 click 直接吞掉。 */
  const onFormationClick = (event: Event): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>(
      '.formation-option[data-formation-id]',
    );
    if (!button || button.disabled) return;
    const formation = formations.find((entry) => entry.id === button.dataset.formationId) ?? null;
    if (formation) requestPlay(formation, null);
  };

  cardsElement.addEventListener('pointerdown', onPointerDown);
  cardsElement.addEventListener('pointermove', onPointerMove);
  cardsElement.addEventListener('pointerup', finishPointerSelection);
  cardsElement.addEventListener('pointercancel', cancelPointerSelection);
  selectBestButton.addEventListener('click', onSelectBestClick);
  formationsElement.addEventListener('pointerdown', onFormationPointerDown);
  formationsElement.addEventListener('pointermove', onFormationPointerMove);
  formationsElement.addEventListener('pointerup', onFormationPointerUp);
  formationsElement.addEventListener('pointercancel', onFormationPointerCancel);
  formationsElement.addEventListener('click', onFormationClick);

  /** 结束一次出兵手势：释放指针捕获、卸建筑绿格预览并收起箭头。 */
  function endFormationDrag(pointerId: number): void {
    if (formationsElement.hasPointerCapture(pointerId)) {
      formationsElement.releasePointerCapture(pointerId);
    }
    const wasBuilding = draggingBuilding;
    dragFormationId = null;
    dragPointerId = null;
    dragButtonRect = null;
    draggingBuilding = false;
    hideArrow();
    if (wasBuilding) options.onBuildingDragEnd?.();
  }

  /** 从按钮中心向指针画一条弧线，末端箭头随弧线切线旋转。 */
  function drawArrow(toX: number, toY: number): void {
    if (!dragButtonRect) return;
    const fromX = dragButtonRect.left + dragButtonRect.width / 2;
    const fromY = dragButtonRect.top + dragButtonRect.height / 2;
    const lift = Math.min(Math.hypot(toX - fromX, toY - fromY) * 0.45, ARROW_MAX_LIFT) + 40;
    const controlX = (fromX + toX) / 2;
    const controlY = (fromY + toY) / 2 - lift;
    arrowPath.setAttribute('d', `M ${fromX} ${fromY} Q ${controlX} ${controlY} ${toX} ${toY}`);
    const angle = (Math.atan2(toY - controlY, toX - controlX) * 180) / Math.PI;
    arrowHead.setAttribute('transform', `translate(${toX} ${toY}) rotate(${angle})`);
    arrowLayer.classList.add('is-visible');
  }

  function hideArrow(): void {
    arrowLayer.classList.remove('is-visible');
    arrowPath.removeAttribute('d');
  }

  /** 提示区留一行高度常驻，出现/消失不会顶动下方手牌。 */
  function setStatus(text: string): void {
    statusElement.textContent = text;
    statusElement.classList.toggle('is-visible', text.length > 0);
  }

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
    setStatus(!playing && selected.size > 0 && formations.length === 0 ? STATUS_NO_CATEGORY : '');
  }

  /** 根据正式选中牌识别牌型并列出兵种搭配按钮（只放 3D 缩略图，说明走 aria-label）。 */
  function renderFormations(): void {
    const selectedCards = deck.hand.filter((card) => selected.has(card.id));
    const categories = detectHandCategories(selectedCards);
    formations = getFormationsFor(categories);
    formationsElement.replaceChildren();
    formationsElement.classList.toggle('is-visible', formations.length > 0 && !playing);
    const generation = ++thumbnailGeneration;
    if (formations.length === 0 || playing) return;

    const fragment = document.createDocumentFragment();
    for (const formation of formations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'formation-option';
      button.dataset.formationId = formation.id;
      button.setAttribute('aria-label', `${formation.name}：${formatFormationUnits(formation)}`);
      const image = document.createElement('img');
      image.className = 'formation-thumb';
      image.alt = '';
      image.draggable = false;
      button.appendChild(image);
      fragment.appendChild(button);
      void applyThumbnail(button, image, formation, generation);
    }
    formationsElement.appendChild(fragment);
  }

  /** 缩略图异步出图；上一批按钮已被替换或环境无 WebGL 时分别丢弃与退回文字。 */
  async function applyThumbnail(
    button: HTMLButtonElement,
    image: HTMLImageElement,
    formation: CardFormation,
    generation: number,
  ): Promise<void> {
    const url = await getFormationThumbnail(formation);
    if (disposed || generation !== thumbnailGeneration) return;
    if (url) {
      image.src = url;
      return;
    }
    button.classList.add('is-thumb-missing');
    button.textContent = formation.name;
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
    refreshFormations() {
      renderFormations();
    },
    dispose() {
      disposed = true;
      if (draggingBuilding) {
        draggingBuilding = false;
        options.onBuildingDragEnd?.();
      }
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      cardsElement.removeEventListener('pointerdown', onPointerDown);
      cardsElement.removeEventListener('pointermove', onPointerMove);
      cardsElement.removeEventListener('pointerup', finishPointerSelection);
      cardsElement.removeEventListener('pointercancel', cancelPointerSelection);
      selectBestButton.removeEventListener('click', onSelectBestClick);
      formationsElement.removeEventListener('pointerdown', onFormationPointerDown);
      formationsElement.removeEventListener('pointermove', onFormationPointerMove);
      formationsElement.removeEventListener('pointerup', onFormationPointerUp);
      formationsElement.removeEventListener('pointercancel', onFormationPointerCancel);
      formationsElement.removeEventListener('click', onFormationClick);
      hideArrow();
      setStatus('');
      cardsElement.replaceChildren();
      formationsElement.replaceChildren();
      formationsElement.classList.remove('is-visible');
      root.classList.remove('is-active');
    },
  };
}

/** 屏幕坐标是否落在按钮范围内（含边界）。 */
function isInsideRect(rect: DOMRect, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  );
}

/** 松手点是否在 3D 战场上；落在手牌 HUD 里的一律按取消处理。 */
function isOverBattlefield(clientX: number, clientY: number): boolean {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element || element.closest('#solo-hand')) return false;
  return Boolean(element.closest('#app'));
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
