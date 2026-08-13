// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableDebugUnitDrag } from '../src/ui/debugUnitDrag.js';

describe('调试模式单兵种拖拽上场', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app"><canvas id="battle-canvas"></canvas></div>
      <div id="hud">
        <div id="panel-bottom-dock">
          <div id="unit-group">
            <button type="button" data-unit="melee_grunt">民兵</button>
            <button type="button" data-unit="ranged_archer">弓手</button>
            <button type="button" data-unit="giant_bomb">巨型炸弹</button>
          </div>
        </div>
      </div>
      <svg id="hand-arrow"><path id="hand-arrow-path"></path><polygon id="hand-arrow-head"></polygon></svg>
    `;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('在按钮内松开走自动放置，拖拽期间显示箭头', () => {
    const onRequestSpawn = vi.fn(() => true);
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const handle = enableDebugUnitDrag({
      unitGroup: unitGroup(),
      onPickUnit: vi.fn(),
      canDropAt: () => true,
      onRequestSpawn,
      onDragStart,
      onDragEnd,
    });

    const option = gruntButton();
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;

    option.dispatchEvent(pointerEvent('pointerdown', 40, 120, 500));
    expect(onDragStart).toHaveBeenCalledWith('melee_grunt');
    expect(arrow.classList.contains('is-visible')).toBe(true);
    expect(arrow.classList.contains('is-invalid')).toBe(false);
    expect(document.querySelector('#hand-arrow-head')?.getAttribute('transform')).toBe(
      'translate(120 500)',
    );

    unitGroup().dispatchEvent(pointerEvent('pointermove', 40, 130, 480));
    const path = document.querySelector('#hand-arrow-path')?.getAttribute('d') ?? '';
    const quad = path.match(/Q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/);
    expect(quad).toBeTruthy();
    expect(Number(quad![2])).toBeGreaterThan(Number(quad![4]));

    unitGroup().dispatchEvent(pointerEvent('pointerup', 40, 122, 502));
    expect(arrow.classList.contains('is-visible')).toBe(false);
    expect(onRequestSpawn).toHaveBeenCalledOnce();
    expect(onRequestSpawn).toHaveBeenCalledWith('melee_grunt', null);
    expect(onDragEnd).toHaveBeenCalledOnce();

    handle.dispose();
  });

  it('拖到战场松开时带上落点坐标', () => {
    const onRequestSpawn = vi.fn(() => true);
    const handle = enableDebugUnitDrag({
      unitGroup: unitGroup(),
      onPickUnit: vi.fn(),
      canDropAt: () => true,
      onRequestSpawn,
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
    });

    const option = gruntButton();
    option.getBoundingClientRect = () => buttonRect();
    dropOn(document.querySelector('#battle-canvas')!, option, 41, 200, 300);

    expect(onRequestSpawn).toHaveBeenCalledOnce();
    expect(onRequestSpawn).toHaveBeenCalledWith('melee_grunt', { clientX: 200, clientY: 300 });

    handle.dispose();
  });

  it('拖到非法区域时箭头变红，拖回合法落点恢复绿色', () => {
    const canDropAt = vi.fn(
      (_typeId: string, point: { clientX: number; clientY: number } | null) =>
        point === null || point.clientY < 400,
    );
    const handle = enableDebugUnitDrag({
      unitGroup: unitGroup(),
      onPickUnit: vi.fn(),
      canDropAt,
      onRequestSpawn: vi.fn(() => true),
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
    });

    const option = gruntButton();
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;
    const canvas = document.querySelector('#battle-canvas')!;

    option.dispatchEvent(pointerEvent('pointerdown', 44, 120, 500));
    expect(arrow.classList.contains('is-invalid')).toBe(false);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => document.querySelector('#panel-bottom-dock')),
    });
    unitGroup().dispatchEvent(pointerEvent('pointermove', 44, 200, 700));
    expect(arrow.classList.contains('is-invalid')).toBe(true);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => canvas),
    });
    unitGroup().dispatchEvent(pointerEvent('pointermove', 44, 200, 300));
    expect(canDropAt).toHaveBeenCalledWith('melee_grunt', { clientX: 200, clientY: 300 });
    expect(arrow.classList.contains('is-invalid')).toBe(false);

    unitGroup().dispatchEvent(pointerEvent('pointermove', 44, 200, 450));
    expect(arrow.classList.contains('is-invalid')).toBe(true);

    unitGroup().dispatchEvent(pointerEvent('pointerup', 44, 200, 450));
    expect(arrow.classList.contains('is-visible')).toBe(false);
    expect(arrow.classList.contains('is-invalid')).toBe(false);

    handle.dispose();
  });

  it('落点非法时不吞掉后续重试', () => {
    const onRequestSpawn = vi.fn(() => false);
    const handle = enableDebugUnitDrag({
      unitGroup: unitGroup(),
      onPickUnit: vi.fn(),
      canDropAt: () => true,
      onRequestSpawn,
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
    });

    const option = gruntButton();
    option.getBoundingClientRect = () => buttonRect();
    dropOn(document.querySelector('#battle-canvas')!, option, 41, 200, 300);
    expect(onRequestSpawn).toHaveBeenCalledOnce();

    dropOn(document.querySelector('#battle-canvas')!, option, 42, 180, 280);
    expect(onRequestSpawn).toHaveBeenCalledTimes(2);

    handle.dispose();
  });

  it('炸弹在按钮内松开不放置且箭头为非法，拖到战场才带落点', () => {
    const canDropAt = vi.fn(
      (typeId: string, point: { clientX: number; clientY: number } | null) =>
        typeId !== 'giant_bomb' || point !== null,
    );
    const onRequestSpawn = vi.fn(() => true);
    const onDragMove = vi.fn();
    const handle = enableDebugUnitDrag({
      unitGroup: unitGroup(),
      onPickUnit: vi.fn(),
      canDropAt,
      onRequestSpawn,
      onDragStart: vi.fn(),
      onDragMove,
      onDragEnd: vi.fn(),
    });

    const option = bombButton();
    option.getBoundingClientRect = () => buttonRect();
    const arrow = document.querySelector('#hand-arrow')!;

    option.dispatchEvent(pointerEvent('pointerdown', 50, 120, 500));
    expect(arrow.classList.contains('is-invalid')).toBe(true);
    expect(onDragMove).toHaveBeenCalledWith('giant_bomb', 120, 500);

    unitGroup().dispatchEvent(pointerEvent('pointerup', 50, 122, 502));
    expect(onRequestSpawn).not.toHaveBeenCalled();
    expect(arrow.classList.contains('is-visible')).toBe(false);

    dropOn(document.querySelector('#battle-canvas')!, option, 51, 200, 300);
    expect(onRequestSpawn).toHaveBeenCalledOnce();
    expect(onRequestSpawn).toHaveBeenCalledWith('giant_bomb', { clientX: 200, clientY: 300 });

    handle.dispose();
  });
});

function unitGroup(): HTMLElement {
  return document.querySelector('#unit-group')!;
}

function gruntButton(): HTMLButtonElement {
  return document.querySelector('button[data-unit="melee_grunt"]')!;
}

function bombButton(): HTMLButtonElement {
  return document.querySelector('button[data-unit="giant_bomb"]')!;
}

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

/** 从兵种按钮拖到指定元素上松手，落点判定走 elementFromPoint。 */
function dropOn(
  target: Element,
  option: HTMLElement,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  option.dispatchEvent(pointerEvent('pointerdown', pointerId, 120, 500));
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  });
  unitGroup().dispatchEvent(pointerEvent('pointermove', pointerId, clientX, clientY));
  unitGroup().dispatchEvent(pointerEvent('pointerup', pointerId, clientX, clientY));
}

function pointerEvent(type: string, pointerId: number, clientX = 10, clientY = 10): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
