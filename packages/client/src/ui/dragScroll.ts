export interface DragScrollOptions {
  /** 位移超过该像素才判定为拖拽，避免手指轻微抖动导致内部按钮点不动。 */
  threshold?: number;
  /** 命中该选择器的元素保留原生行为（输入框、可编辑区等），不接管手势。 */
  ignoreSelector?: string;
}

const DEFAULT_THRESHOLD = 6;

/**
 * 让容器支持「按住内容上下拖动」滚动，用于已隐藏原生滚动条的列表。
 *
 * 关键取舍：拖拽阈值内不申请指针捕获，指针事件仍按原路径派发，
 * 内部按钮的点击、焦点与键盘操作完全不受影响；越过阈值后才捕获指针，
 * 保证手指移出容器也能继续跟手，并在收尾时吞掉那次误触的 click。
 * @returns 解绑函数
 */
export function enableDragScroll(
  element: HTMLElement,
  { threshold = DEFAULT_THRESHOLD, ignoreSelector }: DragScrollOptions = {},
): () => void {
  let pointerId: number | null = null;
  let startY = 0;
  let startScrollTop = 0;
  /** 本次手势是否已经变成拖拽，用于决定要不要吞掉随后的 click。 */
  let dragging = false;
  /** 拖拽结束后可能补发一次 click，标记后等它来或等下一次按下时清除。 */
  let suppressClick = false;

  /** 内容不足以滚动时不必接管手势，交还给浏览器处理。 */
  const canScroll = (): boolean => element.scrollHeight > element.clientHeight;

  const onPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null || event.button !== 0 || !canScroll()) return;
    const target = event.target;
    if (ignoreSelector && target instanceof Element && target.closest(ignoreSelector)) return;
    pointerId = event.pointerId;
    startY = event.clientY;
    startScrollTop = element.scrollTop;
    dragging = false;
    // 新手势开始即清除上轮残留，避免拖拽后第一次真实点击被吞
    suppressClick = false;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const deltaY = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(deltaY) < threshold) return;
      dragging = true;
      suppressClick = true;
      element.classList.add('is-dragging');
      try {
        // 越过阈值才捕获，避免影响短按点击的事件路径
        element.setPointerCapture(event.pointerId);
      } catch {
        // jsdom 没有真实指针捕获，后续仍靠 pointermove 滚动
      }
    }
    element.scrollTop = startScrollTop - deltaY;
  };

  const finishDrag = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    element.classList.remove('is-dragging');
    try {
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 同上：测试环境可能没有指针捕获状态
    }
  };

  /** 拖拽收尾的 click 属于误触，在捕获阶段拦下，避免滚动时切换选中兵种。 */
  const onClickCapture = (event: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', finishDrag);
  element.addEventListener('pointercancel', finishDrag);
  element.addEventListener('click', onClickCapture, true);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', finishDrag);
    element.removeEventListener('pointercancel', finishDrag);
    element.removeEventListener('click', onClickCapture, true);
    element.classList.remove('is-dragging');
  };
}
