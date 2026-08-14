// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rng } from '@pb/sim';
import { createPokerCards, PokerDeck, type PlayingCard } from '../src/cards/deck.js';
import { createHandPanel, type FormationSpawnRequest } from '../src/ui/handPanel.js';

// jsdom 没有 WebGL，缩略图渲染整体打桩，测试只关心按钮里挂的是图片而不是文字。
vi.mock('../src/view/formationThumbnail.js', () => ({
  getFormationThumbnail: vi.fn(async () => 'data:image/png;base64,thumb'),
  disposeFormationThumbnailRenderer: vi.fn(),
}));

describe('单机手牌交互', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app"><canvas id="battle-canvas"></canvas></div>
      <section id="solo-hand">
        <div id="hand-status"></div>
        <div id="hand-formations"></div>
        <div id="hand-draw-pile">
          <span id="hand-draw-pile-top"></span>
        </div>
        <div id="hand-count"></div>
        <button id="btn-select-best"></button>
        <div id="hand-cards"></div>
      </section>
      <svg id="hand-arrow"><path id="hand-arrow-path"></path><polygon id="hand-arrow-head"></polygon></svg>
    `;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('开局发三张牌，并按调整后的间隔补牌', () => {
    const panel = createHandPanel();

    expect(panel.deck.hand).toHaveLength(3);
    expect(document.querySelectorAll('.playing-card')).toHaveLength(3);
    expect(document.querySelector('#hand-count')?.textContent).toBe('3 / 9');
    expect(document.querySelector('#hand-count')?.classList.contains('is-full')).toBe(false);
    expect(document.querySelector<HTMLElement>('#hand-draw-pile')?.style.getPropertyValue('--draw-progress')).toBe(
      '100%',
    );

    panel.setDrawInterval(0.25);
    panel.update(249);
    expect(panel.deck.hand).toHaveLength(3);
    panel.update(1);
    expect(panel.deck.hand).toHaveLength(4);

    panel.dispose();
  });

  it('新牌从牌堆顶牌出发，手牌满后持续晃动直到恢复补牌', () => {
    const panel = createHandPanel();
    const pile = document.querySelector<HTMLElement>('#hand-draw-pile')!;
    const dealtCards = [...document.querySelectorAll<HTMLElement>('.playing-card.is-dealing')];

    expect(dealtCards).toHaveLength(3);
    for (const card of dealtCards) {
      expect(card.style.getPropertyValue('--deal-from-x')).toBe('0px');
      expect(card.style.getPropertyValue('--deal-from-y')).toBe('0px');
      expect(card.style.getPropertyValue('--deal-hover-y')).toBe('-24px');
    }

    panel.dispose();

    const fullDeck = deckWithCards([
      '3-spades',
      '4-hearts',
      '5-clubs',
      '6-diamonds',
      '7-spades',
      '8-hearts',
      '9-clubs',
      '10-diamonds',
      'J-spades',
    ]);
    const fullPanel = createHandPanel({ deck: fullDeck });
    const handCount = document.querySelector<HTMLElement>('#hand-count')!;
    expect(pile.classList.contains('is-full')).toBe(true);
    expect(pile.style.getPropertyValue('--draw-progress')).toBe('100%');
    expect(handCount.textContent).toBe('手牌已满 9 / 9');
    expect(handCount.classList.contains('is-full')).toBe(true);

    fullDeck.play([fullDeck.hand[0]!.id]);
    fullPanel.syncFromDeck();
    expect(pile.classList.contains('is-full')).toBe(false);
    expect(pile.style.getPropertyValue('--draw-progress')).toBe('100%');
    expect(handCount.textContent).toBe('8 / 9');
    expect(handCount.classList.contains('is-full')).toBe(false);

    fullPanel.dispose();
  });

  it('按下为临时选中，松开后切到正式选中并可点搭配出牌', () => {
    vi.useFakeTimers();
    const onPlay = vi.fn();
    const panel = createHandPanel({ onPlay });
    const firstCard = document.querySelector<HTMLElement>('.playing-card')!;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => firstCard),
    });

    firstCard.dispatchEvent(pointerEvent('pointerdown', 7));
    expect(firstCard.classList.contains('is-preview')).toBe(true);
    expect(firstCard.classList.contains('is-selected')).toBe(false);

    firstCard.dispatchEvent(pointerEvent('pointerup', 7));
    expect(firstCard.classList.contains('is-preview')).toBe(false);
    expect(firstCard.classList.contains('is-selected')).toBe(true);
    expect(document.querySelectorAll('.playing-card.is-preview')).toHaveLength(0);

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    expect(option).toBeTruthy();

    option.click();
    expect(firstCard.classList.contains('is-playing')).toBe(true);
    vi.advanceTimersByTime(360);

    expect(onPlay).toHaveBeenCalledOnce();
    expect(onPlay.mock.calls[0]?.[0]).toHaveLength(1);
    expect(onPlay.mock.calls[0]?.[1]?.id).toBeTruthy();
    expect(panel.deck.hand).toHaveLength(2);
    expect(panel.deck.availableCount).toBe(52);

    panel.dispose();
    expect(document.querySelector('#solo-hand')?.classList.contains('is-active')).toBe(false);
    expect(document.querySelector('#hand-cards')?.children).toHaveLength(0);
    expect(document.querySelector('#hand-formations')?.children).toHaveLength(0);
  });

  it('按住已正式选中的牌时保持拉高，松开后才取消正式选中', () => {
    const panel = createHandPanel();
    const firstCard = document.querySelector<HTMLElement>('.playing-card')!;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => firstCard),
    });

    firstCard.dispatchEvent(pointerEvent('pointerdown', 4));
    firstCard.dispatchEvent(pointerEvent('pointerup', 4));
    expect(firstCard.classList.contains('is-selected')).toBe(true);
    expect(document.querySelector('#hand-formations')?.classList.contains('is-visible')).toBe(true);

    firstCard.dispatchEvent(pointerEvent('pointerdown', 5));
    // 取消模式按住期间显示预览置灰，正式选中拉高等到 pointerup 才撤销。
    expect(firstCard.classList.contains('is-preview')).toBe(true);
    expect(firstCard.classList.contains('is-selected')).toBe(true);

    firstCard.dispatchEvent(pointerEvent('pointerup', 5));
    expect(firstCard.classList.contains('is-preview')).toBe(false);
    expect(firstCard.classList.contains('is-selected')).toBe(false);
    expect(document.querySelector('#hand-formations')?.classList.contains('is-visible')).toBe(false);

    panel.dispose();
  });

  it('选中对子后列出全部搭配，点其中一个即出牌', () => {
    vi.useFakeTimers();
    const onPlay = vi.fn();
    const deck = deckWithCards(['9-spades', '9-hearts', '3-clubs']);
    const panel = createHandPanel({ deck, onPlay });
    const cards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
    const pairCards = cards.filter((element) =>
      ['9-spades', '9-hearts'].includes(element.dataset.cardId ?? ''),
    );
    expect(pairCards).toHaveLength(2);
    const [first, second] = pairCards as [HTMLElement, HTMLElement];
    const hit = vi.fn(() => first);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hit,
    });

    first.dispatchEvent(pointerEvent('pointerdown', 21));
    hit.mockReturnValue(second);
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointermove', 21, 40, 10));
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointerup', 21));

    const formations = document.querySelector('#hand-formations')!;
    expect(formations.classList.contains('is-visible')).toBe(true);
    const options = [...formations.querySelectorAll<HTMLButtonElement>('.formation-option')];
    expect(options.length).toBeGreaterThan(1);

    const chosen = options[0]!;
    chosen.click();
    vi.advanceTimersByTime(360);

    expect(onPlay).toHaveBeenCalledOnce();
    expect(onPlay.mock.calls[0]?.[0].map((card: PlayingCard) => card.id).sort()).toEqual([
      '9-hearts',
      '9-spades',
    ]);
    expect(onPlay.mock.calls[0]?.[1]?.id).toBe(chosen.dataset.formationId);
    expect(panel.deck.hand).toHaveLength(1);

    panel.dispose();
  });

  it('页面上没有出牌按钮，阵型按钮只放缩略图并把说明留给读屏器', async () => {
    const panel = createHandPanel({ deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']) });
    selectAllCards();

    expect(document.querySelector('#btn-play-cards')).toBeNull();
    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    // 缩略图是异步返回的，等一次微任务队列。
    await Promise.resolve();
    await Promise.resolve();
    expect(option.textContent?.trim()).toBe('');
    expect(option.querySelector('img.formation-thumb')?.getAttribute('src')).toBe(
      'data:image/png;base64,thumb',
    );
    const label = option.getAttribute('aria-label') ?? '';
    expect(label).toContain('数字三顺');
    expect(label).toContain('民兵x2');
    expect(label).toContain('弓手x2');

    panel.dispose();
  });

  it('单兵种阵型按钮右下角显示该兵种标签，混编不显示', () => {
    const singlePanel = createHandPanel({ deck: deckWithCards(['3-spades']) });
    selectAllCards();
    const gruntOption = document.querySelector<HTMLButtonElement>(
      '.formation-option[data-formation-id="single_grunt"]',
    );
    const archerOption = document.querySelector<HTMLButtonElement>(
      '.formation-option[data-formation-id="single_archer"]',
    );
    expect(gruntOption?.querySelector('.formation-tag')?.textContent).toBe('近战');
    expect(archerOption?.querySelector('.formation-tag')?.textContent).toBe('远程');
    singlePanel.dispose();

    const mixedPanel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
    });
    selectAllCards();
    expect(document.querySelector('.formation-option .formation-tag')).toBeNull();
    mixedPanel.dispose();
  });

  it('手牌未变时 syncFromDeck 不重建搭配按钮，避免悬停闪烁', () => {
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      externalDraw: true,
    });
    selectAllCards();
    const before = document.querySelector<HTMLButtonElement>('.formation-option')!;
    expect(before).toBeTruthy();

    panel.syncFromDeck();
    panel.syncFromDeck();

    expect(document.querySelector('.formation-option')).toBe(before);
    panel.dispose();
  });

  it('外部发牌倒计时按对局周期归一化遮罩，不被面板本地间隔夹断', () => {
    let remainingMs = 6000;
    // 保留牌堆余量，避免 is-empty 把遮罩强制清零掩盖分母问题。
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    deck.drawMany(3);
    const panel = createHandPanel({
      deck,
      drawIntervalSeconds: 3,
      externalDraw: true,
      getDrawRemainingMs: () => remainingMs,
      getDrawIntervalMs: () => 6000,
    });
    const pile = document.querySelector<HTMLElement>('#hand-draw-pile')!;

    panel.update(0);
    expect(pile.style.getPropertyValue('--draw-progress')).toBe('100%');

    remainingMs = 4500;
    panel.update(0);
    expect(pile.style.getPropertyValue('--draw-progress')).toBe('75%');

    remainingMs = 3000;
    panel.update(0);
    expect(pile.style.getPropertyValue('--draw-progress')).toBe('50%');

    remainingMs = 0;
    panel.update(0);
    expect(pile.style.getPropertyValue('--draw-progress')).toBe('0%');

    panel.dispose();
  });

  it('选中牌拼不出牌型时给出提示', () => {
    const panel = createHandPanel({ deck: deckWithCards(['3-spades', '9-hearts']) });
    selectAllCards();

    expect(document.querySelectorAll('.formation-option')).toHaveLength(0);
    const status = document.querySelector<HTMLElement>('#hand-status')!;
    expect(status.textContent).toBe('未凑成有效牌型');
    expect(status.classList.contains('is-visible')).toBe(true);

    panel.dispose();
  });

  it('选中超过5张牌时提示牌型上限', () => {
    const panel = createHandPanel({
      deck: deckWithCards([
        '3-spades',
        '4-hearts',
        '5-clubs',
        '6-diamonds',
        '7-spades',
        '9-hearts',
      ]),
    });
    selectAllCards();

    expect(document.querySelectorAll('.formation-option')).toHaveLength(0);
    const status = document.querySelector<HTMLElement>('#hand-status')!;
    expect(status.textContent).toBe('牌型最多5张，请减少选牌');
    expect(status.classList.contains('is-visible')).toBe(true);

    panel.dispose();
  });

  it('未拖出按钮时松开走自动放置，不显示指引线', () => {
    vi.useFakeTimers();
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => true);
    const onPlay = vi.fn();
    const onPlaceableHighlightStart = vi.fn();
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      onRequestSpawn,
      onPlay,
      onPlaceableHighlightStart,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;
    const formations = document.querySelector('#hand-formations')!;

    option.dispatchEvent(pointerEvent('pointerdown', 40, 120, 500));
    expect(arrow.classList.contains('is-visible')).toBe(false);
    expect(onPlaceableHighlightStart).not.toHaveBeenCalled();

    formations.dispatchEvent(pointerEvent('pointermove', 40, 130, 500));
    expect(arrow.classList.contains('is-visible')).toBe(false);

    formations.dispatchEvent(pointerEvent('pointerup', 40, 122, 502));
    expect(arrow.classList.contains('is-visible')).toBe(false);
    expect(onRequestSpawn).toHaveBeenCalledOnce();
    expect(onRequestSpawn.mock.calls[0]?.[0]?.point).toBeNull();

    vi.advanceTimersByTime(360);
    expect(onPlay).toHaveBeenCalledOnce();
    expect(panel.deck.hand).toHaveLength(0);

    panel.dispose();
  });

  it('拖出按钮后才显示指引线；拖回按钮变红且松手取消', () => {
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => true);
    const onPlaceableHighlightStart = vi.fn();
    const onPlaceableHighlightEnd = vi.fn();
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      onRequestSpawn,
      onPlaceableHighlightStart,
      onPlaceableHighlightEnd,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;
    const formations = document.querySelector('#hand-formations')!;
    const canvas = document.querySelector('#battle-canvas')!;

    option.dispatchEvent(pointerEvent('pointerdown', 40, 120, 500));
    expect(arrow.classList.contains('is-visible')).toBe(false);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => canvas),
    });
    formations.dispatchEvent(pointerEvent('pointermove', 40, 200, 300));
    expect(onPlaceableHighlightStart).toHaveBeenCalledOnce();
    expect(arrow.classList.contains('is-visible')).toBe(true);
    expect(arrow.classList.contains('is-invalid')).toBe(false);
    // 箭头尖固定朝上：只有平移，不随弧线切线旋转
    expect(document.querySelector('#hand-arrow-head')?.getAttribute('transform')).toBe(
      'translate(200 300)',
    );
    const path = document.querySelector('#hand-arrow-path')?.getAttribute('d') ?? '';
    expect(path).toContain('M ');
    // 控制点在终点正下方（Q 的 y > 终点 y），末端切线朝上
    const quad = path.match(/Q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/);
    expect(quad).toBeTruthy();
    expect(Number(quad![1])).toBe(200);
    expect(Number(quad![2])).toBeGreaterThan(Number(quad![4]));
    expect(Number(quad![3])).toBe(200);
    expect(Number(quad![4])).toBe(300);

    formations.dispatchEvent(pointerEvent('pointermove', 40, 122, 502));
    expect(arrow.classList.contains('is-visible')).toBe(true);
    expect(arrow.classList.contains('is-invalid')).toBe(true);

    formations.dispatchEvent(pointerEvent('pointerup', 40, 122, 502));
    expect(arrow.classList.contains('is-visible')).toBe(false);
    expect(onRequestSpawn).not.toHaveBeenCalled();
    expect(onPlaceableHighlightEnd).toHaveBeenCalledOnce();
    expect(panel.deck.hand).toHaveLength(3);

    panel.dispose();
  });

  it('拖到非法区域时箭头变红，拖回合法落点恢复绿色', () => {
    // null = 按钮内自动放置，视为合法；战场上仅 Y < 400 可放
    const canDropAt = vi.fn(
      (point: { clientX: number; clientY: number } | null, _formation: unknown) =>
        point === null || point.clientY < 400,
    );
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      canDropAt,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;
    const formations = document.querySelector('#hand-formations')!;
    const canvas = document.querySelector('#battle-canvas')!;

    option.dispatchEvent(pointerEvent('pointerdown', 44, 120, 500));
    expect(arrow.classList.contains('is-visible')).toBe(false);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => document.querySelector('#solo-hand')),
    });
    formations.dispatchEvent(pointerEvent('pointermove', 44, 200, 700));
    expect(arrow.classList.contains('is-invalid')).toBe(true);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => canvas),
    });
    formations.dispatchEvent(pointerEvent('pointermove', 44, 200, 300));
    expect(canDropAt).toHaveBeenCalledWith({ clientX: 200, clientY: 300 }, expect.anything());
    expect(arrow.classList.contains('is-invalid')).toBe(false);

    formations.dispatchEvent(pointerEvent('pointermove', 44, 200, 450));
    expect(arrow.classList.contains('is-invalid')).toBe(true);

    formations.dispatchEvent(pointerEvent('pointerup', 44, 200, 450));
    expect(arrow.classList.contains('is-visible')).toBe(false);
    expect(arrow.classList.contains('is-invalid')).toBe(false);

    panel.dispose();
  });

  it('拖到战场松开时带上落点坐标并消耗手牌', () => {
    vi.useFakeTimers();
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => true);
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      onRequestSpawn,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    option.getBoundingClientRect = () => buttonRect();
    dropOn(document.querySelector('#battle-canvas')!, option, 41, 200, 300);

    expect(onRequestSpawn).toHaveBeenCalledOnce();
    expect(onRequestSpawn.mock.calls[0]?.[0]?.point).toEqual({ clientX: 200, clientY: 300 });
    expect(onRequestSpawn.mock.calls[0]?.[0]?.cards).toHaveLength(3);

    vi.advanceTimersByTime(360);
    expect(panel.deck.hand).toHaveLength(0);

    panel.dispose();
  });

  it('落点非法时提示重放，手牌与阵型按钮都保留', () => {
    vi.useFakeTimers();
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => false);
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      onRequestSpawn,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    const formationCount = document.querySelectorAll('.formation-option').length;
    option.getBoundingClientRect = () => buttonRect();
    dropOn(document.querySelector('#battle-canvas')!, option, 42, 200, 300);

    vi.advanceTimersByTime(360);
    expect(panel.deck.hand).toHaveLength(3);
    expect(document.querySelector('#hand-status')?.textContent).toBe('请在白色高亮区域内放置');
    // 非法落点不消耗选牌，阵型按钮应全部保留
    expect(document.querySelectorAll('.formation-option')).toHaveLength(formationCount);

    panel.dispose();
  });

  it('松开在战场之外时取消出兵，不请求落点也不扣牌', () => {
    vi.useFakeTimers();
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => true);
    const panel = createHandPanel({
      deck: deckWithCards(['3-spades', '4-hearts', '5-clubs']),
      onRequestSpawn,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    option.getBoundingClientRect = () => buttonRect();
    dropOn(document.querySelector('#solo-hand')!, option, 43, 200, 700);

    expect(onRequestSpawn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(360);
    expect(panel.deck.hand).toHaveLength(3);
    expect(document.querySelector('#hand-arrow')?.classList.contains('is-visible')).toBe(false);

    panel.dispose();
  });

  it('补牌重渲不会冲掉拖拽或落点提示', () => {
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => false);
    // 先抽满再把 9 打回牌堆：手牌固定为 3-4-5 顺子，牌堆留 1 张供补牌触发重渲
    const ids = ['3-spades', '4-hearts', '5-clubs', '9-diamonds'];
    const all = createPokerCards();
    const cards = ids.map((id) => {
      const found = all.find((card) => card.id === id);
      if (!found) throw new Error(`测试牌不存在：${id}`);
      return found;
    });
    const deck = new PokerDeck(cards, new Rng(1));
    deck.drawMany(4);
    deck.play(['9-diamonds']);
    const panel = createHandPanel({
      deck,
      onRequestSpawn,
      drawIntervalSeconds: 0.25,
    });
    expect(panel.deck.hand).toHaveLength(3);
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>('.formation-option')!;
    option.getBoundingClientRect = () => buttonRect();
    dropOn(document.querySelector('#battle-canvas')!, option, 52, 200, 300);
    expect(document.querySelector('#hand-status')?.textContent).toBe('请在白色高亮区域内放置');

    panel.update(250);
    expect(panel.deck.hand).toHaveLength(4);
    expect(document.querySelector('#hand-status')?.textContent).toBe('请在白色高亮区域内放置');

    panel.dispose();
  });

  it('建筑阵型在按钮内松开或点击都不自动放置，必须拖到战场', () => {
    vi.useFakeTimers();
    const onRequestSpawn = vi.fn((_request: FormationSpawnRequest) => true);
    const onBuildingDragStart = vi.fn();
    const onBuildingDragEnd = vi.fn();
    const panel = createHandPanel({
    deck: deckWithCards(['3-spades', '4-hearts', '5-clubs', '6-diamonds', '7-spades']),
      onRequestSpawn,
      onBuildingDragStart,
      onBuildingDragEnd,
    });
    selectAllCards();

    const option = document.querySelector<HTMLButtonElement>(
      '.formation-option[data-formation-id="straight5_tower"]',
    )!;
    expect(option).toBeTruthy();
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;
    const formations = document.querySelector('#hand-formations')!;

    // 纯点击只提示拖拽，不落成
    option.click();
    expect(onRequestSpawn).not.toHaveBeenCalled();
    expect(document.querySelector('#hand-status')?.textContent).toBe('拖到白色格子上松手放置');

    // 未拖出按钮：不画指引线、不开预览，松开也不自动放置
    option.dispatchEvent(pointerEvent('pointerdown', 50, 120, 500));
    expect(onBuildingDragStart).not.toHaveBeenCalled();
    expect(arrow.classList.contains('is-visible')).toBe(false);

    formations.dispatchEvent(pointerEvent('pointerup', 50, 122, 502));
    expect(onRequestSpawn).not.toHaveBeenCalled();
    expect(onBuildingDragEnd).not.toHaveBeenCalled();
    expect(panel.deck.hand).toHaveLength(5);

    // 拖到战场松手才真正请求落点
    dropOn(document.querySelector('#battle-canvas')!, option, 51, 200, 300);
    expect(onRequestSpawn).toHaveBeenCalledOnce();
    expect(onRequestSpawn.mock.calls[0]?.[0]?.point).toEqual({ clientX: 200, clientY: 300 });

    vi.advanceTimersByTime(360);
    expect(panel.deck.hand).toHaveLength(0);

    panel.dispose();
  });

  it('从已选中牌滑向邻牌时，按下期间全部保持正式选中，松开后一起取消', () => {
    const panel = createHandPanel();
    const cards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
    const [first, second] = cards as [HTMLElement, HTMLElement];
    const hit = vi.fn(() => first);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hit,
    });

    first.dispatchEvent(pointerEvent('pointerdown', 8));
    first.dispatchEvent(pointerEvent('pointerup', 8));
    second.dispatchEvent(pointerEvent('pointerdown', 9));
    second.dispatchEvent(pointerEvent('pointerup', 9));
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(second.classList.contains('is-selected')).toBe(true);

    hit.mockReturnValue(first);
    first.dispatchEvent(pointerEvent('pointerdown', 10));
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(second.classList.contains('is-selected')).toBe(true);

    hit.mockReturnValue(second);
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointermove', 10, 40, 10));
    // 取消模式滑选期间同步预览置灰，正式选中仍保持到松开。
    expect(first.classList.contains('is-preview')).toBe(true);
    expect(second.classList.contains('is-preview')).toBe(true);
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(second.classList.contains('is-selected')).toBe(true);

    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointerup', 10));
    expect(first.classList.contains('is-selected')).toBe(false);
    expect(second.classList.contains('is-selected')).toBe(false);

    panel.dispose();
  });

  it('补牌后留存牌会从旧坐标过渡到新坐标', () => {
    const panel = createHandPanel();
    const cards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
    expect(cards).toHaveLength(3);
    // jsdom 默认矩形全是 0，需伪造屏幕坐标才能触发 FLIP。
    for (const [index, card] of cards.entries()) {
      card.getBoundingClientRect = () =>
        ({
          x: index * 40,
          y: 100,
          left: index * 40,
          top: 100,
          right: index * 40 + 60,
          bottom: 180,
          width: 60,
          height: 80,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    panel.setDrawInterval(0.25);
    panel.update(250);

    const nextCards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
    expect(nextCards).toHaveLength(4);
    const reflowing = nextCards.filter((card) => card.classList.contains('is-reflowing'));
    expect(reflowing.length).toBeGreaterThan(0);
    for (const card of reflowing) {
      expect(card.style.transition).toContain('transform');
    }

    panel.dispose();
  });

  it('滑选前进扩大临时选中区间，往回滑会取消越过的牌', () => {
    const panel = createHandPanel();
    const cards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
    expect(cards).toHaveLength(3);
    const [first, second, third] = cards as [HTMLElement, HTMLElement, HTMLElement];
    const hit = vi.fn(() => first);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hit,
    });

    first.dispatchEvent(pointerEvent('pointerdown', 3));
    expect(first.classList.contains('is-preview')).toBe(true);
    expect(first.classList.contains('is-selected')).toBe(false);

    hit.mockReturnValue(second);
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointermove', 3, 40, 10));
    expect(second.classList.contains('is-preview')).toBe(true);

    hit.mockReturnValue(third);
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointermove', 3, 80, 10));
    expect(third.classList.contains('is-preview')).toBe(true);

    hit.mockReturnValue(first);
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointermove', 3, 10, 10));
    expect(first.classList.contains('is-preview')).toBe(true);
    expect(second.classList.contains('is-preview')).toBe(false);
    expect(third.classList.contains('is-preview')).toBe(false);

    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointerup', 3));
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(second.classList.contains('is-selected')).toBe(false);
    expect(third.classList.contains('is-selected')).toBe(false);

    panel.dispose();
  });

  it('最大牌型按钮清空旧选中并只选中最强合法组合', () => {
    const deck = deckWithCards([
      '6-spades',
      '7-spades',
      '8-spades',
      '9-spades',
      '10-spades',
      '3-hearts',
      '3-clubs',
    ]);
    const panel = createHandPanel({ deck });
    const three = document.querySelector<HTMLElement>('.playing-card[data-card-id="3-hearts"]')!;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => three),
    });

    three.dispatchEvent(pointerEvent('pointerdown', 31));
    three.dispatchEvent(pointerEvent('pointerup', 31));
    expect(three.classList.contains('is-selected')).toBe(true);

    document.querySelector<HTMLButtonElement>('#btn-select-best')!.click();

    const selectedIds = [...document.querySelectorAll<HTMLElement>('.playing-card.is-selected')].map(
      (element) => element.dataset.cardId,
    );
    expect(selectedIds.sort()).toEqual([
      '10-spades',
      '6-spades',
      '7-spades',
      '8-spades',
      '9-spades',
    ]);
    expect(three.classList.contains('is-selected')).toBe(false);

    panel.dispose();
  });

  it('临时选牌按下与划入新牌时都会挂上划过轻晃类', () => {
    const panel = createHandPanel();
    const cards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
    const [first, second] = cards as [HTMLElement, HTMLElement];
    // jsdom 不会播发牌动画，手动结束 is-dealing，否则轻晃会被跳过。
    for (const card of cards) card.classList.remove('is-dealing');
    const hit = vi.fn(() => first);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hit,
    });

    first.dispatchEvent(pointerEvent('pointerdown', 11));
    expect(first.classList.contains('is-wobbling')).toBe(true);

    hit.mockReturnValue(second);
    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointermove', 11, 40, 10));
    expect(second.classList.contains('is-preview')).toBe(true);
    expect(second.classList.contains('is-wobbling')).toBe(true);

    panel.dispose();
  });
});

/** 依次点选当前全部手牌，得到稳定的正式选中集合。 */
function selectAllCards(): void {
  const cards = [...document.querySelectorAll<HTMLElement>('.playing-card')];
  for (const [index, card] of cards.entries()) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => card),
    });
    card.dispatchEvent(pointerEvent('pointerdown', 100 + index));
    card.dispatchEvent(pointerEvent('pointerup', 100 + index));
  }
}

/** jsdom 的矩形恒为 0，阵型按钮需要一个可判定「是否在按钮内」的假范围。 */
function buttonRect(): DOMRect {
  return {
    x: 100,
    y: 480,
    left: 100,
    top: 480,
    right: 150,
    bottom: 530,
    width: 50,
    height: 50,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 从阵型按钮拖到指定元素上松手，落点判定走 elementFromPoint。 */
function dropOn(
  target: Element,
  option: HTMLElement,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  const formations = document.querySelector('#hand-formations')!;
  option.dispatchEvent(pointerEvent('pointerdown', pointerId, 120, 500));
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  });
  formations.dispatchEvent(pointerEvent('pointermove', pointerId, clientX, clientY));
  formations.dispatchEvent(pointerEvent('pointerup', pointerId, clientX, clientY));
}

/** 给 jsdom 的 MouseEvent 补 pointerId，覆盖手牌依赖的最小 PointerEvent 契约。 */
function pointerEvent(type: string, pointerId: number, clientX = 10, clientY = 10): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

/** 构造仅含指定牌的牌堆，并按给定顺序抽到手牌，便于测固定牌型。 */
function deckWithCards(ids: readonly string[]): PokerDeck {
  const all = createPokerCards();
  const cards = ids.map((id) => {
    const found = all.find((card) => card.id === id);
    if (!found) throw new Error(`测试牌不存在：${id}`);
    return found;
  });
  // 固定种子：牌堆仅含目标牌，抽完即可得到确定手牌。
  const deck = new PokerDeck(cards, new Rng(1));
  deck.drawMany(ids.length);
  return deck;
}
