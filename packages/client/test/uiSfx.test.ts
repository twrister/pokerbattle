// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindGlobalUiSfx } from '../src/audio/uiSfx.js';
import type { SfxId } from '../src/audio/sfxManifest.js';

/** 记录播放请求，替代真实 AudioContext。 */
function createRecorder(): { ids: SfxId[]; play: (id: SfxId) => void } {
  const ids: SfxId[] = [];
  return { ids, play: (id) => ids.push(id) };
}

describe('全局 UI 点击音', () => {
  let dispose: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    dispose();
  });

  it('点普通按钮播默认点击音', () => {
    const recorder = createRecorder();
    document.body.innerHTML = '<button id="a" type="button">a</button>';
    dispose = bindGlobalUiSfx(document, { play: recorder.play });

    document.querySelector<HTMLButtonElement>('#a')!.click();
    expect(recorder.ids).toEqual(['ui_click']);
  });

  it('data-sfx 可覆盖音效，none 完全静音', () => {
    const recorder = createRecorder();
    document.body.innerHTML = `
      <button id="confirm" data-sfx="confirm" type="button">ok</button>
      <button id="silent" data-sfx="none" type="button">x</button>
    `;
    dispose = bindGlobalUiSfx(document, { play: recorder.play });

    document.querySelector<HTMLButtonElement>('#confirm')!.click();
    document.querySelector<HTMLButtonElement>('#silent')!.click();
    expect(recorder.ids).toEqual(['ui_confirm']);
  });

  it('点到非可点元素不出声', () => {
    const recorder = createRecorder();
    document.body.innerHTML = '<div id="plain">文字</div>';
    dispose = bindGlobalUiSfx(document, { play: recorder.play });

    document.querySelector<HTMLElement>('#plain')!.click();
    expect(recorder.ids).toEqual([]);
  });

  it('禁用按钮不出声', () => {
    const recorder = createRecorder();
    document.body.innerHTML = '<button id="off" type="button" disabled>off</button>';
    dispose = bindGlobalUiSfx(document, { play: recorder.play });

    document.querySelector<HTMLButtonElement>('#off')!.click();
    expect(recorder.ids).toEqual([]);
  });

  it('手牌与阵型按钮不叠加全局点击音，自有音效负责', () => {
    const recorder = createRecorder();
    document.body.innerHTML = `
      <button id="card" class="playing-card" type="button">牌</button>
      <button id="formation" class="formation-option" type="button">阵型</button>
    `;
    dispose = bindGlobalUiSfx(document, { play: recorder.play });

    document.querySelector<HTMLButtonElement>('#card')!.click();
    document.querySelector<HTMLButtonElement>('#formation')!.click();
    expect(recorder.ids).toEqual([]);
  });

  it('解绑后不再响应', () => {
    const recorder = createRecorder();
    document.body.innerHTML = '<button id="a" type="button">a</button>';
    const unbind = bindGlobalUiSfx(document, { play: recorder.play });
    unbind();

    document.querySelector<HTMLButtonElement>('#a')!.click();
    expect(recorder.ids).toEqual([]);
  });
});

describe('音效播放器', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('没有 AudioContext 时静默降级，不抛错', async () => {
    vi.resetModules();
    const { SfxEngine } = await import('../src/audio/sfx.js');
    const engine = new SfxEngine({ createContext: () => null });
    expect(() => engine.play('ui_click')).not.toThrow();
    expect(engine.unlock()).toBe(false);
  });

  it('静音状态写入 localStorage 并可恢复', async () => {
    vi.resetModules();
    const { SfxEngine, SFX_MUTED_STORAGE_KEY } = await import('../src/audio/sfx.js');
    const engine = new SfxEngine({ createContext: () => null });

    expect(engine.isMuted()).toBe(false);
    expect(engine.toggleMuted()).toBe(true);
    expect(localStorage.getItem(SFX_MUTED_STORAGE_KEY)).toBe('1');

    const restored = new SfxEngine({ createContext: () => null });
    expect(restored.isMuted()).toBe(true);
    restored.setMuted(false);
    expect(localStorage.getItem(SFX_MUTED_STORAGE_KEY)).toBe('0');
  });
});
