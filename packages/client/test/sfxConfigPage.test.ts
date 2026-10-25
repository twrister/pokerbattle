// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/audio/sfx.js';
import { SFX_DEFS, type SfxId } from '../src/audio/sfxManifest.js';
import { createSfxConfigPage } from '../src/ui/sfxConfigPage.js';

function mountDom(): void {
  document.body.innerHTML = `
    <main id="sfx-config" class="is-hidden" aria-hidden="true">
      <div class="sfx-config-shell">
        <header class="sfx-config-header">
          <button id="btn-sfx-config-back" type="button">返回设置</button>
        </header>
        <section id="sfx-config-list"></section>
        <footer>
          <div id="sfx-config-status"></div>
        </footer>
      </div>
    </main>
  `;
}

/** 取某行里指定文案的按钮，避免依赖按钮在 DOM 中的固定下标。 */
function actionButton(id: SfxId, text: string): HTMLButtonElement {
  const row = document.querySelector<HTMLElement>(`.sfx-config-row[data-id="${id}"]`)!;
  const button = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === text,
  );
  if (!button) throw new Error(`找不到按钮：${id} / ${text}`);
  return button;
}

function fileInput(id: SfxId): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`.sfx-config-row[data-id="${id}"] input[type="file"]`)!;
}

/** 让 input 变成「选中了一个文件」：jsdom 不允许直接改 files，只能覆写属性。 */
function selectFile(id: SfxId, name: string, bytes = 8): void {
  const input = fileInput(id);
  const file = {
    name,
    size: bytes,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as File;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** HEAD 探测体积一律返回 200，POST 走 uploadResponse 决定成功或失败。 */
function stubFetch(uploadResponse: () => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': '2048' } });
    }
    return uploadResponse();
  }) as unknown as typeof fetch;
}

describe('开发服音效调整页', () => {
  beforeEach(() => {
    mountDom();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('打开后列出全部音效，并按分组展示', () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();

    const ids = Array.from(document.querySelectorAll<HTMLElement>('.sfx-config-row')).map(
      (row) => row.dataset.id,
    );
    expect(ids.sort()).toEqual(Object.keys(SFX_DEFS).sort());
    expect(document.querySelectorAll('.sfx-config-group').length).toBeGreaterThan(1);
    page.dispose();
  });

  it('点试听调用引擎，且不写盘', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const audition = vi.spyOn(sfx, 'audition').mockReturnValue(true);
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();

    actionButton('ui_click', '试听').click();
    expect(audition).toHaveBeenCalledWith('ui_click');
    expect(document.querySelector('#sfx-config-status')!.textContent).toContain('正在试听');
    page.dispose();
  });

  it('选中文件后先试听候选，确认替换才 POST 并重载', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'content-length': '1024' } })
        : new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const auditionBytes = vi.spyOn(sfx, 'auditionBytes').mockResolvedValue(true);
    const reload = vi.spyOn(sfx, 'reload').mockResolvedValue(true);
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();

    selectFile('explode', 'boom.ogg');
    await vi.waitFor(() => {
      expect(actionButton('explode', '试听候选').disabled).toBe(false);
    });

    actionButton('explode', '试听候选').click();
    await vi.waitFor(() => expect(auditionBytes).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();

    actionButton('explode', '替换').click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith('explode'));

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/__pb/sfx?id=explode');
    expect(document.querySelector('#sfx-config-status')!.textContent).toContain('已替换');
    page.dispose();
  });

  it('写盘接口不存在时提示改用开发服', async () => {
    stubFetch(async () => new Response(null, { status: 404 }));
    vi.spyOn(sfx, 'reload').mockResolvedValue(true);
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();

    selectFile('ui_click', 'click.ogg');
    await vi.waitFor(() => {
      expect(actionButton('ui_click', '替换').disabled).toBe(false);
    });
    actionButton('ui_click', '替换').click();

    await vi.waitFor(() => {
      expect(document.querySelector('#sfx-config-status')!.textContent).toContain('开发服');
    });
    page.dispose();
  });

  it('返回按钮回到调用方指定页面', () => {
    stubFetch(async () => new Response(null, { status: 200 }));
    const onBack = vi.fn();
    const page = createSfxConfigPage({ onBack });
    page.show();

    document.querySelector<HTMLButtonElement>('#btn-sfx-config-back')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    page.dispose();
  });

  it('dispose 后试听按钮不再响应', () => {
    stubFetch(async () => new Response(null, { status: 200 }));
    const audition = vi.spyOn(sfx, 'audition').mockReturnValue(true);
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();
    const button = actionButton('ui_click', '试听');

    page.dispose();
    button.click();
    expect(audition).not.toHaveBeenCalled();
  });

  it('每行都有开关，默认显示为开', () => {
    stubFetch(async () => new Response(null, { status: 200 }));
    vi.spyOn(sfx, 'isEnabled').mockReturnValue(true);
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();

    const toggles = document.querySelectorAll('.sfx-config-row .sfx-config-toggle');
    expect(toggles.length).toBe(Object.keys(SFX_DEFS).length);
    for (const toggle of Array.from(toggles)) {
      expect(toggle.textContent).toBe('开');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    }
    page.dispose();
  });

  it('点开关写回引擎并刷新行状态', () => {
    stubFetch(async () => new Response(null, { status: 200 }));
    // 用真实引擎状态：先确认开，点一下变关，再点回开
    sfx.setEnabled('ui_click', true);
    const setEnabled = vi.spyOn(sfx, 'setEnabled');
    const page = createSfxConfigPage({ onBack: () => {} });
    page.show();

    const toggle = document.querySelector<HTMLButtonElement>(
      '.sfx-config-row[data-id="ui_click"] .sfx-config-toggle',
    )!;
    toggle.click();

    expect(setEnabled).toHaveBeenCalledWith('ui_click', false);
    expect(sfx.isEnabled('ui_click')).toBe(false);
    expect(toggle.textContent).toBe('关');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.closest('.sfx-config-row')?.classList.contains('is-off')).toBe(true);
    expect(document.querySelector('#sfx-config-status')!.textContent).toContain('已关闭');

    toggle.click();
    expect(sfx.isEnabled('ui_click')).toBe(true);
    expect(toggle.textContent).toBe('开');
    page.dispose();
    sfx.setEnabled('ui_click', true);
  });
});
