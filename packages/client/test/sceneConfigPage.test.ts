// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_WIDTH, dumpArenaConfigDraft, resetArenaConfigToDefault, toFloat } from '@pb/sim';
import { createSceneConfigPage } from '../src/ui/sceneConfigPage.js';
import { createScenePreview } from '../src/view/scenePreview.js';

vi.mock('../src/view/scenePreview.js', () => ({
  createScenePreview: vi.fn(() => ({
    applyDraft: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}));

function latestPreview() {
  const result = vi.mocked(createScenePreview).mock.results.at(-1)?.value as {
    applyDraft: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  if (!result) throw new Error('preview not created');
  return result;
}

function mountDom(): void {
  document.body.innerHTML = `
    <main id="scene-config" class="is-hidden" aria-hidden="true">
      <button id="btn-scene-config-back" type="button">返回图鉴</button>
      <button id="btn-scene-mode-1v1" type="button">1v1</button>
      <button id="btn-scene-mode-2v2" type="button">2v2</button>
      <div id="scene-config-preview"></div>
      <form id="scene-config-form">
        <select id="scene-camera-mode">
          <option value="ortho">正交</option>
          <option value="perspective">透视</option>
        </select>
        <div id="scene-fov-row"><input id="scene-fov" type="number" /></div>
        <div id="scene-distance-row"><input id="scene-distance" type="number" /></div>
        <div id="scene-offset-y-row"><input id="scene-offset-y" type="number" /></div>
        <input id="scene-angle" type="number" />
        <div id="scene-bottom-extra-row"><input id="scene-bottom-extra" type="number" /></div>
        <input id="scene-width" type="number" />
        <input id="scene-height" type="number" />
        <input id="scene-river-width" type="number" />
        <div id="scene-base-list"></div>
        <input id="scene-bridge3-enabled" type="checkbox" />
        <div id="scene-bridge-list"></div>
        <input id="scene-color-background" type="color" />
        <input id="scene-color-ground" type="color" />
        <input id="scene-color-river" type="color" />
        <input id="scene-color-bridge" type="color" />
        <input id="scene-color-grid" type="color" />
        <input id="scene-color-border" type="color" />
      </form>
      <div id="scene-config-status"></div>
      <button id="btn-scene-config-reset" type="button">重置</button>
      <button id="btn-scene-config-save" type="button">保存</button>
    </main>
  `;
}

describe('场景配置页', () => {
  beforeEach(() => {
    mountDom();
    vi.mocked(createScenePreview).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  afterEach(() => {
    resetArenaConfigToDefault();
    vi.unstubAllGlobals();
  });

  it('打开页面时用当前草稿填充表单并刷新预览', () => {
    const page = createSceneConfigPage({ onBack: vi.fn() });
    page.show();
    expect(document.querySelector<HTMLInputElement>('#scene-width')?.value).toBe('18');
    expect(document.querySelector<HTMLInputElement>('#scene-height')?.value).toBe('15');
    expect(document.querySelector<HTMLInputElement>('#scene-fov')?.value).toBe('30');
    expect(latestPreview().applyDraft).toHaveBeenCalled();
    page.dispose();
  });

  it('改 FOV、距离、颜色和河宽会驱动预览重建', () => {
    const page = createSceneConfigPage({ onBack: vi.fn() });
    page.show();
    const preview = latestPreview();
    preview.applyDraft.mockClear();

    const fov = document.querySelector<HTMLInputElement>('#scene-fov')!;
    fov.value = '60';
    fov.dispatchEvent(new Event('input', { bubbles: true }));

    const distance = document.querySelector<HTMLInputElement>('#scene-distance')!;
    distance.value = '80';
    distance.dispatchEvent(new Event('input', { bubbles: true }));

    const offsetY = document.querySelector<HTMLInputElement>('#scene-offset-y')!;
    offsetY.value = '6';
    offsetY.dispatchEvent(new Event('input', { bubbles: true }));

    const river = document.querySelector<HTMLInputElement>('#scene-color-river')!;
    river.value = '#112233';
    river.dispatchEvent(new Event('input', { bubbles: true }));

    const riverWidth = document.querySelector<HTMLInputElement>('#scene-river-width')!;
    riverWidth.value = '3';
    riverWidth.dispatchEvent(new Event('input', { bubbles: true }));

    expect(preview.applyDraft).toHaveBeenCalled();
    const last = preview.applyDraft.mock.calls.at(-1)?.[0] as {
      camera: { fov: number; distance: number; offsetY: number };
      riverWidth: number;
      colors: { river: string };
    };
    expect(last.camera.fov).toBe(60);
    expect(last.camera.distance).toBe(80);
    expect(last.camera.offsetY).toBe(6);
    expect(last.riverWidth).toBe(3);
    expect(last.colors.river.toLowerCase()).toBe('#112233');
    page.dispose();
  });

  it('保存会 apply 到运行时并 POST 写盘', async () => {
    const page = createSceneConfigPage({ onBack: vi.fn() });
    page.show();
    const width = document.querySelector<HTMLInputElement>('#scene-width')!;
    width.value = '20';
    width.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector<HTMLButtonElement>('#btn-scene-config-save')!.click();
    await vi.waitFor(() => {
      expect(toFloat(ARENA_WIDTH)).toBe(20);
    });
    expect(fetch).toHaveBeenCalledWith(
      '/__pb/arena-config',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(dumpArenaConfigDraft().width).toBe(20);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body.mode).toBe('1v1');
    expect(body.draft.width).toBe(20);
    page.dispose();
  });

  it('切换 2v2 预设后表单读宽场地草稿', () => {
    const page = createSceneConfigPage({ onBack: vi.fn() });
    page.show();
    document.querySelector<HTMLButtonElement>('#btn-scene-mode-2v2')!.click();
    expect(document.querySelector<HTMLInputElement>('#scene-width')?.value).toBe('30');
    expect(document.querySelector('#btn-scene-mode-2v2')?.classList.contains('is-active')).toBe(true);
    expect(document.querySelectorAll('[data-base-row]')).toHaveLength(2);
    expect(document.querySelector<HTMLInputElement>('#scene-bridge3-enabled')?.checked).toBe(true);
    page.dispose();
  });

  it('改单边基地坐标和桥三开关会写入草稿', () => {
    const page = createSceneConfigPage({ onBack: vi.fn() });
    page.show();
    expect(document.querySelectorAll('[data-base-row]')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('#scene-bridge3-enabled')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-bridge-row="2"] [data-bridge-min]')?.disabled).toBe(true);

    const baseX = document.querySelector<HTMLInputElement>('[data-base-x]')!;
    baseX.value = '6';
    baseX.dispatchEvent(new Event('input', { bubbles: true }));
    const baseY = document.querySelector<HTMLInputElement>('[data-base-y]')!;
    baseY.value = '4';
    baseY.dispatchEvent(new Event('input', { bubbles: true }));

    const bridge3 = document.querySelector<HTMLInputElement>('#scene-bridge3-enabled')!;
    bridge3.checked = true;
    bridge3.dispatchEvent(new Event('change', { bubbles: true }));

    const last = latestPreview().applyDraft.mock.calls.at(-1)?.[0] as {
      bases: Array<{ x: number; y: number }>;
      bridge3Enabled: boolean;
    };
    expect(last.bases).toEqual([{ x: 6, y: 4 }]);
    expect(last.bridge3Enabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-bridge-row="2"] [data-bridge-min]')?.disabled).toBe(false);
    page.dispose();
  });

  it('overlay 关闭不走 onBack，也不创建预览', () => {
    const onBack = vi.fn();
    const page = createSceneConfigPage({ onBack });
    page.showAsOverlay();
    expect(document.querySelector('#scene-config')?.classList.contains('is-overlay')).toBe(true);
    expect(document.querySelector('#btn-scene-config-back')?.textContent).toBe('关闭');
    expect(createScenePreview).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('#btn-scene-config-back')!.click();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector('#scene-config')?.classList.contains('is-hidden')).toBe(true);
    page.dispose();
  });

  it('overlay 改 FOV 会立刻 apply 并通知战场重建', () => {
    const onApplied = vi.fn();
    const page = createSceneConfigPage({ onBack: vi.fn(), onApplied });
    page.showAsOverlay();

    const fov = document.querySelector<HTMLInputElement>('#scene-fov')!;
    fov.value = '62';
    fov.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onApplied).toHaveBeenCalled();
    expect(dumpArenaConfigDraft().camera.fov).toBe(62);
    expect(createScenePreview).not.toHaveBeenCalled();
    page.dispose();
  });
});
