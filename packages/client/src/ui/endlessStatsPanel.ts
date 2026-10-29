import {
  ENDLESS_MIN_DRAW_INTERVAL,
  MAX_HAND_SIZE,
  MAX_WILD_CARDS,
  createRun,
  type EndlessRunState,
} from '@pb/sim';

export interface EndlessStatsPanelHandle {
  /**
   * 进局/重开/三选一期间刷新并显示本局叠加。
   * elevated 为真时抬到强化弹层遮罩之上，供选强化时对照查看。
   */
  show(run: EndlessRunState, elevated?: boolean): void;
  hide(): void;
}

/**
 * 一行叠加属性的展示数据。
 * 当前值必填；初始值与叠加量只在真正被强化过时出现，没叠加的属性整行都不显示。
 */
export interface StatRow {
  label: string;
  /** 当前生效值，已带单位。 */
  current: string;
  /** 未强化时的初始值，格式与 current 保持一致。 */
  base?: string;
  /** 相对初始值的叠加量，带正负号；为 0 时省略整段。 */
  delta?: string;
  /** 是否已到该项上限：继续强化不会再出现该选项。 */
  maxed?: boolean;
}

/** 每波回血强化的叠加上限，与 sim 侧强化可用条件（regenPerWave < 0.3）保持一致。 */
const REGEN_CAP = 0.3;

/** 初始值统一取新开一局的默认状态，避免在 UI 里重复写死默认数字。 */
const DEFAULT_RUN = createRun(0);

/**
 * 无限防守局内右上角的「本局叠加」面板。
 * 替代战役的目标卡片：无限波没有通关条件，玩家更需要看清这局攒到了什么。
 * DOM 结构见 index.html 的 #endless-stats。
 */
export function createEndlessStatsPanel(): EndlessStatsPanelHandle {
  const root = required<HTMLElement>('#endless-stats');
  const title = required<HTMLElement>('#endless-stats-title');
  const list = required<HTMLUListElement>('#endless-stats-list');

  return {
    show(run, elevated = false) {
      // 波次已经由顶部进度条表达，这块只说明「这局攒了什么」
      title.textContent = '本局叠加';
      list.replaceChildren(...describeRunStats(run).map(renderStatRow));
      // 三选一期间弹层遮罩会盖住面板，需要临时抬高，选完下一波自动恢复
      root.classList.toggle('is-elevated', elevated);
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      root.classList.remove('is-elevated');
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
  };
}

/**
 * 本局继承属性的展示行，顺序按玩家关心的强弱排。
 * 每行回答三件事：现在多少、从多少堆上来、还能不能继续堆；
 * 没拿到对应强化的属性整行不出现，避免默认局满屏初始值。
 */
export function describeRunStats(run: EndlessRunState): StatRow[] {
  const rows: StatRow[] = [
    // 主堡血量是每波浮动的实时值，始终显示
    { label: '主堡', current: `${Math.round(run.castleHpRatio * 100)}%` },
    {
      label: '手牌上限',
      current: `${run.handLimit}`,
      base: `${DEFAULT_RUN.handLimit}`,
      delta: formatDelta(run.handLimit - DEFAULT_RUN.handLimit),
      maxed: run.handLimit >= MAX_HAND_SIZE,
    },
    {
      label: '起手',
      current: `${run.initialHandSize} 张`,
      base: `${DEFAULT_RUN.initialHandSize} 张`,
      delta: formatDelta(run.initialHandSize - DEFAULT_RUN.initialHandSize),
      // 起手牌不能超过手牌上限，两者顶到一起就加不动了
      maxed: run.initialHandSize >= run.handLimit,
    },
    {
      label: '发牌间隔',
      current: `${formatSeconds(run.drawIntervalSeconds)}s`,
      base: `${formatSeconds(DEFAULT_RUN.drawIntervalSeconds)}s`,
      // 发牌是「越快越好」，所以叠加量天然为负
      delta: formatDelta(run.drawIntervalSeconds - DEFAULT_RUN.drawIntervalSeconds, 's'),
      maxed: run.drawIntervalSeconds <= ENDLESS_MIN_DRAW_INTERVAL,
    },
    {
      label: '万能牌',
      current: `${run.wildCards}`,
      base: `${DEFAULT_RUN.wildCards}`,
      delta: formatDelta(run.wildCards - DEFAULT_RUN.wildCards),
      maxed: run.wildCards >= MAX_WILD_CARDS,
    },
  ].filter(isPickedRow);
  // 回血只在拿到对应强化后才出现，避免常驻一条 0% 噪音
  if (run.regenPerWave > 0) {
    const percent = Math.round(run.regenPerWave * 100);
    rows.push({
      label: '每波回血',
      current: `${percent}%`,
      base: '0%',
      delta: `+${percent}%`,
      maxed: run.regenPerWave >= REGEN_CAP,
    });
  }
  // 继承阵容同理：第一波没有存活的兵，不显示这行
  const carried = run.carriedUnits?.length ?? 0;
  if (carried > 0) rows.push({ label: '继承单位', current: `${carried}` });
  return rows;
}

/**
 * 判断这一行是否值得展示：没有初始值的行（主堡、继承单位）始终显示，
 * 有初始值的行只有叠加过（delta 非空）才显示。
 */
function isPickedRow(row: StatRow): boolean {
  return row.base === undefined || row.delta !== undefined;
}

/**
 * 渲染一行：标签在左，右侧依次是「初始 +叠加」的灰字脚注和当前值，
 * 到上限时末尾再挂一枚 MAX 徽标，一眼就能看出这条还堆不堆得动。
 */
function renderStatRow(row: StatRow): HTMLLIElement {
  const li = document.createElement('li');
  li.append(statCell('endless-stat-label', row.label));

  const detail = document.createElement('span');
  detail.className = 'endless-stat-detail';
  // 只有叠加过才补灰色的「初始 +增量」，没变化时整段不出现
  if (row.base !== undefined && row.delta !== undefined) {
    detail.textContent = `初始${row.base} ${row.delta}`;
  }
  if (row.maxed) {
    const badge = statCell('endless-stat-max', 'MAX');
    badge.title = '已到上限';
    detail.append(badge);
  }
  // 没注解也要占位，保证各行当前值对齐成同一列
  li.append(detail, statCell('endless-stat-current', row.current));
  return li;
}

/** 建一个带样式类名的文本单元格。 */
function statCell(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** 把增量格式化成带正负号的文本；没有变化时返回 undefined 让调用方跳过。 */
function formatDelta(value: number, unit = ''): string | undefined {
  if (value === 0) return undefined;
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatSeconds(Math.abs(value))}${unit}`;
}

/** 去掉浮点误差：整数不带小数点，其余最多一位小数（发牌一档 0.5 秒）。 */
function formatSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`本局叠加面板缺少元素：${selector}`);
  return element;
}
