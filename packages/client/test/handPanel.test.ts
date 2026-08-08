// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPanel } from '../src/ui/handPanel.js';

describe('单机手牌交互', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="solo-hand">
        <span id="hand-pile-count"></span>
        <span id="hand-count"></span>
        <span id="hand-draw-countdown"></span>
        <button id="btn-play-cards"></button>
        <div id="hand-cards"></div>
      </section>
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
    expect(document.querySelector('#hand-count')?.textContent).toBe('3/10');

    panel.setDrawInterval(0.25);
    panel.update(249);
    expect(panel.deck.hand).toHaveLength(3);
    panel.update(1);
    expect(panel.deck.hand).toHaveLength(4);

    panel.dispose();
  });

  it('按下为临时选中，松开后切到正式选中并可出牌', () => {
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

    const playButton = document.querySelector<HTMLButtonElement>('#btn-play-cards')!;
    expect(playButton.disabled).toBe(false);

    playButton.click();
    expect(firstCard.classList.contains('is-playing')).toBe(true);
    vi.advanceTimersByTime(360);

    expect(onPlay).toHaveBeenCalledOnce();
    expect(onPlay.mock.calls[0]?.[0]).toHaveLength(1);
    expect(panel.deck.hand).toHaveLength(2);
    expect(panel.deck.availableCount).toBe(52);

    panel.dispose();
    expect(document.querySelector('#solo-hand')?.classList.contains('is-active')).toBe(false);
    expect(document.querySelector('#hand-cards')?.children).toHaveLength(0);
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

    firstCard.dispatchEvent(pointerEvent('pointerdown', 5));
    // 取消模式按住期间显示预览置灰，正式选中拉高等到 pointerup 才撤销。
    expect(firstCard.classList.contains('is-preview')).toBe(true);
    expect(firstCard.classList.contains('is-selected')).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#btn-play-cards')?.disabled).toBe(false);

    firstCard.dispatchEvent(pointerEvent('pointerup', 5));
    expect(firstCard.classList.contains('is-preview')).toBe(false);
    expect(firstCard.classList.contains('is-selected')).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#btn-play-cards')?.disabled).toBe(true);

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

/** 给 jsdom 的 MouseEvent 补 pointerId，覆盖手牌依赖的最小 PointerEvent 契约。 */
function pointerEvent(type: string, pointerId: number, clientX = 10, clientY = 10): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
