import { isShortClick } from './placement.js';

export interface CastlePackClickOptions {
  domElement: HTMLElement;
  /** 命中本机卡包时返回 true。 */
  pickPack: (clientX: number, clientY: number) => boolean;
  onClaim: () => void;
}

/**
 * 优先拾取漂浮卡包；命中则拦住后续选中/放兵，避免点包同时点到主堡。
 */
export function enableCastlePackClick(options: CastlePackClickOptions): () => void {
  const { domElement, pickPack, onClaim } = options;
  let downX = 0;
  let downY = 0;
  let downTime = 0;
  let pointerDown = false;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerDown = true;
    downX = event.clientX;
    downY = event.clientY;
    downTime = event.timeStamp;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (!isShortClick(event, downX, downY, downTime)) return;
    if (!pickPack(event.clientX, event.clientY)) return;
    event.stopImmediatePropagation();
    onClaim();
  };

  const onPointerCancel = (): void => {
    pointerDown = false;
  };

  domElement.addEventListener('pointerdown', onPointerDown, true);
  domElement.addEventListener('pointerup', onPointerUp, true);
  domElement.addEventListener('pointercancel', onPointerCancel, true);
  return () => {
    domElement.removeEventListener('pointerdown', onPointerDown, true);
    domElement.removeEventListener('pointerup', onPointerUp, true);
    domElement.removeEventListener('pointercancel', onPointerCancel, true);
  };
}
