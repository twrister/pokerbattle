// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHandGuide,
  shouldShowHandGuide,
  type HandGuideContext,
} from '../src/ui/handGuide.js';
import type { PlayerProfileStats } from '../src/account/types.js';

/** 手牌区与按钮区的固定布局，便于断言手指落点。 */
const CARDS_RECT = { left: 100, top: 700, width: 200, height: 200 };
const FIRST_CARD_RECT = { left: 110, top: 720, width: 60, height: 120 };
const LAST_CARD_RECT = { left: 230, top: 720, width: 60, height: 120 };
const FORMATION_RECT = { left: 150, top: 600, width: 100, height: 80 };
const BATTLE_RECT = { left: 0, top: 0, width: 720, height: 1280 };

/** 造一个带 getBoundingClientRect 的元素；jsdom 不做布局，只能靠桩。 */
function fakeRect(rect: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect;
}

/** 空闲满一轮后的默认上下文：没选牌、没阵型按钮。 */
const IDLE_CONTEXT: HandGuideContext = {
  canGuide: true,
  hasSelection: false,
  formationVisible: false,
};

let finger: HTMLElement;
let cards: HTMLElement;
let formations: HTMLElement;
let battlefield: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="app"></div>
    <div id="hand-formations"></div>
    <div id="hand-cards">
      <button class="playing-card" data-card-id="a"></button>
      <button class="playing-card" data-card-id="b"></button>
    </div>
    <div id="hand-guide-finger"></div>
  `;
  finger = document.querySelector<HTMLElement>('#hand-guide-finger')!;
  cards = document.querySelector<HTMLElement>('#hand-cards')!;
  formations = document.querySelector<HTMLElement>('#hand-formations')!;
  battlefield = document.querySelector<HTMLElement>('#app')!;

  cards.getBoundingClientRect = () => fakeRect(CARDS_RECT);
  battlefield.getBoundingClientRect = () => fakeRect(BATTLE_RECT);
  const cardElements = [...cards.querySelectorAll<HTMLElement>('.playing-card')];
  cardElements[0]!.getBoundingClientRect = () => fakeRect(FIRST_CARD_RECT);
  cardElements[1]!.getBoundingClientRect = () => fakeRect(LAST_CARD_RECT);
  // jsdom 没有 Web Animations：桩掉 animate，只为验证确实播了一轮关键帧
  finger.animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 建一个已挂上默认元素的手势引导器。 */
function createGuide(enabled = true) {
  return createHandGuide({ enabled, cardsElement: cards, formationsElement: formations, battlefieldElement: battlefield });
}

/** 造一份档案统计，未传的字段补 0。 */
function stats(partial: Partial<PlayerProfileStats> = {}): PlayerProfileStats {
  return { wins: 0, losses: 0, draws: 0, stageAttempts: 0, stageClears: 0, ...partial };
}

describe('手牌弱引导', () => {
  it('空闲不足 6 秒不提示，满了才播点选手势', () => {
    const guide = createGuide();

    guide.tick(5999, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(false);

    guide.tick(1, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(true);
    expect(finger.classList.contains('is-tap')).toBe(true);
    expect(finger.animate).toHaveBeenCalledOnce();

    guide.dispose();
  });

  it('点选手势落在第一张牌中心且原地不动', () => {
    const guide = createGuide();

    guide.tick(6000, IDLE_CONTEXT);
    const keyframes = (finger.animate as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Keyframe[];
    // 手指尺寸为 0 时按 36 兜底半宽居中：首张牌中心 (140, 780)
    for (const keyframe of keyframes) {
      expect(String(keyframe.transform)).toContain('translate(104px, 744px)');
    }

    guide.dispose();
  });

  it('已选出有效牌型时改播拖拽手势，落点在战场内', () => {
    const guide = createGuide();

    guide.tick(6000, { canGuide: true, hasSelection: true, formationVisible: false });
    // 选中但拼不出牌型：不提示，避免教错动作
    expect(finger.classList.contains('is-visible')).toBe(false);

    formations.innerHTML = '<button class="formation-option" data-formation-id="pair"></button>';
    formations.querySelector<HTMLElement>('.formation-option')!.getBoundingClientRect = () =>
      fakeRect(FORMATION_RECT);
    guide.tick(1, { canGuide: true, hasSelection: true, formationVisible: true });

    expect(finger.classList.contains('is-visible')).toBe(true);
    expect(finger.classList.contains('is-drag')).toBe(true);
    const keyframes = (finger.animate as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Keyframe[];
    const first = String(keyframes[0]?.transform);
    const last = String(keyframes[keyframes.length - 1]?.transform);
    expect(first).toContain('translate(164px');
    // 720 宽居中 x=360，1280 高的 58% 处 y≈742.4，换算成左上角要减半宽
    expect(last).toContain('translate(324px');
    expect(last).toContain('706.4px');

    guide.dispose();
  });

  it('玩家一操作就立刻收起并重新计时', () => {
    const guide = createGuide();

    guide.tick(6000, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(true);

    guide.notifyInteraction();
    expect(finger.classList.contains('is-visible')).toBe(false);

    guide.tick(5999, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(false);
    guide.tick(1, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(true);

    guide.dispose();
  });

  it('一轮播完后收起，再空闲 6 秒重新播一次', () => {
    const guide = createGuide();

    guide.tick(6000, IDLE_CONTEXT);
    // 点选手势：淡入 + 按下 + 原地停顿 + 淡出，没有位移段
    const total = 180 + 200 + 520 + 240;
    vi.advanceTimersByTime(total);
    expect(finger.classList.contains('is-visible')).toBe(false);

    guide.tick(total, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(false);
    guide.tick(6000, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(true);
    expect(finger.animate).toHaveBeenCalledTimes(2);

    guide.dispose();
  });

  it('不允许引导时不计时也不显示', () => {
    const guide = createGuide();

    guide.tick(30000, { canGuide: false, hasSelection: false, formationVisible: false });
    expect(finger.classList.contains('is-visible')).toBe(false);

    guide.dispose();
  });

  it('未启用时整块降级，不碰手指节点', () => {
    const guide = createGuide(false);

    guide.tick(60000, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(false);
    expect(finger.animate).not.toHaveBeenCalled();

    guide.dispose();
  });

  it('只有一张手牌时也播点选手势', () => {
    const guide = createGuide();
    const cardElements = [...cards.querySelectorAll<HTMLElement>('.playing-card')];
    cardElements[1]!.remove();

    guide.tick(6000, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(true);
    expect(finger.classList.contains('is-tap')).toBe(true);

    guide.dispose();
  });

  it('手上没有牌时不提示', () => {
    const guide = createGuide();
    cards.replaceChildren();

    guide.tick(30000, IDLE_CONTEXT);
    expect(finger.classList.contains('is-visible')).toBe(false);
    expect(finger.animate).not.toHaveBeenCalled();

    guide.dispose();
  });
});

describe('弱引导启用范围', () => {
  it('战役只在前三关教学关提示，第 4 关起的残局不提示', () => {
    expect(shouldShowHandGuide({ index: 1 }, stats())).toBe(true);
    expect(shouldShowHandGuide({ index: 2 }, stats())).toBe(true);
    expect(shouldShowHandGuide({ index: 3 }, stats())).toBe(true);
    expect(shouldShowHandGuide({ index: 4 }, stats())).toBe(false);
    expect(shouldShowHandGuide({ index: 7 }, stats())).toBe(false);
  });

  it('普通人机只在完全没有战绩时提示', () => {
    expect(shouldShowHandGuide(null, stats())).toBe(true);
    expect(shouldShowHandGuide(null, stats({ wins: 1 }))).toBe(false);
    expect(shouldShowHandGuide(null, stats({ draws: 1 }))).toBe(false);
    expect(shouldShowHandGuide(null, stats({ stageAttempts: 1 }))).toBe(false);
  });
});
