import { sfx } from './sfx.js';
import type { SfxId } from './sfxManifest.js';

/** 按钮上可选的 data-sfx 提示：none 静音，其余覆盖默认点击音。 */
export type SfxHint = 'none' | 'click' | 'confirm' | 'back' | 'error' | 'open' | 'close';

/** 提示到音效 id 的映射；click 是默认档。 */
const HINT_SFX: Readonly<Record<Exclude<SfxHint, 'none'>, SfxId>> = {
  click: 'ui_click',
  confirm: 'ui_confirm',
  back: 'ui_back',
  error: 'ui_error',
  open: 'ui_open',
  close: 'ui_close',
};

/**
 * 会被当作「可点元素」的选择器。
 * 手牌与阵型按钮不在此列：它们有自己的选牌/出牌音，走全局会叠成两声。
 */
const CLICKABLE_SELECTOR = 'button:not(.playing-card):not(.formation-option), [role="button"], .topbar-action';

export interface UiSfxOptions {
  /** 播放实现；默认用全局 sfx，测试可注入收集器。 */
  play?: (id: SfxId) => void;
}

/**
 * 全局 UI 点击音。
 *
 * 用一次事件委托代替在几十个按钮上逐个埋点：只要点到可点元素就出声，
 * 需要特殊音效的地方写 `data-sfx="confirm"`，不想出声写 `data-sfx="none"`。
 * 挂在 capture 阶段，保证即使业务处理器停止了冒泡也照样响。
 */
export function bindGlobalUiSfx(
  doc: Document = document,
  options: UiSfxOptions = {},
): () => void {
  const play = options.play ?? ((id) => sfx.play(id));

  const onClick = (event: Event): void => {
    // 右键/中键不配音，避免边拖边响
    if (event instanceof MouseEvent && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clickable = target.closest(CLICKABLE_SELECTOR);
    if (!clickable) return;
    if (isDisabled(clickable)) return;
    const hint = resolveHint(clickable);
    if (hint === 'none') return;
    play(HINT_SFX[hint]);
  };

  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}

/** 取最近的 data-sfx 提示，缺省回落 click。 */
function resolveHint(element: Element): SfxHint {
  const value = element.closest('[data-sfx]')?.getAttribute('data-sfx')?.trim();
  if (value && value in HINT_SFX) return value as SfxHint;
  if (value === 'none') return 'none';
  return 'click';
}

/** 禁用态按钮不该响；:disabled 在自定义控件上也可能用 is-disabled 表达。 */
function isDisabled(element: Element): boolean {
  if (element.matches(':disabled')) return true;
  return element.classList.contains('is-disabled') || element.classList.contains('is-play-locked');
}
