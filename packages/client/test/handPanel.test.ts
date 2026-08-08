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
    // 按下仅进入取消预览，正式选中与拉高都要等到 pointerup 才撤销。
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
    expect(first.classList.contains('is-preview')).toBe(true);
    expect(second.classList.contains('is-preview')).toBe(true);
    expect(first.classList.contains('is-selected')).toBe(true);
    expect(second.classList.contains('is-selected')).toBe(true);

    document.querySelector('#hand-cards')!.dispatchEvent(pointerEvent('pointerup', 10));
    expect(first.classList.contains('is-selected')).toBe(false);
    expect(second.classList.contains('is-selected')).toBe(false);

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
});

/** 给 jsdom 的 MouseEvent 补 pointerId，覆盖手牌依赖的最小 PointerEvent 契约。 */
function pointerEvent(type: string, pointerId: number, clientX = 10, clientY = 10): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
