// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SFX_MUTED_STORAGE_KEY, sfx } from '../src/audio/sfx.js';
import { createSettingsDialog } from '../src/ui/settingsDialog.js';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="settings-dialog" class="mode-dialog is-hidden" aria-hidden="true">
      <button data-settings-close type="button">遮罩</button>
      <div class="mode-dialog-panel">
        <button class="mode-dialog-close" type="button" data-settings-close>×</button>
        <button id="btn-settings-mute" type="button" role="switch" aria-checked="true">
          <span class="settings-row-label">音效</span>
        </button>
        <button id="btn-settings-sfx-config" type="button">
          <span class="settings-row-label">音效调整</span>
        </button>
      </div>
    </div>
  `;
}

describe('设置弹层音效开关', () => {
  beforeEach(() => {
    localStorage.clear();
    mountDom();
    // 单例跨用例复用，先归位到「有音效」状态
    sfx.setMuted(false);
  });

  it('点开关写入静音状态并翻转 aria-checked', () => {
    createSettingsDialog();
    const row = document.querySelector<HTMLButtonElement>('#btn-settings-mute')!;

    expect(row.getAttribute('aria-checked')).toBe('true');

    row.click();
    expect(localStorage.getItem(SFX_MUTED_STORAGE_KEY)).toBe('1');
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(row.classList.contains('is-muted')).toBe(true);

    row.click();
    expect(localStorage.getItem(SFX_MUTED_STORAGE_KEY)).toBe('0');
    expect(row.getAttribute('aria-checked')).toBe('true');
  });

  it('别处改静音（如局内按钮）时开关自动同步', () => {
    createSettingsDialog();
    const row = document.querySelector<HTMLButtonElement>('#btn-settings-mute')!;

    sfx.setMuted(true);
    expect(row.getAttribute('aria-checked')).toBe('false');
  });

  it('dispose 后点击不再改变静音状态', () => {
    const handle = createSettingsDialog();
    const row = document.querySelector<HTMLButtonElement>('#btn-settings-mute')!;

    handle.dispose();
    row.click();
    expect(sfx.isMuted()).toBe(false);
  });

  it('打开与关闭只切 is-hidden，不改变音效状态', () => {
    const handle = createSettingsDialog();
    const dialog = document.querySelector('#settings-dialog')!;

    handle.open();
    expect(dialog.classList.contains('is-hidden')).toBe(false);
    expect(dialog.getAttribute('aria-hidden')).toBe('false');

    handle.close();
    expect(dialog.classList.contains('is-hidden')).toBe(true);
    expect(sfx.isMuted()).toBe(false);
  });

  it('点音效调整入口先收起弹层再跳转', () => {
    let opened = 0;
    const handle = createSettingsDialog({ onOpenSfxConfig: () => (opened += 1) });
    const dialog = document.querySelector('#settings-dialog')!;
    handle.open();

    document.querySelector<HTMLButtonElement>('#btn-settings-sfx-config')!.click();
    expect(opened).toBe(1);
    expect(dialog.classList.contains('is-hidden')).toBe(true);
  });

  it('页面没有音效调整入口时不影响开关', () => {
    document.querySelector('#btn-settings-sfx-config')!.remove();
    const handle = createSettingsDialog({ onOpenSfxConfig: () => {} });
    const row = document.querySelector<HTMLButtonElement>('#btn-settings-mute')!;

    row.click();
    expect(sfx.isMuted()).toBe(true);
    handle.dispose();
  });
});
