import {
  detectHandCategories,
  listRecommendHands,
  getExclusiveFormationUnitTag,
  getFormationSpecialTier,
  getFormationsFor,
  isFuseBombFormation,
  isBuildingOnlyFormation,
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  UNIT_CONFIGS,
  type CardFormation,
  type PlayingCard,
  type UnitTypeId,
} from '@pb/sim';
import { cardImageUrl } from '../cards/cardImageUrl.js';
import {
  appendFormationBombDamage,
  fuseBombDisplayDamage,
  withBombDamageAriaLabel,
} from './formationBombDamage.js';
import { appendFormationTag, applyFormationNameFallback } from './formationTag.js';
import { getFormationThumbnail } from '../view/formationThumbnail.js';

const PLAY_ANIMATION_MS = 360;
/** 手牌增删后，留存牌从旧坐标滑到新坐标的时长。 */
const LAYOUT_MOVE_MS = 280;
const MIN_DRAW_INTERVAL_MS = 250;
/** 倒计时已接近周期末尾的比例；配合剩余时间回升，判定刚走过一次发牌点。 */
const DRAW_WRAP_NEAR_ZERO_RATIO = 0.2;
/** 选了牌但拼不出牌型时的提示。 */
const STATUS_NO_CATEGORY = '未凑成有效牌型';
/** 选中超过牌型上限（5 张）时的提示。 */
const STATUS_TOO_MANY_CARDS = '牌型最多5张，请减少选牌';
/** 拖到战场但落点不在白色部署区时的提示。 */
const STATUS_INVALID_DROP = '请在白色高亮区域内放置';
/** 拖拽建筑阵型时的操作提示。 */
const STATUS_BUILDING_DRAG = '拖到白色格子上松手放置';
/** 单次出牌可识别的牌型最多张数。 */
const MAX_CATEGORY_CARDS = 5;
/** 循环切换可凑牌型时的按钮文案。 */
const LABEL_SELECT_BEST = '推荐';
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
  /** 当前阶段手牌上限；未提供时回退到 MAX_HAND_SIZE。 */
  getMaxHandSize?: () => number;
  /**
   * 外部权威待发标记。提供后不再用倒计时回绕猜测晃动，
   * 避免冲掉 pending 重开读条时被误判成又一次发牌失败。
   */
  getHasPendingDraw?: () => boolean;
  /**
   * 新牌飞入起点（屏幕客户区坐标）。
   * 返回 null 时仍从牌堆顶飞出；城堡保护领牌时改为卡包屏幕位置。
   */
  getDealOrigin?: () => { x: number; y: number } | null;
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
  /** 非建筑阵型拖出按钮后：显示场地可放置区域。 */
  onPlaceableHighlightStart?: (formation: CardFormation) => void;
  /** 非建筑阵型拖拽时同步指针（攻击范围圈跟手）。 */
  onPlaceableHighlightMove?: (clientX: number, clientY: number) => void;
  /** 非建筑阵型拖拽结束或取消：隐藏场地可放置区域。 */
  onPlaceableHighlightEnd?: () => void;
  /** 出兵成功且出牌动画结束后的回调。 */
  onPlay?: (cards: readonly PlayingCard[], formation: CardFormation | null) => void;
}

export interface HandPanelHandle {
  readonly deck: PokerDeck;
  update: (deltaMs: number) => void;
  setDrawInterval: (seconds: number) => void;
  /** 基地陷落后灰罩并禁止出牌。 */
  setPlayLocked: (locked: boolean) => void;
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
  const handCountLabel = required<HTMLElement>('#hand-count');
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
  /** 基地陷落后锁定出牌。 */
  let playLocked = false;
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
   * 推荐循环缓存：手牌一变就作废，避免补牌后还从上一手的弱档接着切。
   * index 为上次点推荐选中的档；-1 表示尚未推荐过。
   */
  let recommendCacheSignature = '';
  let recommendCacheIndex = -1;
  /**
   * 上次渲染的阵型按钮签名（含显隐）。
   * syncSelection 较频繁，列表未变时保留 DOM，避免悬停态被 replaceChildren 冲掉。
   */
  let lastFormationRenderKey = '';
  /** 正在拖拽的阵型 id；null 表示当前没有出兵手势。 */
  let dragFormationId: string | null = null;
  let dragPointerId: number | null = null;
  /** 按下时的按钮范围：从未拖出时在其内松开视为自动放置。 */
  let dragButtonRect: DOMRect | null = null;
  /** 指针是否已拖出按钮：出现指引线后，按钮内不再是可放置区，松手等于取消。 */
  let dragLeftButton = false;
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
  let lastHandCountText = '';
  /** undefined 表示尚未写入 DOM，避免复用节点时跳过清理上一局残留 class。 */
  let lastHandFull: boolean | undefined;
  let lastPileFull: boolean | undefined;
  let lastPileEmpty: boolean | undefined;
  let lastPileLabel = '';
  /** 发牌周期到达仍满手时才晃；刚凑满手牌时只继续走下一张进度。 */
  let blockedDrawShake = false;
  let lastRemainingMs: number | undefined;
  let lastHandWasFull = false;

  // #solo-hand 是跨局复用的节点；上一局败方锁定会留下 is-play-locked（pointer-events:none），
  // 不先清掉的话新手牌面板看起来能亮、实际点不了牌。
  root.classList.remove('is-play-locked');
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
    if (playLocked || playing || selected.size === 0 || formations.length === 0) return false;
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
      // 出牌动画结束后再冲待发，避免和飞出动画抢同一帧手牌 DOM。
      tryFlushPendingDraw();
      render();
    }, PLAY_ANIMATION_MS);
    pendingTimers.add(timer);
    return true;
  };

  /**
   * 点推荐优先当前最大牌型；已选中最大档或刚推过的档则顺延。
   * 中途划选未提交时先丢掉预览，避免和正式选中叠在一起。
   */
  const onSelectBestClick = (): void => {
    if (playing) return;
    clearPreview();
    pointerId = null;
    dragAnchorIndex = null;
    syncRecommendCacheWithHand();
    const options = listRecommendHands(deck.hand);
    if (options.length === 0) return;
    const cached = recommendCacheIndex >= 0 ? options[recommendCacheIndex] : undefined;
    let next = 0;
    if (cached && isSameSelectedCards(cached.cards)) {
      next = (recommendCacheIndex + 1) % options.length;
    } else if (isSameSelectedCards(options[0]!.cards)) {
      next = options.length > 1 ? 1 : 0;
    }
    recommendCacheIndex = next;
    recommendCacheSignature = handSignature();
    selected.clear();
    for (const card of options[next]!.cards) selected.add(card.id);
    syncSelection();
  };

  /** 手牌组成变了就丢掉上一圈的推荐档位。 */
  function resetRecommendCache(): void {
    recommendCacheSignature = '';
    recommendCacheIndex = -1;
  }

  /** 手牌签名与缓存不一致时重置，保证补牌/出牌后重新从最大牌型起。 */
  function syncRecommendCacheWithHand(): void {
    const signature = handSignature();
    if (signature === recommendCacheSignature) return;
    resetRecommendCache();
    recommendCacheSignature = signature;
  }

  /** 正式选中是否正好等于这组牌（同一组牌，与张数/顺序无关）。 */
  function isSameSelectedCards(cards: readonly PlayingCard[]): boolean {
    if (cards.length === 0 || selected.size !== cards.length) return false;
    return cards.every((card) => selected.has(card.id));
  }

  /** 推荐按钮固定文案；空手牌或出牌中禁用。 */
  function syncSelectBestButton(): void {
    selectBestButton.textContent = LABEL_SELECT_BEST;
    selectBestButton.disabled = playing || deck.hand.length === 0;
  }

  /** 按下阵型按钮：只捕获指针。指引线与场地预览要等拖出按钮后才出现。 */
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
    dragLeftButton = false;
    draggingBuilding = isBuildingOnlyFormation(formation);
    draggingAoe = isFuseBombFormation(formation);
    formationsElement.setPointerCapture(event.pointerId);
  };

  const onFormationPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    updateAiming(event.clientX, event.clientY);
  };

  /**
   * 松手判定：从未拖出按钮时，非建筑走自动放置；已出现指引线后再回到按钮 = 取消。
   * 建筑/炸弹没有自动落点，按钮内一律取消。先落成再卸预览，避免校验脱节。
   */
  const onFormationPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    const formation = formations.find((entry) => entry.id === dragFormationId) ?? null;
    const buttonRect = dragButtonRect;
    const wasBuilding = draggingBuilding;
    const wasAoe = draggingAoe;
    const leftButton = dragLeftButton;
    const clientX = event.clientX;
    const clientY = event.clientY;
    suppressClick = true;
    if (!formation) {
      endFormationDrag(event.pointerId);
      return;
    }

    if (buttonRect && isInsideRect(buttonRect, clientX, clientY)) {
      // 已拖出再回来，或建筑/炸弹：按钮内松手只取消
      if (leftButton || wasBuilding || wasAoe) setActionStatus(null);
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
    if (isBuildingOnlyFormation(formation) || isFuseBombFormation(formation)) {
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

  /** 结束一次出兵手势：释放指针捕获、卸已开启的场地预览并收起箭头。 */
  function endFormationDrag(pointerId: number): void {
    if (formationsElement.hasPointerCapture(pointerId)) {
      formationsElement.releasePointerCapture(pointerId);
    }
    const wasAiming = dragLeftButton;
    const wasBuilding = draggingBuilding;
    const wasAoe = draggingAoe;
    dragFormationId = null;
    dragPointerId = null;
    dragButtonRect = null;
    dragLeftButton = false;
    draggingBuilding = false;
    draggingAoe = false;
    hideArrow();
    // 从未拖出按钮则没开过预览，避免 End 无配对 Start
    if (!wasAiming) return;
    if (wasBuilding) options.onBuildingDragEnd?.();
    else if (wasAoe) options.onAoeDragEnd?.();
    else options.onPlaceableHighlightEnd?.();
  }

  /**
   * 拖出按钮后才进入瞄准：开场地预览并画指引线。
   * 未离开时保持静默，方便按钮内松开走自动放置。
   */
  function updateAiming(clientX: number, clientY: number): void {
    if (!dragLeftButton) {
      beginAiming(clientX, clientY);
      return;
    }
    drawArrow(clientX, clientY);
    if (draggingBuilding) options.onBuildingDragMove?.(clientX, clientY);
    else if (draggingAoe) options.onAoeDragMove?.(clientX, clientY);
    else options.onPlaceableHighlightMove?.(clientX, clientY);
  }

  /** 首次拖出按钮：锁定瞄准态，之后回到按钮也只显示红色取消指引。 */
  function beginAiming(clientX: number, clientY: number): void {
    if (dragLeftButton || !dragButtonRect) return;
    if (isInsideRect(dragButtonRect, clientX, clientY)) return;
    dragLeftButton = true;
    const formation = formations.find((entry) => entry.id === dragFormationId) ?? null;
    if (!formation) return;
    if (draggingBuilding) {
      options.onBuildingDragStart?.(formation);
      options.onBuildingDragMove?.(clientX, clientY);
      setActionStatus(STATUS_BUILDING_DRAG);
    } else if (draggingAoe) {
      options.onAoeDragStart?.(formation);
      options.onAoeDragMove?.(clientX, clientY);
    } else {
      options.onPlaceableHighlightStart?.(formation);
      options.onPlaceableHighlightMove?.(clientX, clientY);
    }
    drawArrow(clientX, clientY);
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

  /** 当前拖拽落点是否可放置：指引线出现后按钮区一律非法，只认战场坐标。 */
  function isArrowDropValid(clientX: number, clientY: number): boolean {
    const formation = formations.find((entry) => entry.id === dragFormationId) ?? null;
    if (!formation || !dragButtonRect) return false;
    // 已拖出后再回到按钮 = 取消区，指引线保持红色
    if (isInsideRect(dragButtonRect, clientX, clientY)) return false;
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
      cardElement.style.transform = `translate(${dx}px, ${dy}px) translateY(var(--card-lift)) rotate(calc((var(--card-index) - var(--fan-center)) * 0.35deg))`;
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

  /** 把每张新牌的初始变换定位到牌堆顶或自定义起点，使布局缩放后动画起点仍准确。 */
  function setDealOrigins(): void {
    const custom = options.getDealOrigin?.() ?? null;
    const source = drawPileTop.getBoundingClientRect();
    const sourceX = custom?.x ?? source.left + source.width / 2;
    const sourceY = custom?.y ?? source.top + source.height / 2;
    for (const cardElement of cardsElement.querySelectorAll<HTMLElement>('.playing-card.is-dealing')) {
      const target = cardElement.getBoundingClientRect();
      cardElement.style.setProperty('--deal-from-x', `${sourceX - target.left - target.width / 2}px`);
      cardElement.style.setProperty('--deal-from-y', `${sourceY - target.top - target.height / 2}px`);
      // 至少保留固定悬停高度，避免布局尚未完成时下落阶段失去层次。
      const hoverHeight = Math.round(Math.max(24, target.height * 0.22));
      cardElement.style.setProperty('--deal-hover-y', `-${hoverHeight}px`);
    }
  }

  /** 把张数和扇形中心写到容器，供 CSS 按可用宽加大重叠。 */
  function syncHandLayoutVars(): void {
    const count = deck.hand.length;
    cardsElement.style.setProperty('--hand-count', String(count));
    cardsElement.style.setProperty('--fan-center', String(count > 0 ? (count - 1) / 2 : 0));
  }

  /** 重建手牌 DOM，并只给本次新牌附加翻转发牌动画。 */
  function render(): void {
    syncRecommendCacheWithHand();
    const previousRects = captureCardRects();
    syncHandLayoutVars();
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
    syncSelectBestButton();
    refreshStatus();
  }

  /** 根据正式选中牌识别牌型并列出兵种搭配按钮（3D 缩略图；炸弹另叠伤害）。 */
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
              formation.slots.map((slot) => `${slot.typeId}:${slot.row}:${slot.col}`).join(','),
              getExclusiveFormationUnitTag(formation),
              getFormationSpecialTier(formation) ?? '',
              fuseBombDisplayDamage(formation, selectedCards) ?? '',
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
      button.className = formationOptionClassName(formation);
      button.dataset.formationId = formation.id;
      const damage = fuseBombDisplayDamage(formation, selectedCards);
      button.setAttribute(
        'aria-label',
        withBombDamageAriaLabel(`${formation.name}：${formatFormationUnits(formation)}`, damage),
      );
      const image = document.createElement('img');
      image.className = 'formation-thumb';
      image.alt = '';
      image.draggable = false;
      button.appendChild(image);
      appendFormationTag(button, formation);
      appendFormationBombDamage(button, formation, selectedCards);
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
    applyFormationNameFallback(button, formation.name);
  }

  /** 牌堆节点跨对局复用，离开时必须卸下满手晃动，否则新局面板会当成「本来就未满」而跳过清理。 */
  function resetDrawPilePresentation(): void {
    drawPile.classList.remove('is-full', 'is-empty');
    drawPile.style.removeProperty('--draw-progress');
    drawPile.setAttribute('aria-label', '牌堆正在准备补牌');
    handCountLabel.classList.remove('is-full');
    lastHandCountText = '';
    lastHandFull = undefined;
    lastPileFull = undefined;
    lastPileEmpty = undefined;
    lastPileLabel = '';
    blockedDrawShake = false;
    lastRemainingMs = undefined;
    lastHandWasFull = false;
  }

  /**
   * 本地墙钟路径：满手待发且出现空位时立刻抽一张，并从满格重开读条。
   * 外部抽牌由 MatchState 同帧冲 pending，这里不能再抽，否则两端牌面会分叉。
   */
  function tryFlushPendingDraw(): boolean {
    if (options.externalDraw || !blockedDrawShake) return false;
    const maxHandSize = Math.max(1, options.getMaxHandSize?.() ?? MAX_HAND_SIZE);
    if (deck.hand.length >= maxHandSize) return false;
    const drawn = deck.draw();
    blockedDrawShake = false;
    remainingMs = drawIntervalMs;
    return Boolean(drawn);
  }

  /** 同步牌堆补牌进度；待发晃动时收起黑罩，空堆同样无遮罩。 */
  function syncStatus(): void {
    const ms = options.getDrawRemainingMs?.() ?? remainingMs;
    // 联机/MatchState 路径必须用阶段表间隔，否则会按调试默认夹断倒计时。
    const intervalMs = Math.max(options.getDrawIntervalMs?.() ?? drawIntervalMs, 1);
    const maxHandSize = Math.max(1, options.getMaxHandSize?.() ?? MAX_HAND_SIZE);
    const handCount = deck.hand.length;
    const isFull = handCount >= maxHandSize;
    const isEmpty = deck.availableCount === 0;
    if (options.getHasPendingDraw) {
      blockedDrawShake = options.getHasPendingDraw();
    } else if (!isFull) {
      blockedDrawShake = false;
    } else if (lastHandWasFull && didDrawCycleWrap(lastRemainingMs, ms, intervalMs)) {
      // 上一帧已满且倒计时刚回绕：本周期发牌被满手拦截。
      blockedDrawShake = true;
    }
    lastHandWasFull = isFull;
    lastRemainingMs = ms;
    // 晃动代表待发卡住，黑罩应收起；空堆同样不盖遮罩。
    const progress = blockedDrawShake || isEmpty
      ? 0
      : Math.min(Math.max(ms, 0), intervalMs) / intervalMs;
    drawPile.style.setProperty('--draw-progress', `${progress * 100}%`);
    if (lastPileFull !== blockedDrawShake) {
      drawPile.classList.toggle('is-full', blockedDrawShake);
      lastPileFull = blockedDrawShake;
    }
    if (lastPileEmpty !== isEmpty) {
      drawPile.classList.toggle('is-empty', isEmpty);
      lastPileEmpty = isEmpty;
    }
    const pileLabel = blockedDrawShake
      ? '手牌已满，牌堆等待出牌'
      : isEmpty
        ? '牌堆已空'
        : '牌堆正在准备补牌';
    if (lastPileLabel !== pileLabel) {
      drawPile.setAttribute('aria-label', pileLabel);
      lastPileLabel = pileLabel;
    }
    // 张数与满手提示共用一条：未满只报 x/x，满手加「已满」并改提示色。
    const countText = isFull
      ? `手牌已满 ${handCount} / ${maxHandSize}`
      : `${handCount} / ${maxHandSize}`;
    if (lastHandCountText !== countText) {
      handCountLabel.textContent = countText;
      lastHandCountText = countText;
    }
    if (lastHandFull !== isFull) {
      handCountLabel.classList.toggle('is-full', isFull);
      lastHandFull = isFull;
    }
  }

  return {
    deck,
    update(deltaMs: number) {
      if (disposed) return;
      // MatchState 负责抽牌时只刷新倒计时文案
      if (options.externalDraw) {
        syncStatus();
        return;
      }
      if (playing) {
        syncStatus();
        return;
      }
      if (tryFlushPendingDraw()) {
        render();
        return;
      }
      // 待发未冲掉：停表并保持晃动，不再倒数以免黑罩重新刷一遍。
      if (blockedDrawShake) {
        syncStatus();
        return;
      }
      remainingMs -= Math.max(deltaMs, 0);
      if (remainingMs <= 0) {
        const drawn = deck.draw();
        remainingMs += drawIntervalMs;
        if (drawn) {
          render();
          return;
        }
        // 满手拒抽才晃；牌堆抽空返回 undefined 时只刷新进度。
        if (deck.hand.length >= (options.getMaxHandSize?.() ?? MAX_HAND_SIZE)) {
          blockedDrawShake = true;
        }
        syncStatus();
      } else {
        syncStatus();
      }
    },
    setPlayLocked(locked: boolean) {
      playLocked = locked;
      root.classList.toggle('is-play-locked', locked);
      if (locked) {
        selected.clear();
        setActionStatus('基地陷落 · 停止发牌');
      }
      syncStatus();
    },
    setDrawInterval(seconds: number) {
      const nextInterval = toIntervalMs(seconds);
      drawIntervalMs = nextInterval;
      remainingMs = Math.min(remainingMs, nextInterval);
      syncStatus();
    },
    syncFromDeck() {
      if (disposed) return;
      if (playing) {
        syncStatus();
        return;
      }
      if (tryFlushPendingDraw()) {
        render();
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
      if (dragLeftButton) {
        if (draggingBuilding) options.onBuildingDragEnd?.();
        else if (draggingAoe) options.onAoeDragEnd?.();
        else options.onPlaceableHighlightEnd?.();
      }
      draggingBuilding = false;
      draggingAoe = false;
      dragLeftButton = false;
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      cardsElement.removeEventListener('pointerdown', onPointerDown);
      cardsElement.removeEventListener('pointermove', onPointerMove);
      cardsElement.removeEventListener('pointerup', finishPointerSelection);
      cardsElement.removeEventListener('pointercancel', cancelPointerSelection);
      selectBestButton.removeEventListener('click', onSelectBestClick);
      selectBestButton.textContent = LABEL_SELECT_BEST;
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
      root.classList.remove('is-active', 'is-play-locked');
      resetDrawPilePresentation();
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
  const counts = new Map<UnitTypeId, number>();
  const order: UnitTypeId[] = [];
  for (const slot of formation.slots.filter((entry) => entry.row === rowIndex)) {
    if (!counts.has(slot.typeId)) order.push(slot.typeId);
    counts.set(slot.typeId, (counts.get(slot.typeId) ?? 0) + 1);
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

/** 剩余时间从接近 0 回升，视为刚走过一次发牌点。 */
function didDrawCycleWrap(prevMs: number | undefined, nextMs: number, intervalMs: number): boolean {
  if (prevMs === undefined) return false;
  return prevMs <= intervalMs * DRAW_WRAP_NEAR_ZERO_RATIO && nextMs > prevMs;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`手牌 HUD 缺少元素：${selector}`);
  return element;
}

/** 独占特殊兵种按档位着色；混编保持默认绿色。 */
function formationOptionClassName(formation: CardFormation): string {
  const tier = getFormationSpecialTier(formation);
  return tier ? `formation-option is-tier-${tier}` : 'formation-option';
}
