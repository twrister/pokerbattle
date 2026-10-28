import { sfx } from '../audio/sfx.js';

export interface SettingsDialogHandle {
  open(): void;
  close(): void;
  dispose(): void;
}

export interface SettingsDialogOptions {
  /** 开发服「音效调整」入口；不传则该行不响应（正式服隐藏，也不需要回调）。 */
  onOpenSfxConfig?: () => void;
}

/**
 * 大厅设置弹层。
 *
 * 音效开关 + 开发服的音效调整入口；后续设置项沿用 `.settings-row` 行样式往下追加即可。
 * 开关状态仍以 sfx 单例为准，订阅后与局内音符按钮双向同步。
 */
export function createSettingsDialog(options: SettingsDialogOptions = {}): SettingsDialogHandle {
  const root = required<HTMLElement>('#settings-dialog');
  const muteRow = required<HTMLButtonElement>('#btn-settings-mute', root);
  // 入口行是开发服专属的，单测与裁剪过的页面里可能不存在
  const sfxConfigRow = root.querySelector<HTMLButtonElement>('#btn-settings-sfx-config');
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-settings-close]'),
  );

  /** 按当前静音状态刷新开关外观；静音态具体语义交给 aria-checked 表达。 */
  const sync = (): void => {
    const muted = sfx.isMuted();
    // aria-checked 语义是「音效是否开启」，所以与 muted 相反
    muteRow.setAttribute('aria-checked', String(!muted));
    muteRow.classList.toggle('is-muted', muted);
  };

  /** 点行内任意位置都算切换；自身不叠加全局点击音。 */
  const onToggleMute = (): void => {
    sfx.toggleMuted();
    // 重新开启时补一声确认，让玩家听到确实恢复了
    if (!sfx.isMuted()) sfx.play('ui_confirm');
  };

  const open = (): void => {
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
    sync();
  };

  const close = (): void => {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  /** 跳转前先收起弹层，避免音效页压在设置弹层下面。 */
  const onOpenSfxConfig = (): void => {
    close();
    options.onOpenSfxConfig?.();
  };

  muteRow.addEventListener('click', onToggleMute);
  muteRow.dataset.sfx = 'none';
  sfxConfigRow?.addEventListener('click', onOpenSfxConfig);
  for (const button of closeButtons) {
    button.addEventListener('click', close);
  }
  const unsubscribe = sfx.subscribe(sync);
  sync();

  return {
    open,
    close,
    dispose() {
      unsubscribe();
      muteRow.removeEventListener('click', onToggleMute);
      sfxConfigRow?.removeEventListener('click', onOpenSfxConfig);
      for (const button of closeButtons) {
        button.removeEventListener('click', close);
      }
    },
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`设置弹层缺少元素：${selector}`);
  return element;
}
