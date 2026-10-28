import { getBoonById, type EndlessRunState } from '@pb/sim';

export interface EndlessStatsPanelHandle {
  /** 进局/重开时刷新并显示本局叠加。 */
  show(run: EndlessRunState): void;
  hide(): void;
}

/** 已选强化的聚合结果：同名强化合并成一条并带次数。 */
export interface BoonSummary {
  id: string;
  name: string;
  count: number;
}

/**
 * 无限防守局内左上角的「本局叠加」面板。
 * 替代战役的目标卡片：无限波没有通关条件，玩家更需要看清这局攒到了什么。
 * DOM 结构见 index.html 的 #endless-stats。
 */
export function createEndlessStatsPanel(): EndlessStatsPanelHandle {
  const root = required<HTMLElement>('#endless-stats');
  const title = required<HTMLElement>('#endless-stats-title');
  const list = required<HTMLUListElement>('#endless-stats-list');
  const boons = required<HTMLUListElement>('#endless-stats-boons');

  return {
    show(run) {
      title.textContent = `第 ${run.wave} 波 · 本局叠加`;
      list.replaceChildren(
        ...describeRunStats(run).map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }),
      );
      // 没选过强化时整块留空，避免出现一条空行
      const picked = describePickedBoons(run.boons);
      boons.replaceChildren(
        ...picked.map((boon) => {
          const li = document.createElement('li');
          li.textContent = boon.count > 1 ? `${boon.name} ×${boon.count}` : boon.name;
          return li;
        }),
      );
      boons.classList.toggle('is-hidden', picked.length === 0);
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
  };
}

/** 本局继承属性的展示行，顺序按玩家关心的强弱排。 */
export function describeRunStats(run: EndlessRunState): string[] {
  const lines = [
    `主堡 ${Math.round(run.castleHpRatio * 100)}%`,
    `手牌上限 ${run.handLimit}`,
    `起手 ${run.initialHandSize} 张`,
    `发牌 ${run.drawIntervalSeconds} 秒`,
    `万能牌 ${run.wildCards}`,
  ];
  // 回血只在拿到对应强化后才出现，避免常驻一条 0% 噪音
  if (run.regenPerWave > 0) lines.push(`每波回血 ${Math.round(run.regenPerWave * 100)}%`);
  return lines;
}

/** 把已选强化 id 聚合成「名字 + 次数」，未知 id（旧存档）直接跳过。 */
export function describePickedBoons(ids: readonly string[]): BoonSummary[] {
  const summary = new Map<string, BoonSummary>();
  for (const id of ids) {
    const boon = getBoonById(id);
    if (!boon) continue;
    const existing = summary.get(id);
    if (existing) existing.count += 1;
    else summary.set(id, { id, name: boon.name, count: 1 });
  }
  return [...summary.values()];
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`本局叠加面板缺少元素：${selector}`);
  return element;
}
