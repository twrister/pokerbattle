import { sfx } from '../audio/sfx.js';

/** 静音图标：用音符而不是 emoji，避免不同平台渲染差异。 */
const ICON = '♪';

export interface SfxToggleOptions {
  /** 要联动的按钮；局内一个、大厅设置弹层一个，状态必须一起刷新。 */
  buttons: readonly HTMLButtonElement[];
}

export interface SfxToggleHandle {
  /** 按当前静音状态刷新图标与 aria。 */
  sync(): void;
  dispose(): void;
}

/**
 * 绑定静音开关。
 *
 * 状态存在 sfx 里并持久化到 localStorage，所有按钮共用同一份，
 * 所以在局内关掉音效后回到大厅，大厅设置里的开关也是关着的。
 */
export function createSfxToggle(options: SfxToggleOptions): SfxToggleHandle {
  const buttons = options.buttons.filter((button): button is HTMLButtonElement => Boolean(button));

  const sync = (): void => {
    const muted = sfx.isMuted();
    for (const button of buttons) {
      setButtonIcon(button, ICON);
      // 斜杠由 CSS 画，比换字符更稳
      button.classList.toggle('is-muted', muted);
      button.setAttribute('aria-pressed', String(muted));
      button.setAttribute('aria-label', muted ? '音效已关闭，点击开启' : '音效已开启，点击关闭');
      button.title = muted ? '开启音效' : '关闭音效';
    }
  };

  /** 点击后切换；按钮本身标记 data-sfx=none，不叠加全局点击音。 */
  const onClick = (event: Event): void => {
    event.stopPropagation();
    sfx.toggleMuted();
    // 重新开启时补一声确认，让玩家听到确实恢复了
    if (!sfx.isMuted()) sfx.play('ui_confirm');
  };

  for (const button of buttons) {
    button.addEventListener('click', onClick);
    button.dataset.sfx = 'none';
  }
  // 订阅状态：任意入口切换后，这里所有按钮都会跟着刷新
  const unsubscribe = sfx.subscribe(sync);
  sync();

  return {
    sync,
    dispose() {
      unsubscribe();
      for (const button of buttons) button.removeEventListener('click', onClick);
    },
  };
}

/** 有独立图标节点时只改图标，避免把按钮里的其它文案一起冲掉。 */
function setButtonIcon(button: HTMLButtonElement, text: string): void {
  const icon = button.querySelector<HTMLElement>('.sfx-toggle-icon');
  if (icon) icon.textContent = text;
  else button.textContent = text;
}
