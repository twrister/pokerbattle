// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNIT_CONFIGS,
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpUnitConfigDrafts,
  resetUnitConfigsToDefault,
} from '@pb/sim';
import { createUnitStatsPage } from '../src/ui/unitStatsPage.js';

function mountDom(): void {
  document.body.innerHTML = `
    <main id="unit-stats" class="is-hidden" aria-hidden="true">
      <button id="btn-unit-stats-back" type="button">返回图鉴</button>
      <section id="unit-stats-panel"></section>
      <div id="unit-stats-status"></div>
      <button id="btn-unit-stats-save" type="button">保存</button>
    </main>
  `;
}

describe('单位参数页', () => {
  beforeEach(() => {
    mountDom();
    vi.restoreAllMocks();
  });

  it('总览表展示绝对值与相对短条', () => {
    const page = createUnitStatsPage({ onBack: vi.fn() });
    page.show();

    const rows = document.querySelectorAll('.unit-stats-table tbody tr');
    expect(rows.length).toBe(18);
    expect(document.querySelector('.unit-stats-table')?.textContent).toContain('DPS');
    const headFields = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('.unit-stats-table thead th'),
    ).map((th) => th.dataset.field);
    const moveIdx = headFields.indexOf('moveSpeed');
    expect(headFields.slice(moveIdx, moveIdx + 5)).toEqual([
      'moveSpeed',
      'radius',
      'bodyScale',
      'attackWindup',
      'dps',
    ]);
    expect(headFields).toContain('aoeRadius');
    expect(headFields).toContain('skill');
    expect(
      document.querySelector<HTMLInputElement>(
        'input[data-unit="dragon"][data-field="aoeRadius"]',
      ),
    ).toBeTruthy();
    const gruntAoe = document.querySelector<HTMLTableCellElement>(
      'tr[data-unit="melee_grunt"] td[data-field="aoeRadius"]',
    );
    expect(gruntAoe?.textContent).toBe('—');
    expect(
      document.querySelector(
        'tr[data-unit="melee_grunt"] input[data-field="aoeRadius"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('input[data-unit="melee_grunt"][data-field="maxHp"]')
        ?.value,
    ).toBeTruthy();
    expect(
      document.querySelector<HTMLInputElement>('input[data-unit="melee_grunt"][data-field="radius"]'),
    ).toBeTruthy();
    expect(
      document.querySelector<HTMLInputElement>(
        'input[data-unit="melee_grunt"][data-field="bodyScale"]',
      ),
    ).toBeTruthy();
    for (const field of ['radius', 'bodyScale', 'attackWindup'] as const) {
      expect(
        document.querySelector(`td[data-field="${field}"] .unit-stats-mini-bar`),
      ).toBeTruthy();
    }

    page.dispose();
  });

  it('修改生命后保存会 apply 并请求写回接口', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onApplied = vi.fn();
    const page = createUnitStatsPage({ onBack: vi.fn(), onApplied });
    page.show();

    const hpInput = document.querySelector<HTMLInputElement>(
      'input[data-unit="melee_grunt"][data-field="maxHp"]',
    );
    expect(hpInput).toBeTruthy();
    hpInput!.value = '999';
    hpInput!.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('#btn-unit-stats-save')?.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(onApplied).toHaveBeenCalled();
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/__pb/unit-configs');
    expect(dumpUnitConfigDrafts().melee_grunt.levels?.['1']?.maxHp).toBe(999);

    resetUnitConfigsToDefault();
    expect(UNIT_CONFIGS.melee_grunt.maxHp).not.toBe(999);
    page.dispose();
  });

  it('有技能兵种可编辑技能参数并保存写回', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = createUnitStatsPage({ onBack: vi.fn() });
    page.show();

    expect(
      document.querySelector('td[data-field="skill"] input[data-skill="charge"]'),
    ).toBeTruthy();
    const gruntSkill = document.querySelector<HTMLTableCellElement>(
      'tr[data-unit="melee_grunt"] td[data-field="skill"]',
    );
    expect(gruntSkill?.textContent).toBe('—');

    const hitDamage = document.querySelector<HTMLInputElement>(
      'input[data-unit="melee_cavalry"][data-skill="charge"][data-field="hitDamage"]',
    );
    expect(hitDamage).toBeTruthy();
    hitDamage!.value = '77';
    hitDamage!.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('#btn-unit-stats-save')?.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(dumpUnitConfigDrafts().melee_cavalry.levels?.['1']?.charge?.hitDamage).toBe(77);

    resetUnitConfigsToDefault();
    expect(UNIT_CONFIGS.melee_cavalry.charge).toBeTruthy();
    page.dispose();
  });

  it('可为兵种配置标签并保存写回', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = createUnitStatsPage({ onBack: vi.fn() });
    page.show();

    const tagInput = document.querySelector<HTMLInputElement>(
      'input[data-unit="melee_grunt"][data-field="tag"]',
    );
    expect(tagInput).toBeTruthy();
    expect(tagInput!.value).toBe('近战');
    tagInput!.value = '先锋';
    tagInput!.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('#btn-unit-stats-save')?.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(dumpUnitConfigDrafts().melee_grunt.tag).toBe('先锋');
    expect(dumpUnitConfigDrafts().melee_grunt.levels?.['1']).not.toHaveProperty('tag');

    const drafts = dumpUnitConfigDrafts();
    drafts.melee_grunt.tag = '近战';
    applyUnitConfigDrafts(drafts);
    captureUnitConfigsAsDefault();
    page.dispose();
  });

  it('overlay 关闭不走 onBack', () => {
    const onBack = vi.fn();
    const page = createUnitStatsPage({ onBack });
    page.show();

    page.hide();
    page.showAsOverlay();
    expect(document.querySelector('#unit-stats')?.classList.contains('is-overlay')).toBe(true);
    document.querySelector<HTMLButtonElement>('#btn-unit-stats-back')?.click();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector('#unit-stats')?.classList.contains('is-hidden')).toBe(true);
    page.dispose();
  });
});
