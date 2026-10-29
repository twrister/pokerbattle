// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ENDLESS_MIN_DRAW_INTERVAL, MAX_HAND_SIZE, MAX_WILD_CARDS, createRun } from '@pb/sim';
import { createEndlessStatsPanel, describeRunStats } from '../src/ui/endlessStatsPanel.js';

beforeEach(() => {
  document.body.innerHTML = `
    <section id="endless-stats" class="is-hidden">
      <strong id="endless-stats-title"></strong>
      <ul id="endless-stats-list"></ul>
    </section>`;
});

/** 取某一行的全部文本，按「标签 脚注 当前值」拼起来方便断言。 */
function rowTexts(): string[] {
  return [...document.querySelectorAll('#endless-stats-list li')].map((li) =>
    [...li.querySelectorAll('span')].map((span) => span.textContent).join(' | '),
  );
}

describe('本局叠加面板', () => {
  it('标题不带波次，未强化的属性整行不显示', () => {
    createEndlessStatsPanel().show(createRun(7));

    const root = document.querySelector('#endless-stats')!;
    expect(root.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#endless-stats-title')?.textContent).toBe('本局叠加');

    // 默认局一项都没叠上去，只留主堡这一行实时值
    expect(describeRunStats(createRun(7)).map((row) => row.label)).toEqual(['主堡']);
    expect(rowTexts()).toEqual(['主堡 |  | 100%']);
  });

  it('叠加后只显示拿到的那几行，并给出初始值、增量与当前值', () => {
    const run = { ...createRun(3), handLimit: 9, drawIntervalSeconds: 3.5, wildCards: 2 };
    const rows = describeRunStats(run);
    expect(rows.map((row) => row.label)).toEqual(['主堡', '手牌上限', '发牌间隔', '万能牌']);

    const handLimit = rows.find((row) => row.label === '手牌上限');
    const draw = rows.find((row) => row.label === '发牌间隔');
    expect(handLimit).toMatchObject({ current: '9', base: '7', delta: '+2', maxed: false });
    expect(draw).toMatchObject({ current: '3.5s', base: '5s', delta: '-1.5s', maxed: false });

    createEndlessStatsPanel().show({ ...createRun(3), handLimit: 9, drawIntervalSeconds: 3.5 });
    expect(rowTexts()).toEqual(['主堡 |  | 100%', '手牌上限 | 初始7 +2 | 9', '发牌间隔 | 初始5s -1.5s | 3.5s']);
  });

  it('到上限的项标 MAX', () => {
    const run = {
      ...createRun(4),
      handLimit: MAX_HAND_SIZE,
      drawIntervalSeconds: ENDLESS_MIN_DRAW_INTERVAL,
      wildCards: MAX_WILD_CARDS,
    };
    const maxed = describeRunStats(run)
      .filter((row) => row.maxed)
      .map((row) => row.label);
    expect(maxed).toEqual(['手牌上限', '发牌间隔', '万能牌']);

    createEndlessStatsPanel().show(run);
    const badges = [...document.querySelectorAll('#endless-stats-list .endless-stat-max')];
    expect(badges).toHaveLength(3);
    expect(badges[0].getAttribute('title')).toBe('已到上限');
  });

  it('回血强化叠满 30% 后标上限', () => {
    const rows = describeRunStats({ ...createRun(1), regenPerWave: 0.2 });
    expect(rows.find((row) => row.label === '每波回血')).toMatchObject({
      current: '20%',
      base: '0%',
      delta: '+20%',
      maxed: false,
    });
    expect(describeRunStats({ ...createRun(1), regenPerWave: 0.3 }).at(-1)?.maxed).toBe(true);
  });

  it('没有回血强化时不出现回血行', () => {
    expect(describeRunStats(createRun(1)).some((row) => row.label === '每波回血')).toBe(false);
  });

  it('有继承阵容时才补一行继承单位', () => {
    expect(describeRunStats(createRun(1)).some((row) => row.label === '继承单位')).toBe(false);
    const stats = describeRunStats({
      ...createRun(1),
      carriedUnits: [
        { faction: 0, typeId: 'melee_grunt', x: 9, y: 5, hpRatio: 0.6 },
        { faction: 0, typeId: 'ranged_archer', x: 4, y: 4, hpRatio: 1 },
      ],
    });
    expect(stats.at(-1)).toMatchObject({ label: '继承单位', current: '2' });
  });

  it('三选一期间提升层级，收起时恢复', () => {
    const panel = createEndlessStatsPanel();
    panel.show(createRun(1), true);
    expect(document.querySelector('#endless-stats')?.classList.contains('is-elevated')).toBe(true);

    panel.hide();
    const root = document.querySelector('#endless-stats')!;
    expect(root.classList.contains('is-elevated')).toBe(false);
    expect(root.classList.contains('is-hidden')).toBe(true);
  });

  it('hide 收掉面板', () => {
    const panel = createEndlessStatsPanel();
    panel.show(createRun(1));
    panel.hide();
    expect(document.querySelector('#endless-stats')?.classList.contains('is-hidden')).toBe(true);
  });
});
