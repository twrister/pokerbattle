import {
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_STRENGTH_ORDER,
  NUMBERS_FLAT_NOTE,
  categoryMedians,
  formatRankTier,
  type BalanceReport,
} from '@pb/sim';

/** 把结构化报告画成与 strength.md 同结构的 DOM 表。 */
export function renderBalanceReport(root: HTMLElement, report: BalanceReport): void {
  const sections: HTMLElement[] = [];
  sections.push(renderSharedSection(report));
  sections.push(renderModeViolations(report));
  sections.push(renderRankTable(report));
  sections.push(renderCategoryTable(report));
  sections.push(renderAllEntriesTable(report));
  const note = document.createElement('p');
  note.textContent = `${NUMBERS_FLAT_NOTE} 差值 = 混战分 − 独立分。`;
  sections.push(note);
  root.replaceChildren(...sections);
}

function renderSharedSection(report: BalanceReport): HTMLElement {
  const section = sectionBlock('独立与混战均违例');
  const shared = report.sharedViolations;
  if (!report.soloRatings || !report.meleeRatings) {
    section.appendChild(textPara('需同时跑独立与混战才能汇总双侧违例。'));
    return section;
  }
  if (shared.length === 0) {
    section.appendChild(textPara('无：没有相邻牌位/牌型在两种模式里都倒挂。'));
    return section;
  }
  section.appendChild(textPara('这些相邻阶梯在两种模式里都倒挂，调数值时优先处理。'));
  const ranks = shared.filter((row) => row.kind === 'rank');
  const cats = shared.filter((row) => row.kind === 'category');
  if (ranks.length > 0) {
    section.appendChild(subTitle('牌位'));
    section.appendChild(violationList(ranks));
  }
  if (cats.length > 0) {
    section.appendChild(subTitle('牌型'));
    section.appendChild(violationList(cats));
  }
  const involved = uniqueSharedLabels(shared);
  section.appendChild(textPara(`涉及：${involved.join('、')}`));
  return section;
}

function renderModeViolations(report: BalanceReport): HTMLElement {
  const section = sectionBlock('单调性违例（分模式）');
  const rows = [
    ...report.soloViolations.map((row) => `[独立/${row.kind === 'rank' ? '牌位' : '牌型'}] ${row.message}`),
    ...report.meleeViolations.map((row) => `[混战/${row.kind === 'rank' ? '牌位' : '牌型'}] ${row.message}`),
  ];
  if (rows.length === 0) {
    section.appendChild(textPara('无违例：单张牌位阶梯与牌型稀有度阶梯均满足非递减。'));
    return section;
  }
  const list = document.createElement('ul');
  for (const text of rows) {
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function renderRankTable(report: BalanceReport): HTMLElement {
  const section = sectionBlock('牌位阶梯（单张）');
  const singles = report.entries
    .filter((entry) => entry.category === 'single')
    .slice()
    .sort((a, b) => a.rankTier - b.rankTier || a.key.localeCompare(b.key));
  const table = scoreTable(
    ['牌位', '搭配', '独立分', '混战分', '差值'],
    singles.map((entry) => {
      const solo = report.soloRatings?.get(entry.key)?.score;
      const melee = report.meleeRatings?.get(entry.key)?.score;
      return [
        formatRankTier(entry.rankTier),
        entry.label,
        fmtScore(solo),
        fmtScore(melee),
        fmtDelta(solo, melee),
      ];
    }),
    [false, false, true, true, true],
  );
  section.appendChild(table);
  return section;
}

function renderCategoryTable(report: BalanceReport): HTMLElement {
  const section = sectionBlock('牌型阶梯（按稀有度升序）');
  const soloCats = report.soloRatings ? categoryMedians(report.entries, report.soloRatings) : [];
  const meleeCats = report.meleeRatings ? categoryMedians(report.entries, report.meleeRatings) : [];
  const catOrder = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();
  const rows: string[][] = [];
  for (const category of catOrder) {
    const solo = soloCats.find((row) => row.category === category);
    const melee = meleeCats.find((row) => row.category === category);
    const count = solo?.count ?? melee?.count ?? 0;
    if (count === 0) continue;
    rows.push([
      HAND_CATEGORY_NAMES[category],
      String(count),
      fmtScore(solo?.score),
      fmtScore(melee?.score),
    ]);
  }
  section.appendChild(scoreTable(['牌型', '条目数', '独立中位', '混战中位'], rows, [false, true, true, true]));
  return section;
}

function renderAllEntriesTable(report: BalanceReport): HTMLElement {
  const section = sectionBlock('全部条目');
  const catOrder = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();
  const sorted = report.entries.slice().sort((a, b) => {
    const ai = catOrder.indexOf(a.category);
    const bi = catOrder.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    if (a.rankTier !== b.rankTier) return a.rankTier - b.rankTier;
    return a.key.localeCompare(b.key);
  });
  const table = scoreTable(
    ['牌型', '牌位', '搭配', '独立分', '混战分', '差值'],
    sorted.map((entry) => {
      const solo = report.soloRatings?.get(entry.key)?.score;
      const melee = report.meleeRatings?.get(entry.key)?.score;
      return [
        HAND_CATEGORY_NAMES[entry.category],
        formatRankTier(entry.rankTier),
        entry.label,
        fmtScore(solo),
        fmtScore(melee),
        fmtDelta(solo, melee),
      ];
    }),
    [false, false, false, true, true, true],
  );
  section.appendChild(table);
  return section;
}

function violationList(
  rows: readonly {
    lowerLabel: string;
    higherLabel: string;
    solo: { lowerScore: number; higherScore: number };
    melee: { lowerScore: number; higherScore: number };
  }[],
): HTMLUListElement {
  const list = document.createElement('ul');
  for (const row of rows) {
    const item = document.createElement('li');
    item.textContent =
      `${row.lowerLabel} > ${row.higherLabel}：独立 ${fmtScore(row.solo.lowerScore)} > ${fmtScore(row.solo.higherScore)}；混战 ${fmtScore(row.melee.lowerScore)} > ${fmtScore(row.melee.higherScore)}`;
    list.appendChild(item);
  }
  return list;
}

function uniqueSharedLabels(shared: readonly { lowerLabel: string; higherLabel: string }[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of shared) {
    for (const label of [row.lowerLabel, row.higherLabel]) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

function sectionBlock(title: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'balance-report-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function subTitle(text: string): HTMLElement {
  const heading = document.createElement('strong');
  heading.textContent = text;
  return heading;
}

function textPara(text: string): HTMLParagraphElement {
  const para = document.createElement('p');
  para.textContent = text;
  return para;
}

function scoreTable(
  headers: readonly string[],
  rows: readonly string[][],
  numeric: readonly boolean[],
): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'balance-report-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((header, index) => {
    const cell = document.createElement('th');
    cell.textContent = header;
    if (numeric[index]) cell.className = 'is-num';
    headRow.appendChild(cell);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (numeric[index]) cell.className = 'is-num';
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  return table;
}

function fmtScore(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(1);
}

function fmtDelta(solo: number | undefined, melee: number | undefined): string {
  if (solo === undefined || melee === undefined) return '—';
  const value = melee - solo;
  const text = value.toFixed(1);
  return value > 0 ? `+${text}` : text;
}
