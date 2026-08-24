// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preview = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock('../src/view/formationPreview.js', () => ({
  createFormationPreview: vi.fn(() => preview),
}));
vi.mock('../src/view/formationThumbnail.js', () => ({
  getFormationThumbnail: vi.fn(async () => 'data:image/png;base64,preview'),
}));

import {
  applySpecialTierDrafts,
  dumpDefaultSpecialTierDrafts,
  dumpSpecialTierDrafts,
  formatSpecialTierLabel,
  resetSpecialTiersToDefault,
} from '@pb/sim';
import { createSpecialTierPage } from '../src/ui/specialTierPage.js';
import { getFormationThumbnail } from '../src/view/formationThumbnail.js';

describe('档位表配置页', () => {
  beforeEach(() => {
    preview.render.mockClear();
    preview.resize.mockClear();
    preview.dispose.mockClear();
    vi.mocked(getFormationThumbnail).mockClear();
    document.body.innerHTML = `
      <main id="special-tiers" class="is-hidden">
        <button id="btn-special-tiers-back"></button>
        <button id="btn-special-tiers-save"></button>
        <button id="btn-special-tiers-reset"></button>
        <div id="special-tiers-table"></div>
        <div id="special-tiers-editor"></div>
        <div id="special-tiers-status"></div>
        <button id="special-tiers-preview-tab-3d" class="is-active" aria-selected="true"></button>
        <button id="special-tiers-preview-tab-button" aria-selected="false"></button>
        <div id="special-tiers-preview"></div>
        <div id="special-tiers-preview-button" class="is-hidden"></div>
      </main>
    `;
  });

  afterEach(() => {
    resetSpecialTiersToDefault();
  });

  it('进入后显示四档，返回时通知页面控制器', () => {
    const onBack = vi.fn();
    const page = createSpecialTierPage({ onBack });
    page.show();

    expect(document.querySelector('#special-tiers')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelectorAll('.deck-tier-column')).toHaveLength(4);
    expect(document.querySelector('.deck-tier-column[data-tier="4"]')?.textContent).toContain('4档');
    expect(preview.resize).toHaveBeenCalledOnce();
    expect(preview.render).toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('#btn-special-tiers-back')!.click();
    expect(onBack).toHaveBeenCalledOnce();
    page.dispose();
    expect(preview.dispose).toHaveBeenCalledOnce();
  });

  it('可改名单并立刻应用到运行时标签', () => {
    const page = createSpecialTierPage({ onBack: vi.fn() });
    page.show();

    expect(formatSpecialTierLabel(4)).toBe('4档：双射手箭塔 / 飞龙 / 投弹车');
    const select = document.querySelector<HTMLSelectElement>('.deck-tier-column[data-tier="4"] select');
    expect(select).toBeTruthy();
    select!.value = 'melee_grunt';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(formatSpecialTierLabel(4)).toBe('4档：民兵 / 飞龙 / 投弹车');
    expect(dumpSpecialTierDrafts()[4].units[0]).toBe('melee_grunt');
    expect(dumpSpecialTierDrafts()[4].formations.melee_grunt).toBeDefined();
    expect(dumpSpecialTierDrafts()[4].formations.building_tower_advanced).toBeUndefined();

    page.dispose();
  });

  it('点选未选中兵种时拦住下拉展开，选中后再允许换人', () => {
    const page = createSpecialTierPage({ onBack: vi.fn() });
    page.show();

    const dragonSelect = document.querySelector<HTMLSelectElement>(
      '.deck-tier-unit-row[data-type-id="fire_dragon"] select',
    )!;
    const blocked = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    dragonSelect.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(document.querySelector('#special-tiers-editor')?.textContent).toContain('喷火龙');

    const allowed = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    dragonSelect.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);

    page.dispose();
  });

  it('点选兵种后只改该兵种参数', () => {
    const page = createSpecialTierPage({ onBack: vi.fn() });
    page.show();

    document.querySelector<HTMLElement>('.deck-tier-unit-row[data-type-id="fire_dragon"]')!.click();
    expect(document.querySelector('#special-tiers-editor')?.textContent).toContain('喷火龙');
    const countInput = editorField('每阵数量')!;
    expect(countInput.disabled).toBe(false);
    countInput.value = '2';
    countInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(dumpSpecialTierDrafts()[5].formations.fire_dragon?.unitCount).toBe(2);
    expect(dumpSpecialTierDrafts()[5].formations.melee_golem?.unitCount).toBe(1);
    const rendered = preview.render.mock.calls.at(-1)?.[0];
    expect(rendered?.rows).toEqual([['fire_dragon', 'fire_dragon']]);

    page.dispose();
  });

  it('按钮显示页签画出当前档着色按钮', async () => {
    const page = createSpecialTierPage({ onBack: vi.fn() });
    page.show();

    document.querySelector<HTMLButtonElement>('#special-tiers-preview-tab-button')!.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#special-tiers-preview-button .formation-option.is-tier-5')).toHaveLength(
        3,
      );
    });
    expect(getFormationThumbnail).toHaveBeenCalled();

    page.dispose();
  });

  it('重置恢复到最近一次配置快照', () => {
    const page = createSpecialTierPage({ onBack: vi.fn() });
    page.show();

    const snapshot = dumpDefaultSpecialTierDrafts();
    const select = document.querySelector<HTMLSelectElement>('.deck-tier-column[data-tier="4"] select')!;
    select.value = 'melee_grunt';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dumpSpecialTierDrafts()[4].units[0]).toBe('melee_grunt');

    document.querySelector<HTMLButtonElement>('#btn-special-tiers-reset')!.click();
    expect(dumpSpecialTierDrafts()[4].units).toEqual(snapshot[4].units);
    expect(document.querySelector('#special-tiers-status')?.textContent).toContain('已恢复');

    page.dispose();
  });

  it('保存成功后写盘并更新快照', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const page = createSpecialTierPage({ onBack: vi.fn() });
    page.show();

    const select = document.querySelector<HTMLSelectElement>('.deck-tier-column[data-tier="4"] select')!;
    select.value = 'melee_grunt';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#btn-special-tiers-save')!.click();

    await vi.waitFor(() => {
      expect(document.querySelector('#special-tiers-status')?.textContent).toContain('specialTiers.json');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/__pb/special-tiers',
      expect.objectContaining({ method: 'POST' }),
    );

    const current = dumpSpecialTierDrafts();
    applySpecialTierDrafts({
      ...current,
      4: {
        units: ['dragon'],
        formations: { dragon: current[4].formations.dragon! },
      },
    });
    document.querySelector<HTMLButtonElement>('#btn-special-tiers-reset')!.click();
    expect(dumpSpecialTierDrafts()[4].units[0]).toBe('melee_grunt');

    page.dispose();
    vi.unstubAllGlobals();
  });
});

/** 读取右侧编辑器里指定标签对应的输入框。 */
function editorField(label: string): HTMLInputElement | undefined {
  const row = [...document.querySelectorAll('#special-tiers-editor .deck-field')].find((el) =>
    el.textContent?.startsWith(label),
  );
  return row?.querySelector('input') ?? undefined;
}
