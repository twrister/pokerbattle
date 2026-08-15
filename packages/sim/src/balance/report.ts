import { HAND_CATEGORY_NAMES, HAND_CATEGORY_STRENGTH_ORDER } from '../config/cardFormations.js';
import { NUMBERS_FLAT_NOTE, formatRankTier, type Entry } from './entries.js';
import {
  categoryMedians,
  intersectViolations,
  type EntryRating,
  type MonotonicityViolation,
  type PairAggregate,
} from './rating.js';

export interface ReportInput {
  entries: readonly Entry[];
  soloRatings: Map<string, EntryRating> | null;
  meleeRatings: Map<string, EntryRating> | null;
  pairs: readonly PairAggregate[];
  soloViolations: readonly MonotonicityViolation[];
  meleeViolations: readonly MonotonicityViolation[];
  seeds: number;
  meleeRounds: number;
}

/** 生成 Markdown 主报表：违例置顶，再列牌位 / 牌型阶梯与全量表。 */
export function renderStrengthMarkdown(input: ReportInput): string {
  const lines: string[] = [];
  lines.push('# 兵种强度验证');
  lines.push('');
  lines.push(`独立对拆种子数：${input.seeds}（每对含双向换边）。混战轮数：${input.meleeRounds}。`);
  lines.push('');
  lines.push(`> ${NUMBERS_FLAT_NOTE}`);
  lines.push('');

  const shared = intersectViolations(input.soloViolations, input.meleeViolations);
  lines.push('## 独立与混战均违例');
  lines.push('');
  if (!input.soloRatings || !input.meleeRatings) {
    lines.push('需同时跑独立与混战（`--mode all`）才能汇总双侧违例。');
  } else if (shared.length === 0) {
    lines.push('无：没有相邻牌位/牌型在两种模式里都倒挂。');
  } else {
    lines.push('这些相邻阶梯在两种模式里都倒挂，调数值时优先处理。');
    lines.push('');
    const ranks = shared.filter((row) => row.kind === 'rank');
    const cats = shared.filter((row) => row.kind === 'category');
    if (ranks.length > 0) {
      lines.push('**牌位**');
      lines.push('');
      for (const row of ranks) {
        lines.push(
          `- ${row.lowerLabel} > ${row.higherLabel}：独立 ${fmtScore(row.solo.lowerScore)} > ${fmtScore(row.solo.higherScore)}；混战 ${fmtScore(row.melee.lowerScore)} > ${fmtScore(row.melee.higherScore)}`,
        );
      }
      lines.push('');
    }
    if (cats.length > 0) {
      lines.push('**牌型**');
      lines.push('');
      for (const row of cats) {
        lines.push(
          `- ${row.lowerLabel} > ${row.higherLabel}：独立 ${fmtScore(row.solo.lowerScore)} > ${fmtScore(row.solo.higherScore)}；混战 ${fmtScore(row.melee.lowerScore)} > ${fmtScore(row.melee.higherScore)}`,
        );
      }
      lines.push('');
    }
    const involved = uniqueLabels(shared);
    lines.push(`涉及：${involved.join('、')}`);
  }
  lines.push('');

  const allViolations = [
    ...input.soloViolations.map((row) => ({ ...row, source: '独立' })),
    ...input.meleeViolations.map((row) => ({ ...row, source: '混战' })),
  ];
  lines.push('## 单调性违例（分模式）');
  lines.push('');
  if (allViolations.length === 0) {
    lines.push('无违例：单张牌位阶梯与牌型稀有度阶梯均满足非递减。');
  } else {
    for (const row of allViolations) {
      const kind = row.kind === 'rank' ? '牌位' : '牌型';
      lines.push(`- [${row.source}/${kind}] ${row.message}`);
    }
  }
  lines.push('');

  lines.push('## 牌位阶梯（单张）');
  lines.push('');
  lines.push('| 牌位 | 搭配 | 独立分 | 混战分 | 差值 |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  const singles = input.entries
    .filter((entry) => entry.category === 'single')
    .slice()
    .sort((a, b) => a.rankTier - b.rankTier || a.key.localeCompare(b.key));
  for (const entry of singles) {
    const solo = input.soloRatings?.get(entry.key)?.score;
    const melee = input.meleeRatings?.get(entry.key)?.score;
    const delta = solo !== undefined && melee !== undefined ? melee - solo : undefined;
    lines.push(
      `| ${formatRankTier(entry.rankTier)} | ${escapeCell(entry.label)} | ${fmtScore(solo)} | ${fmtScore(melee)} | ${fmtDelta(delta)} |`,
    );
  }
  lines.push('');

  lines.push('## 牌型阶梯（按稀有度升序）');
  lines.push('');
  lines.push('| 牌型 | 条目数 | 独立中位 | 混战中位 |');
  lines.push('| --- | ---: | ---: | ---: |');
  const soloCats = input.soloRatings ? categoryMedians(input.entries, input.soloRatings) : [];
  const meleeCats = input.meleeRatings ? categoryMedians(input.entries, input.meleeRatings) : [];
  const catOrder = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();
  for (const category of catOrder) {
    const solo = soloCats.find((row) => row.category === category);
    const melee = meleeCats.find((row) => row.category === category);
    const count = solo?.count ?? melee?.count ?? 0;
    if (count === 0) continue;
    lines.push(
      `| ${HAND_CATEGORY_NAMES[category]} | ${count} | ${fmtScore(solo?.score)} | ${fmtScore(melee?.score)} |`,
    );
  }
  lines.push('');

  lines.push('## 全部条目');
  lines.push('');
  lines.push('| 牌型 | 牌位 | 搭配 | 独立分 | 混战分 | 差值 |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: |');
  const sorted = input.entries.slice().sort((a, b) => {
    const ai = catOrder.indexOf(a.category);
    const bi = catOrder.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    if (a.rankTier !== b.rankTier) return a.rankTier - b.rankTier;
    return a.key.localeCompare(b.key);
  });
  for (const entry of sorted) {
    const solo = input.soloRatings?.get(entry.key)?.score;
    const melee = input.meleeRatings?.get(entry.key)?.score;
    const delta = solo !== undefined && melee !== undefined ? melee - solo : undefined;
    lines.push(
      `| ${HAND_CATEGORY_NAMES[entry.category]} | ${formatRankTier(entry.rankTier)} | ${escapeCell(entry.label)} | ${fmtScore(solo)} | ${fmtScore(melee)} | ${fmtDelta(delta)} |`,
    );
  }
  lines.push('');
  lines.push('差值 = 混战分 − 独立分。正值表示该搭配在组合环境中更值钱，负值表示单挑强、团战弱。');
  lines.push('');
  return lines.join('\n');
}

/** 两两胜率矩阵；未对拆的格子留空。 */
export function renderMatchupCsv(
  entries: readonly Entry[],
  pairs: readonly PairAggregate[],
): string {
  const lookup = new Map<string, PairAggregate>();
  for (const pair of pairs) {
    lookup.set(`${pair.aKey}\t${pair.bKey}`, pair);
  }
  const keys = entries.map((entry) => entry.key);
  const labels = new Map(entries.map((entry) => [entry.key, entry.label]));
  const header = ['A \\ B', ...keys.map((key) => csvCell(labels.get(key) ?? key))];
  const rows = [header.join(',')];
  for (const aKey of keys) {
    const cells = [csvCell(labels.get(aKey) ?? aKey)];
    for (const bKey of keys) {
      if (aKey === bKey) {
        cells.push('0.50');
        continue;
      }
      const direct = lookup.get(`${aKey}\t${bKey}`);
      if (direct) {
        cells.push(direct.meanScore.toFixed(3));
        continue;
      }
      const flipped = lookup.get(`${bKey}\t${aKey}`);
      if (flipped) {
        cells.push((1 - flipped.meanScore).toFixed(3));
        continue;
      }
      cells.push('');
    }
    rows.push(cells.join(','));
  }
  return `${rows.join('\n')}\n`;
}

/** 双侧违例里出现过的牌位/牌型名，去重后按首次出现排序。 */
function uniqueLabels(shared: readonly { lowerLabel: string; higherLabel: string }[]): string[] {
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

function fmtScore(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(1);
}

function fmtDelta(value: number | undefined): string {
  if (value === undefined) return '—';
  const text = value.toFixed(1);
  return value > 0 ? `+${text}` : text;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '/');
}

function csvCell(text: string): string {
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
