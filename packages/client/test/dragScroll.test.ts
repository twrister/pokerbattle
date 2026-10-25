// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { enableDragScroll } from '../src/ui/dragScroll.js';

describe('拖拽滚动', () => {
  let host: HTMLElement;
  let inner: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="host">
        <button id="inner" type="button">条目</button>
      </div>
    `;
    host = document.querySelector<HTMLElement>('#host')!;
    inner = document.querySelector<HTMLButtonElement>('#inner')!;
    // jsdom 不做布局，手动给出可滚动高度
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 200 });
    host.scrollTop = 100;
  });

  it('拖动内容会滚动容器并进入拖拽态', () => {
    enableDragScroll(host);
    host.dispatchEvent(pointerEvent('pointerdown', 1, 20, 200));
    host.dispatchEvent(pointerEvent('pointermove', 1, 20, 150));

    expect(host.scrollTop).toBe(150);
    expect(host.classList.contains('is-dragging')).toBe(true);

    host.dispatchEvent(pointerEvent('pointerup', 1, 20, 150));
    expect(host.classList.contains('is-dragging')).toBe(false);
  });

  it('位移未超过阈值不滚动，短按仍可点击内部按钮', () => {
    enableDragScroll(host);
    let clicks = 0;
    inner.addEventListener('click', () => clicks += 1);

    host.dispatchEvent(pointerEvent('pointerdown', 1, 20, 200));
    host.dispatchEvent(pointerEvent('pointermove', 1, 20, 197));
    expect(host.scrollTop).toBe(100);
    expect(host.classList.contains('is-dragging')).toBe(false);

    inner.dispatchEvent(pointerEvent('pointerup', 1, 20, 197));
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it('拖拽收尾补发的 click 被拦下，不会误触内部按钮', () => {
    enableDragScroll(host);
    let clicks = 0;
    inner.addEventListener('click', () => clicks += 1);

    host.dispatchEvent(pointerEvent('pointerdown', 1, 20, 200));
    host.dispatchEvent(pointerEvent('pointermove', 1, 20, 140));
    inner.dispatchEvent(pointerEvent('pointerup', 1, 20, 140));
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(0);

    // 下一次独立点击恢复正常
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it('内容不足以滚动时不接管手势', () => {
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 200 });
    enableDragScroll(host);
    host.dispatchEvent(pointerEvent('pointerdown', 1, 20, 200));
    host.dispatchEvent(pointerEvent('pointermove', 1, 20, 100));
    expect(host.scrollTop).toBe(100);
    expect(host.classList.contains('is-dragging')).toBe(false);
  });

  it('ignoreSelector 命中的元素不参与拖拽', () => {
    document.body.innerHTML = `
      <div id="host"><textarea id="inner"></textarea></div>
    `;
    host = document.querySelector<HTMLElement>('#host')!;
    const textarea = document.querySelector<HTMLTextAreaElement>('#inner')!;
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 200 });
    host.scrollTop = 100;

    enableDragScroll(host, { ignoreSelector: 'textarea' });
    textarea.dispatchEvent(pointerEvent('pointerdown', 1, 20, 200));
    host.dispatchEvent(pointerEvent('pointermove', 1, 20, 100));
    expect(host.scrollTop).toBe(100);
  });

  it('解绑后不再响应拖拽', () => {
    const stop = enableDragScroll(host);
    stop();
    host.dispatchEvent(pointerEvent('pointerdown', 1, 20, 200));
    host.dispatchEvent(pointerEvent('pointermove', 1, 20, 100));
    expect(host.scrollTop).toBe(100);
    expect(host.classList.contains('is-dragging')).toBe(false);
  });
});

/** 给 jsdom 的 MouseEvent 补 pointerId，覆盖拖拽滚动的最小 PointerEvent 契约。 */
function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
