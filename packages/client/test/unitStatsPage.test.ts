// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UNIT_CONFIGS, dumpUnitConfigDrafts } from '@pb/sim';
import { createUnitStatsPage } from '../src/ui/unitStatsPage.js';

function mountDom(): void {
  document.body.innerHTML = `
    <main id="unit-stats" class="is-hidden" aria-hidden="true">
      <button id="btn-unit-stats-back" type="button">返回图鉴</button>
      <nav id="unit-stats-tabs"></nav>
      <section id="unit-stats-panel"></section>
      <div id="unit-stats-status"></div>
      <button id="btn-unit-stats-save" type="button">保存</button>
      <button id="btn-unit-stats-reset" type="button">重置</button>
    </main>
  `;
}

describe('单位参数页', () => {
  beforeEach(() => {
    mountDom();
    vi.restoreAllMocks();
  });

  it('总览表展示绝对值，并可切换到柱状与雷达对比', () => {
    const page = createUnitStatsPage({ onBack: vi.fn() });
    page.show();

    const rows = document.querySelectorAll('.unit-stats-table tbody tr');
    expect(rows.length).toBe(14);
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

    const tabNamed = (name: string): HTMLButtonElement | undefined =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.unit-stats-tab')).find(
        (button) => button.textContent === name,
      );

    tabNamed('属性柱状')?.click();
    expect(document.querySelectorAll('.unit-stats-bar')).toHaveLength(14);
    expect(document.querySelector('.unit-stats-svg')?.getAttribute('aria-label')).toContain('生命');

    tabNamed('兵种雷达')?.click();
    expect(document.querySelectorAll('.unit-stats-radar-option')).toHaveLength(14);
    expect(document.querySelector('.unit-stats-radar-poly')).toBeTruthy();
    expect(document.querySelector('.unit-stats-radar-table')).toBeTruthy();

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

    // 恢复快照，避免污染其它用例依赖的运行时配置
    document.querySelector<HTMLButtonElement>('#btn-unit-stats-reset')?.click();
    expect(UNIT_CONFIGS.melee_grunt.maxHp).not.toBe(999);
    page.dispose();
  });

  it('雷达最多勾选 6 个兵种；overlay 关闭不走 onBack', () => {
    const onBack = vi.fn();
    const page = createUnitStatsPage({ onBack });
    page.show();

    Array.from(document.querySelectorAll<HTMLButtonElement>('.unit-stats-tab'))
      .find((button) => button.textContent === '兵种雷达')
      ?.click();

    // 每次勾选会重绘，需重新查询未勾选项，避免点到已卸载节点
    for (let i = 0; i < 8; i += 1) {
      const next = document.querySelector<HTMLInputElement>(
        '.unit-stats-radar-option input:not(:checked):not(:disabled)',
      );
      next?.click();
    }
    const checkboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('.unit-stats-radar-option input'),
    );
    expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(6);
    expect(checkboxes.some((checkbox) => checkbox.disabled && !checkbox.checked)).toBe(true);

    page.hide();
    page.showAsOverlay();
    expect(document.querySelector('#unit-stats')?.classList.contains('is-overlay')).toBe(true);
    document.querySelector<HTMLButtonElement>('#btn-unit-stats-back')?.click();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector('#unit-stats')?.classList.contains('is-hidden')).toBe(true);
    page.dispose();
  });
});
