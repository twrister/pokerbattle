// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createRun } from '@pb/sim';
import {
  createEndlessStatsPanel,
  describePickedBoons,
  describeRunStats,
} from '../src/ui/endlessStatsPanel.js';

beforeEach(() => {
  document.body.innerHTML = `
    <section id="endless-stats" class="is-hidden">
      <strong id="endless-stats-title"></strong>
      <ul id="endless-stats-list"></ul>
      <ul id="endless-stats-boons"></ul>
    </section>`;
});

describe('本局叠加面板', () => {
  it('标题带波次，属性列表覆盖全部继承值', () => {
    const run = { ...createRun(7), wave: 3, handLimit: 8, wildCards: 1 };
    createEndlessStatsPanel().show(run);

    const root = document.querySelector('#endless-stats')!;
    expect(root.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#endless-stats-title')?.textContent).toBe('第 3 波 · 本局叠加');
    const lines = [...document.querySelectorAll('#endless-stats-list li')].map((li) => li.textContent);
    expect(lines).toEqual(['主堡 100%', '手牌上限 8', '起手 5 张', '发牌 5 秒', '万能牌 1']);
  });

  it('拿到回血强化后才补一行回血', () => {
    expect(describeRunStats(createRun(1))).not.toContain('每波回血 20%');
    const stats = describeRunStats({ ...createRun(1), regenPerWave: 0.2 });
    expect(stats).toContain('每波回血 20%');
  });

  it('已选强化按名字聚合次数，未知 id 跳过', () => {
    expect(describePickedBoons(['hand_limit', 'hand_limit', 'gone', 'regen'])).toEqual([
      { id: 'hand_limit', name: '扩充手牌', count: 2 },
      { id: 'regen', name: '自愈城砖', count: 1 },
    ]);
  });

  it('强化 chip 展示次数，没选过时整块隐藏', () => {
    const panel = createEndlessStatsPanel();
    panel.show({ ...createRun(2), boons: ['hand_limit', 'hand_limit'] });
    const chips = [...document.querySelectorAll('#endless-stats-boons li')].map((li) => li.textContent);
    expect(chips).toEqual(['扩充手牌 ×2']);

    panel.show(createRun(2));
    expect(document.querySelector('#endless-stats-boons')?.classList.contains('is-hidden')).toBe(true);
  });

  it('hide 收掉面板', () => {
    const panel = createEndlessStatsPanel();
    panel.show(createRun(1));
    panel.hide();
    expect(document.querySelector('#endless-stats')?.classList.contains('is-hidden')).toBe(true);
  });
});
