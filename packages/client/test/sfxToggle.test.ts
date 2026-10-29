// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { SFX_MUTED_STORAGE_KEY, sfx } from '../src/audio/sfx.js';
import { createSfxToggle } from '../src/ui/sfxToggle.js';

function mountPauseToggle(): HTMLElement {
  document.body.innerHTML = `
    <button id="btn-pause-sfx-toggle" type="button" role="switch" aria-checked="true">
      <span class="settings-row-label">音效</span>
      <span data-sfx-hint>局内战斗与界面提示音</span>
      <span class="settings-switch"><span class="settings-switch-thumb"></span></span>
    </button>
  `;
  return document.querySelector<HTMLElement>('#btn-pause-sfx-toggle')!;
}

function mountIconToggle(): HTMLElement {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<button id="btn-battle-sfx-toggle" type="button" aria-pressed="false">
      <span class="sfx-toggle-icon icon-music-on"></span>
    </button>`,
  );
  return document.querySelector<HTMLElement>('#btn-battle-sfx-toggle')!;
}

describe('局内音效开关', () => {
  beforeEach(() => {
    localStorage.clear();
    sfx.setMuted(false);
  });

  it('暂停弹窗的开关用 aria-checked 反映「音效是否开启」', () => {
    const pause = mountPauseToggle();
    createSfxToggle({ buttons: [pause as HTMLButtonElement] });

    expect(pause.getAttribute('aria-checked')).toBe('true');

    pause.click();
    expect(sfx.isMuted()).toBe(true);
    expect(localStorage.getItem(SFX_MUTED_STORAGE_KEY)).toBe('1');
    expect(pause.getAttribute('aria-checked')).toBe('false');
    expect(pause.querySelector('[data-sfx-hint]')!.textContent).toContain('已静音');
  });

  it('图标钮与弹窗开关共享同一份状态', () => {
    const pause = mountPauseToggle();
    const icon = mountIconToggle();
    createSfxToggle({ buttons: [pause as HTMLButtonElement, icon as HTMLButtonElement] });

    icon.click();
    expect(pause.getAttribute('aria-checked')).toBe('false');
    expect(icon.getAttribute('aria-pressed')).toBe('true');

    pause.click();
    expect(icon.getAttribute('aria-pressed')).toBe('false');
  });

  it('dispose 后点击不再改变静音状态', () => {
    const pause = mountPauseToggle();
    const handle = createSfxToggle({ buttons: [pause as HTMLButtonElement] });

    handle.dispose();
    pause.click();
    expect(sfx.isMuted()).toBe(false);
  });
});
