import type { UnitTypeId } from '@pb/sim';

/** 箭头弧顶相对首尾连线的最大抬高像素，与手牌阵型拖拽保持一致。 */
const ARROW_MAX_LIFT = 180;

export interface DebugUnitDragPoint {
  clientX: number;
  clientY: number;
}

export interface DebugUnitDragOptions {
  /** 兵种按钮容器，事件绑在这里以便指针捕获后仍能收到 move/up。 */
  unitGroup: HTMLElement;
  /** 按下时同步面板选中态。 */
  onPickUnit: (typeId: UnitTypeId) => void;
  /** 当前落点是否可放；point 为 null 表示按钮内自动放置。 */
  canDropAt: (typeId: UnitTypeId, point: DebugUnitDragPoint | null) => boolean;
  /** 请求出兵；失败时保留按钮，玩家可换位置再拖。 */
  onRequestSpawn: (typeId: UnitTypeId, point: DebugUnitDragPoint | null) => boolean;
  /** 开始拖拽：普通兵开半场高亮，炸弹开 AOE 圈。 */
  onDragStart: (typeId: UnitTypeId) => void;
  /** 拖拽移动：炸弹同步 AOE 预览圆心。 */
  onDragMove?: (typeId: UnitTypeId, clientX: number, clientY: number) => void;
  /** 结束拖拽：应收起部署区 / AOE 预览。 */
  onDragEnd: () => void;
}

export interface DebugUnitDragHandle {
  dispose: () => void;
}

/**
 * 调试模式放兵手势：与手牌阵型按钮相同——按下画箭头并高亮半场，
 * 按钮内松开自动放置，拖到战场松手按落点放置。
 */
export function enableDebugUnitDrag(options: DebugUnitDragOptions): DebugUnitDragHandle {
  const { unitGroup } = options;
  const arrowLayer = required<SVGElement>('#hand-arrow');
  const arrowPath = required<SVGPathElement>('#hand-arrow-path');
  const arrowHead = required<SVGPolygonElement>('#hand-arrow-head');

  let dragTypeId: UnitTypeId | null = null;
  let dragPointerId: number | null = null;
  let dragButtonRect: DOMRect | null = null;
  let suppressClick = false;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const button = targetUnitButton(event);
    const typeId = readTypeId(button);
    if (!button || !typeId) return;
    event.preventDefault();
    dragTypeId = typeId;
    dragPointerId = event.pointerId;
    dragButtonRect = button.getBoundingClientRect();
    unitGroup.setPointerCapture(event.pointerId);
    options.onPickUnit(typeId);
    drawArrow(event.clientX, event.clientY);
    options.onDragStart(typeId);
    options.onDragMove?.(typeId, event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    drawArrow(event.clientX, event.clientY);
    if (dragTypeId) options.onDragMove?.(dragTypeId, event.clientX, event.clientY);
  };

  /** 松手判定与阵型一致：按钮内 = 自动放置（炸弹禁止）；战场上按落点；其余取消。 */
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    const typeId = dragTypeId;
    const buttonRect = dragButtonRect;
    const clientX = event.clientX;
    const clientY = event.clientY;
    suppressClick = true;
    if (!typeId) {
      endDrag(event.pointerId);
      return;
    }

    if (buttonRect && isInsideRect(buttonRect, clientX, clientY)) {
      // 炸弹没有自动落点，按钮内松开只取消，与阵型拖拽一致
      if (options.canDropAt(typeId, null)) options.onRequestSpawn(typeId, null);
    } else if (isOverBattlefield(clientX, clientY)) {
      options.onRequestSpawn(typeId, { clientX, clientY });
    }
    endDrag(event.pointerId);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointerId) return;
    endDrag(event.pointerId);
  };

  /** 键盘/辅助技术点击等价于自动放置；指针手势已处理过的 click 直接吞掉。 */
  const onClick = (event: Event): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const button = targetUnitButton(event);
    const typeId = readTypeId(button);
    if (!typeId) return;
    options.onPickUnit(typeId);
    if (options.canDropAt(typeId, null)) options.onRequestSpawn(typeId, null);
  };

  unitGroup.addEventListener('pointerdown', onPointerDown);
  unitGroup.addEventListener('pointermove', onPointerMove);
  unitGroup.addEventListener('pointerup', onPointerUp);
  unitGroup.addEventListener('pointercancel', onPointerCancel);
  unitGroup.addEventListener('click', onClick);

  function endDrag(pointerId: number): void {
    if (unitGroup.hasPointerCapture(pointerId)) {
      unitGroup.releasePointerCapture(pointerId);
    }
    dragTypeId = null;
    dragPointerId = null;
    dragButtonRect = null;
    hideArrow();
    options.onDragEnd();
  }

  /**
   * 从按钮中心向指针画弧线；控制点放在终点正下方，使二次贝塞尔末端切线始终朝上。
   * 非法落点时整条箭头变红。
   */
  function drawArrow(toX: number, toY: number): void {
    if (!dragButtonRect) return;
    const fromX = dragButtonRect.left + dragButtonRect.width / 2;
    const fromY = dragButtonRect.top + dragButtonRect.height / 2;
    const approach = Math.min(Math.hypot(toX - fromX, toY - fromY) * 0.45, ARROW_MAX_LIFT) + 40;
    const controlX = toX;
    const controlY = toY + approach;
    arrowPath.setAttribute('d', `M ${fromX} ${fromY} Q ${controlX} ${controlY} ${toX} ${toY}`);
    arrowHead.setAttribute('transform', `translate(${toX} ${toY})`);
    arrowLayer.classList.toggle('is-invalid', !isArrowDropValid(toX, toY));
    arrowLayer.classList.add('is-visible');
  }

  function isArrowDropValid(clientX: number, clientY: number): boolean {
    if (!dragTypeId || !dragButtonRect) return false;
    if (isInsideRect(dragButtonRect, clientX, clientY)) {
      return options.canDropAt(dragTypeId, null);
    }
    if (!isOverBattlefield(clientX, clientY)) return false;
    return options.canDropAt(dragTypeId, { clientX, clientY });
  }

  function hideArrow(): void {
    arrowLayer.classList.remove('is-visible', 'is-invalid');
    arrowPath.removeAttribute('d');
  }

  return {
    dispose() {
      unitGroup.removeEventListener('pointerdown', onPointerDown);
      unitGroup.removeEventListener('pointermove', onPointerMove);
      unitGroup.removeEventListener('pointerup', onPointerUp);
      unitGroup.removeEventListener('pointercancel', onPointerCancel);
      unitGroup.removeEventListener('click', onClick);
      if (dragPointerId !== null) endDrag(dragPointerId);
      else hideArrow();
    },
  };
}

function targetUnitButton(event: Event): HTMLButtonElement | null {
  return (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-unit]') ?? null;
}

function readTypeId(button: HTMLButtonElement | null): UnitTypeId | null {
  const typeId = button?.dataset.unit;
  return typeId ? (typeId as UnitTypeId) : null;
}

/** 屏幕坐标是否落在按钮范围内（含边界）。 */
function isInsideRect(rect: DOMRect, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  );
}

/** 松手点是否在 3D 战场上；落在底部选兵栏或手牌 HUD 里一律按取消处理。 */
function isOverBattlefield(clientX: number, clientY: number): boolean {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element || element.closest('#solo-hand') || element.closest('#panel-bottom-dock')) {
    return false;
  }
  return Boolean(element.closest('#app'));
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`调试放兵缺少元素：${selector}`);
  return element;
}
