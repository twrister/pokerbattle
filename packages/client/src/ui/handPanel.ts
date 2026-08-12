import {
  detectHandCategories,
  findStrongestHand,
  getFormationsFor,
  isGiantBombFormation,
  isBuildingOnlyFormation,
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  UNIT_CONFIGS,
  UNIT_LEVELS_ENABLED,
  type CardFormation,
  type PlayingCard,
  type UnitTypeId,
} from '@pb/sim';
import { cardImageUrl } from '../cards/cardImageUrl.js';
import { getFormationThumbnail } from '../view/formationThumbnail.js';

const PLAY_ANIMATION_MS = 360;
/** 手牌增删后，留存牌从旧坐标滑到新坐标的时长。 */
const LAYOUT_MOVE_MS = 280;
const MIN_DRAW_INTERVAL_MS = 250;
/** 选了牌但拼不出牌型时的提示。 */
const STATUS_NO_CATEGORY = '未凑成有效牌型';
/** 选中超过牌型上限（5 张）时的提示。 */
const STATUS_TOO_MANY_CARDS = '牌型最多5张，请减少选牌';
/** 拖到战场但整阵越界时的提示。 */
const STATUS_INVALID_DROP = '请在己方半场内放置完整阵型';
/** 拖拽建筑阵型时的操作提示。 */
const STATUS_BUILDING_DRAG = '拖到白色格子上松手放置';
/** 单次出牌可识别的牌型最多张数。 */
const MAX_CATEGORY_CARDS = 5;
/** 箭头弧顶相对首尾连线的最大抬高像素。 */
const ARROW_MAX_LIFT = 180;

/**
 * 一次出兵请求；point 为拖拽落点屏幕坐标。
 * 非建筑阵型点按钮自动放置时为 null；单建筑阵型必须带战场落点。
 */
export interface FormationSpawnRequest {
  formation: CardFormation;
  cards: readonly PlayingCard[];
  point: { clientX: number; clientY: number } | null;
}

export interface HandPanelOptions {
  drawIntervalSeconds?: number;
  deck?: PokerDeck;
  /**
   * 抽牌由 MatchState tick 驱动时设为 true：update 不再按墙钟抽牌。
   * 可配合 getDrawRemainingMs 显示倒计时。
   */
  externalDraw?: boolean;
  /** 出牌扣牌由 MatchState.step 负责时设为 true，避免与面板本地 deck.play 双重消耗。 */
  externalCardConsume?: boolean;
  /** 外部倒计时（毫秒）；提供则覆盖内部 remainingMs 显示。 */
  getDrawRemainingMs?: () => number;
  /**
   * 外部补牌周期（毫秒）；与 getDrawRemainingMs 配对时用作遮罩分母。
   * 未提供时回退到面板本地 drawIntervalMs（仅本地墙钟抽牌路径）。
   */
  getDrawIntervalMs?: () => number;
  /** 请求出兵；返回 false 表示落点非法，手牌不消耗、阵型按钮保留以便重试。 */
  onRequestSpawn?: (request: FormationSpawnRequest) => boolean;
  /**
   * 拖拽时校验落点是否可放置；point 为 null 表示非建筑的按钮内自动放置。
   * 未提供时：按钮内/战场上视为可放，其余区域为非法。
   */
  canDropAt?: (
    point: { clientX: number; clientY: number } | null,
    formation: CardFormation,
  ) => boolean;
  /** 开始拖拽单建筑阵型：进入放置预览（白色格）。 */
  onBuildingDragStart?: (formation: CardFormation) => void;
  /** 拖拽建筑时同步吸附预览位置。 */
  onBuildingDragMove?: (clientX: number, clientY: number) => void;
  /** 结束建筑拖拽（松手或取消）：卸下白色格预览。 */
  onBuildingDragEnd?: () => void;
  /** 开始拖拽巨型炸弹：显示全图范围落点预览。 */
  onAoeDragStart?: (formation: CardFormation) => void;
  /** 拖拽巨型炸弹时同步范围落点预览。 */
  onAoeDragMove?: (clientX: number, clientY: number) => void;
  /** 结束巨型炸弹拖拽：移除范围落点预览。 */
  onAoeDragEnd?: () => void;
  /** 非建筑阵型持续拖拽 0.5 秒后：显示场地可放置区域。 */
  onPlaceableHighlightStart?: (formation: CardFormation) => void;
  /** 非建筑阵型拖拽结束或取消：隐藏场地可放置区域。 */
  onPlaceableHighlightEnd?: () => void;
  /** 出兵成功且出牌动画结束后的回调。 */
  onPlay?: (cards: readonly PlayingCard[], formation: CardFormation | null) => void;
}

export interface HandPanelHandle {
  readonly deck: PokerDeck;
  update: (deltaMs: number) => void;
  setDrawInterval: (seconds: number) => void;
  /** MatchState 步进后同步手牌 DOM（外部抽牌/扣牌时用）。 */
  syncFromDeck: () => void;
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
  const drawPile = required<HTMLElement>('#hand-draw-pile');
  const drawPileTop = required<HTMLElement>('#hand-draw-pile-top');
  const fullHint = required<HTMLElement>('#hand-full-hint');
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
  /**
   * 上次 syncFromDeck/render 同步过的手牌 id 序列。
   * MatchState 每 tick 都会调 syncFromDeck，手牌未变时跳过重建，避免搭配按钮 :hover 闪烁。
   */
  let lastSyncedHandSignature = '';
  /**
   * 上次渲染的阵型按钮签名（含显隐）。
   * syncSelection 较频繁，列表未变时保留 DOM，避免悬停态被 replaceChildren 冲掉。
   */
  let lastFormationRenderKey = '';
  /** 正在拖拽的阵型 id；null 表示当前没有出兵手势。 */
  let dragFormationId: string | null = null;
  let dragPointerId: number | null = null;
  /** 按下时的按钮范围：在其内松开视为「原地自动放置」。 */
  let dragButtonRect: DOMRect | null = null;
  /** 指针手势已处理过一次放置，抑制紧随其后的合成 click。 */
  let suppressClick = false;
  /** 当前拖拽是否为单建筑阵型（决定是否走绿格预览）。 */
  let draggingBuilding = false;
  let draggingAoe = false;
  /**
   * 拖拽/落点等操作提示；有值时优先于选牌提示。
   * 发牌与 syncSelection 只走 refreshStatus，不会冲掉这里的文案。
   */
  let actionStatus: string | null = null;

  root.classList.add('is-active');
  // MatchState 已发过初始手牌时不要再抽，否则两端牌面会分叉
  if (deck.hand.length === 0) {
    deck.drawMany(INITIAL_HAND_SIZE);
  }
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
      setActionStatus(STATUS_INVALID_DROP);
      return false;
    }

    setActionStatus(null);
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
      // 联机/MatchState：扣牌已在 step 内完成，这里只清 UI 状态
      const playedCards = options.externalCardConsume
        ? cards
        : deck.play(playedIds);
      for (const card of playedCards) knownCardIds.delete(card.id);
      for (const id of playedIds) knownCardIds.delete(id);
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

  /** 按下阵型按钮：捕获指针并开始画拖拽箭头；建筑则立刻进入白色格放置预览。 */
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
    draggingAoe = isGiantBombFormation(formation);
    formationsElement.setPointerCapture(event.pointerId);
    drawArrow(event.clientX, event.clientY);
    if (draggingBuilding) {
      options.onBuildingDragStart?.(formation);
      options.onBuildingDragMove?.(event.clientX, event.clientY);
      setActionStatus(STATUS_BUILDING_DRAG);
    } else if (draggingAoe) {
      options.onAoeDragStart?.(formation);
      options.onAoeDragMove?.(event.clientX, event.clientY);
    } else {
      options.onPlaceableHighlightStart?.(formation);
    }
  };

  const onFormationPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    drawArrow(event.clientX, event.clientY);
    if (draggingBuilding) options.onBuildingDragMove?.(event.clientX, event.clientY);
    else if (draggingAoe) options.onAoeDragMove?.(event.clientX, event.clientY);
  };

  /**
   * 松手判定：非建筑在按钮内 = 自动放置；建筑必须拖到战场松手，按钮内/场外一律取消。
   * 建筑在按下时已进入预览；先落成再卸绿格，避免预览先 dispose 导致校验脱节。
   */
  const onFormationPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    const formation = formations.find((entry) => entry.id === dragFormationId) ?? null;
    const buttonRect = dragButtonRect;
    const wasBuilding = draggingBuilding;
    const wasAoe = draggingAoe;
    const clientX = event.clientX;
    const clientY = event.clientY;
    suppressClick = true;
    if (!formation) {
      endFormationDrag(event.pointerId);
      return;
    }

    if (buttonRect && isInsideRect(buttonRect, clientX, clientY)) {
      // 建筑禁止点击/按钮内自动放置，必须拖到绿格上松手
      if (wasBuilding || wasAoe) setActionStatus(null);
      else requestPlay(formation, null);
    } else if (isOverBattlefield(clientX, clientY)) {
      requestPlay(formation, { clientX, clientY });
    } else if (wasBuilding || wasAoe) {
      setActionStatus(null);
    }
    endFormationDrag(event.pointerId);
  };

  const onFormationPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    endFormationDrag(event.pointerId);
    setActionStatus(null);
  };

  /**
   * 非建筑：键盘/辅助技术触发的点击等价于自动放置。
   * 建筑：只提示拖拽，不落成；指针手势已处理过的 click 直接吞掉。
   */
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
    if (!formation) return;
    if (isBuildingOnlyFormation(formation) || isGiantBombFormation(formation)) {
      setActionStatus(STATUS_BUILDING_DRAG);
      return;
    }
    requestPlay(formation, null);
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

  /** 结束一次出兵手势：释放指针捕获、卸建筑白色格预览并收起箭头。 */
  function endFormationDrag(pointerId: number): void {
    if (formationsElement.hasPointerCapture(pointerId)) {
      formationsElement.releasePointerCapture(pointerId);
    }
    const wasBuilding = draggingBuilding;
    const wasAoe = draggingAoe;
    dragFormationId = null;
    dragPointerId = null;
    dragButtonRect = null;
    draggingBuilding = false;
    draggingAoe = false;
    hideArrow();
    if (wasBuilding) options.onBuildingDragEnd?.();
    else if (wasAoe) options.onAoeDragEnd?.();
    else options.onPlaceableHighlightEnd?.();
  }

  /**
   * 从按钮中心向指针画弧线；控制点放在终点正下方，使二次贝塞尔末端切线始终朝上，
   * 箭头尖也固定朝上。非法落点时整条箭头变红。
   */
  function drawArrow(toX: number, toY: number): void {
    if (!dragButtonRect) return;
    const fromX = dragButtonRect.left + dragButtonRect.width / 2;
    const fromY = dragButtonRect.top + dragButtonRect.height / 2;
    // 二次贝塞尔末端切线方向为 P2−P1；控制点在终点下方即可保证切线朝屏幕上方
    const approach = Math.min(Math.hypot(toX - fromX, toY - fromY) * 0.45, ARROW_MAX_LIFT) + 40;
    const controlX = toX;
    const controlY = toY + approach;
    arrowPath.setAttribute('d', `M ${fromX} ${fromY} Q ${controlX} ${controlY} ${toX} ${toY}`);
    arrowHead.setAttribute('transform', `translate(${toX} ${toY})`);
    arrowLayer.classList.toggle('is-invalid', !isArrowDropValid(toX, toY));
    arrowLayer.classList.add('is-visible');
  }

  /** 当前拖拽落点是否可放置：非建筑可在按钮内自动放置；建筑仅战场坐标可放。 */
  function isArrowDropValid(clientX: number, clientY: number): boolean {
    const formation = formations.find((entry) => entry.id === dragFormationId) ?? null;
    if (!formation || !dragButtonRect) return false;
    if (isInsideRect(dragButtonRect, clientX, clientY)) {
      // 建筑没有自动落点，停留在按钮上视为非法
      if (isBuildingOnlyFormation(formation) || isGiantBombFormation(formation)) return false;
      return options.canDropAt?.(null, formation) !== false;
    }
    if (!isOverBattlefield(clientX, clientY)) return false;
    return options.canDropAt?.({ clientX, clientY }, formation) !== false;
  }

  function hideArrow(): void {
    arrowLayer.classList.remove('is-visible', 'is-invalid');
    arrowPath.removeAttribute('d');
  }

  /** 设置/清除操作提示，再与选牌提示合并刷新。 */
  function setActionStatus(text: string | null): void {
    actionStatus = text && text.length > 0 ? text : null;
    refreshStatus();
  }

  /**
   * 刷新 #hand-status：操作提示优先，否则按选牌张数/牌型给出提示。
   * 发牌重渲只应调用本函数，避免冲掉拖拽/落点文案。
   */
  function refreshStatus(): void {
    let selectionStatus = '';
    if (!playing && selected.size > MAX_CATEGORY_CARDS) {
      selectionStatus = STATUS_TOO_MANY_CARDS;
    } else if (!playing && selected.size > 0 && formations.length === 0) {
      selectionStatus = STATUS_NO_CATEGORY;
    }
    const text = actionStatus ?? selectionStatus;
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

  /** 手牌 id 有序列表，用作外部同步是否需要重建 DOM 的判据。 */
  function handSignature(): string {
    return deck.hand.map((card) => card.id).join('\0');
  }

  /** 把每张新牌的初始变换定位到牌堆顶牌中心，使布局缩放后动画起点仍准确。 */
  function setDealOrigins(): void {
    const source = drawPileTop.getBoundingClientRect();
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + source.height / 2;
    for (const cardElement of cardsElement.querySelectorAll<HTMLElement>('.playing-card.is-dealing')) {
      const target = cardElement.getBoundingClientRect();
      cardElement.style.setProperty('--deal-from-x', `${sourceX - target.left - target.width / 2}px`);
      cardElement.style.setProperty('--deal-from-y', `${sourceY - target.top - target.height / 2}px`);
      // 至少保留固定悬停高度，避免布局尚未完成时下落阶段失去层次。
      const hoverHeight = Math.round(Math.max(24, target.height * 0.22));
      cardElement.style.setProperty('--deal-hover-y', `-${hoverHeight}px`);
    }
  }

  /** 重建最多九张牌的轻量 DOM，并只给本次新牌附加翻转发牌动画。 */
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
            <img src="${cardImageUrl(card)}" alt="${card.label}" draggable="false" />
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
    lastSyncedHandSignature = handSignature();
    syncStatus();
    // 先恢复选中拉高，再量新坐标，避免 FLIP 把选中态高度差算进去。
    syncSelection();
    setDealOrigins();
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
    renderFormations(false);
    selectBestButton.disabled = playing || deck.hand.length === 0;
    refreshStatus();
  }

  /** 根据正式选中牌识别牌型并列出兵种搭配按钮（只放 3D 缩略图，说明走 aria-label）。 */
  function renderFormations(force: boolean): void {
    const selectedCards = deck.hand.filter((card) => selected.has(card.id));
    const categories = detectHandCategories(selectedCards);
    formations = getFormationsFor(categories, selectedCards);
    const visible = formations.length > 0 && !playing;
    const renderKey = visible
      ? formations
          .map((formation) =>
            [
              formation.id,
              formation.slots.map((slot) => `${slot.typeId}:${slot.level}:${slot.row}:${slot.col}`).join(','),
            ].join('#'),
          )
          .join('\0')
      : '';
    // 列表未变时保留按钮节点，否则每 tick/每次 syncSelection 都会打断 :hover。
    if (!force && renderKey === lastFormationRenderKey) {
      formationsElement.classList.toggle('is-visible', visible);
      return;
    }
    lastFormationRenderKey = renderKey;
    formationsElement.replaceChildren();
    formationsElement.classList.toggle('is-visible', visible);
    const generation = ++thumbnailGeneration;
    if (!visible) return;

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

  /** 同步牌堆补牌进度；满手时以持续晃动替代倒计时，避免误导玩家仍会抽牌。 */
  function syncStatus(): void {
    const ms = options.getDrawRemainingMs?.() ?? remainingMs;
    // 联机/MatchState 路径必须用阶段表间隔，否则会按调试默认 3s 夹断 6s 倒计时。
    const intervalMs = Math.max(options.getDrawIntervalMs?.() ?? drawIntervalMs, 1);
    const handCount = deck.hand.length;
    const isFull = handCount >= MAX_HAND_SIZE;
    const isEmpty = deck.availableCount === 0;
    // 剩余时间从 1 递减到 0，供牌堆由顶向下收缩黑色遮罩；满手保持满遮罩，空堆则无遮罩。
    const progress = isFull
      ? 1
      : isEmpty
        ? 0
        : Math.min(Math.max(ms, 0), intervalMs) / intervalMs;
    drawPile.style.setProperty('--draw-progress', `${progress * 100}%`);
    drawPile.classList.toggle('is-full', isFull);
    drawPile.classList.toggle('is-empty', isEmpty);
    drawPile.setAttribute(
      'aria-label',
      isFull ? '手牌已满，牌堆等待出牌' : isEmpty ? '牌堆已空' : '牌堆正在准备补牌',
    );
    // 满手时在牌堆旁明示上限张数，引导玩家先出牌腾出手牌位。
    fullHint.textContent = isFull ? `手牌已满${handCount}张` : '';
    fullHint.classList.toggle('is-visible', isFull);
  }

  return {
    deck,
    update(deltaMs: number) {
      if (disposed) {
        syncStatus();
        return;
      }
      // MatchState 负责抽牌时只刷新倒计时文案
      if (options.externalDraw) {
        syncStatus();
        return;
      }
      if (playing || deck.hand.length >= MAX_HAND_SIZE) {
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
    syncFromDeck() {
      if (disposed || playing) {
        syncStatus();
        return;
      }
      // 仅倒计时/牌数变化时不要整页重建，否则搭配按钮会每 tick 闪一次。
      if (handSignature() === lastSyncedHandSignature) {
        syncStatus();
        return;
      }
      // 清空重发后旧选中可能已不在手中，先剔除再渲染，避免幽灵选中挡出兵。
      for (const id of [...selected]) {
        if (!deck.hasInHand(id)) selected.delete(id);
      }
      for (const id of [...preview]) {
        if (!deck.hasInHand(id)) preview.delete(id);
      }
      render();
    },
    refreshFormations() {
      renderFormations(true);
    },
    dispose() {
      disposed = true;
      if (draggingBuilding) {
        draggingBuilding = false;
        options.onBuildingDragEnd?.();
      } else if (draggingAoe) {
        draggingAoe = false;
        options.onAoeDragEnd?.();
      } else if (dragPointerId !== null) {
        options.onPlaceableHighlightEnd?.();
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
      setActionStatus(null);
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

/** 把阵型 rows 格式化为「前：民兵x2 / 后：弓手x2」，突出前后站位。 */
function formatFormationUnits(formation: CardFormation): string {
  if (formation.rows.length === 0) return '';
  if (formation.rows.length === 1) {
    return formatRowUnits(formation, 0);
  }
  return formation.rows
    .map((_row, index) => {
      const label = index === 0 ? '前' : index === formation.rows.length - 1 ? '后' : `排${index + 1}`;
      return `${label}：${formatRowUnits(formation, index)}`;
    })
    .join(' / ');
}

/** 单排兵种短标签，如「民兵x2 · 弓手x1」。 */
function formatRowUnits(formation: CardFormation, rowIndex: number): string {
  const counts = new Map<string, number>();
  const order: Array<{ typeId: UnitTypeId; level: number }> = [];
  for (const slot of formation.slots.filter((entry) => entry.row === rowIndex)) {
    const key = `${slot.typeId}:${slot.level}`;
    if (!counts.has(key)) order.push({ typeId: slot.typeId, level: slot.level });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order
    .map(({ typeId, level }) => {
      const name = UNIT_CONFIGS[typeId]?.name.replace(/（.*?）/, '') ?? typeId;
      // 等级关闭时不展示「N级」前缀，避免全是 1 级的噪音。
      return UNIT_LEVELS_ENABLED
        ? `${level}级${name}x${counts.get(`${typeId}:${level}`)}`
        : `${name}x${counts.get(`${typeId}:${level}`)}`;
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
