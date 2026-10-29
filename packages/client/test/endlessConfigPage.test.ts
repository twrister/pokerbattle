// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyEndlessConfigDraft,
  dumpEndlessConfigDraft,
  restoreEndlessConfigFromFile,
} from '@pb/sim';
import { createEndlessConfigPage } from '../src/ui/endlessConfigPage.js';

function mountDom(): void {
  document.body.innerHTML = `
    <main id="endless-config" class="is-hidden" aria-hidden="true">
      <button id="btn-endless-config-back" type="button">返回图鉴</button>
      <input id="endless-config-wave-seconds" type="number" />
      <section id="endless-config-panel"></section>
      <div id="endless-config-status"></div>
      <button id="btn-endless-config-add-wave" type="button">添加一波</button>
      <button id="btn-endless-config-save" type="button">保存</button>
    </main>
  `;
}

/** 清掉运行时每波覆盖，避免用例之间互相影响。 */
function resetConfig(): void {
  restoreEndlessConfigFromFile();
  applyEndlessConfigDraft({ waveSeconds: 120, waves: [] });
}

function numberInput(wave: number, field: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`input[data-wave="${wave}"][data-field="${field}"]`);
}

describe('无限关卡参数页', () => {
  beforeEach(() => {
    mountDom();
    resetConfig();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetConfig();
  });

  it('默认展示前 5 波，没配置时显示公式值与占位提示', () => {
    const page = createEndlessConfigPage({ onBack: vi.fn() });
    page.show();

    const rows = document.querySelectorAll('.endless-config-table tbody tr');
    expect(rows.length).toBe(5);
    expect(document.querySelector('#endless-config-wave-seconds') as HTMLInputElement).toBeTruthy();

    // 第 5 波是 Boss 波
    const boss = document.querySelector('tr[data-wave="5"] td:nth-child(2)')?.textContent;
    expect(boss).toBe('Boss');

    const budgetInput = numberInput(1, 'budget');
    expect(budgetInput?.value).toBe('');
    expect(budgetInput?.placeholder).toBe('14');
    expect(numberInput(1, 'waveSeconds')?.placeholder).toBe('120');
    page.dispose();
  });

  it('填预算与间隔后落成该波覆盖项，保存写回接口', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const page = createEndlessConfigPage({ onBack: vi.fn() });
    page.show();

    const budget = numberInput(2, 'budget')!;
    budget.value = '40';
    budget.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('#btn-endless-config-save')?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/__pb/endless-config');
    const saved = dumpEndlessConfigDraft();
    expect(saved.waves).toEqual([{ wave: 2, budget: 40 }]);
    page.dispose();
  });

  it('添加一波会带上公式预算与间隔，并多渲染一行', () => {
    const page = createEndlessConfigPage({ onBack: vi.fn() });
    page.show();

    document.querySelector<HTMLButtonElement>('#btn-endless-config-add-wave')?.click();
    expect(document.querySelectorAll('.endless-config-table tbody tr').length).toBe(6);
    // 第 6 波公式：14 * 1.18^5 ≈ 32，间隔 15 - 0.8*5 = 11
    expect(numberInput(6, 'budget')?.value).toBe('32');
    expect(numberInput(6, 'intervalSeconds')?.value).toBe('11');
    page.dispose();
  });

  it('兵种池可添加并改权重，保存后写进覆盖项', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const page = createEndlessConfigPage({ onBack: vi.fn() });
    page.show();

    const select = document.querySelector<HTMLSelectElement>('select[data-add-unit="1"]')!;
    select.value = 'dragon';
    document
      .querySelector<HTMLButtonElement>('button[data-action="add-unit"][data-wave="1"]')
      ?.click();

    const weight = document.querySelector<HTMLInputElement>(
      'input[data-wave="1"][data-unit="dragon"][data-field="weight"]',
    );
    expect(weight).toBeTruthy();
    // 默认池整份搬过来，再加新兵种
    expect(document.querySelectorAll('tr[data-wave="1"] input[data-field="weight"]').length).toBeGreaterThan(1);

    weight!.value = '8';
    weight!.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('#btn-endless-config-save')?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const dragon = dumpEndlessConfigDraft().waves
      .find((wave) => wave.wave === 1)
      ?.units?.find((unit) => unit.typeId === 'dragon');
    expect(dragon?.weight).toBe(8);
    page.dispose();
  });

  it('恢复公式会删掉该波覆盖项', () => {
    applyEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 2, budget: 50 }] });
    const page = createEndlessConfigPage({ onBack: vi.fn() });
    page.show();

    expect(document.querySelector('tr[data-wave="2"]')?.classList.contains('is-custom')).toBe(true);
    document
      .querySelector<HTMLButtonElement>('button[data-action="reset-wave"][data-wave="2"]')
      ?.click();
    expect(document.querySelector('tr[data-wave="2"]')?.classList.contains('is-custom')).toBe(false);
    page.dispose();
  });

  it('清空输入框表示回到公式，保存时不写该字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    applyEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 1, budget: 30 }] });
    const page = createEndlessConfigPage({ onBack: vi.fn() });
    page.show();

    const budget = numberInput(1, 'budget')!;
    expect(budget.value).toBe('30');
    budget.value = '';
    budget.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('#btn-endless-config-save')?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(dumpEndlessConfigDraft().waves).toEqual([]);
    page.dispose();
  });

  it('返回按钮回调 onBack，hide 收起页面', () => {
    const onBack = vi.fn();
    const page = createEndlessConfigPage({ onBack });
    page.show();
    expect(document.querySelector('#endless-config')?.classList.contains('is-hidden')).toBe(false);

    document.querySelector<HTMLButtonElement>('#btn-endless-config-back')?.click();
    expect(onBack).toHaveBeenCalledOnce();

    page.hide();
    expect(document.querySelector('#endless-config')?.classList.contains('is-hidden')).toBe(true);
    page.dispose();
  });
});
