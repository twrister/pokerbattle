import { sfx } from '../audio/sfx.js';

/** 无独立图标节点时的回退字符：用音符而不是 emoji，避免不同平台渲染差异。 */
const ICON = '♪';
const HINT_ON = '局内战斗与界面提示音';
const HINT_OFF = '已静音，点击重新开启';

export interface SfxToggleOptions {
  /**
   * 要联动的按钮；局内暂停弹窗一个、回放/观战的 HUD 一个、大厅设置弹层一个，
   * 状态必须一起刷新。
   */
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
 * 按钮有两种形态：只有图标的紧凑按钮（回放/观战），
 * 以及设置行式开关（暂停弹窗），后者靠 aria-checked 驱动 CSS 里的滑块。
 */
export function createSfxToggle(options: SfxToggleOptions): SfxToggleHandle {
  const buttons = options.buttons.filter((button): button is HTMLButtonElement => Boolean(button));

  const sync = (): void => {
    const muted = sfx.isMuted();
    for (const button of buttons) {
      button.classList.toggle('is-muted', muted);
      // 开关型用 aria-checked（语义是「音效是否开启」，与 muted 相反），
      // 图标型用 aria-pressed（语义是「是否已关闭」）
      if (isSwitchButton(button)) {
        button.setAttribute('aria-checked', String(!muted));
        button.setAttribute('aria-label', muted ? '音效已关闭，点击开启' : '音效已开启，点击关闭');
        const hint = button.querySelector<HTMLElement>('[data-sfx-hint]');
        if (hint) hint.textContent = muted ? HINT_OFF : HINT_ON;
      } else {
        setButtonIcon(button, muted);
        button.setAttribute('aria-pressed', String(muted));
        button.setAttribute('aria-label', muted ? '音效已关闭，点击开启' : '音效已开启，点击关闭');
      }
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

/** 设置行式开关：靠 role=switch 与 CSS 滑块区分于只放图标的紧凑按钮。 */
function isSwitchButton(button: HTMLButtonElement): boolean {
  return button.getAttribute('role') === 'switch' || Boolean(button.querySelector('.settings-switch'));
}

/**
 * 有独立图标节点时切换开/关两张图标，避免把按钮里的其它文案一起冲掉；
 * 没有图标节点的按钮回退为纯字符。
 */
function setButtonIcon(button: HTMLButtonElement, muted: boolean): void {
  const icon = button.querySelector<HTMLElement>('.sfx-toggle-icon');
  if (!icon) {
    button.textContent = ICON;
    return;
  }
  icon.classList.toggle('icon-music-on', !muted);
  icon.classList.toggle('icon-music-off', muted);
}
