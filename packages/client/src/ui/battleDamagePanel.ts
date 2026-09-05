import { toFloat, type MatchState, type SlotDamageStats } from '@pb/sim';

/** 2v2 伤害面板只需要本机席、队友席和显示名。 */
export interface BattleDamagePanelContext {
  localName: string;
  localSlot?: number;
  teammateName?: string;
  teammateSlot?: number | null;
}

export interface BattleDamagePanelHandle {
  show(): void;
  hide(): void;
  setContext(context: BattleDamagePanelContext): void;
  update(match: MatchState): void;
}

type DamageTab = 'castle' | 'units';

/** 折叠状态本地记忆；无记录时默认收起，避免挡住战场。 */
const COLLAPSE_KEY = 'pb.battleDamagePanel.collapsed';
/** 当前页签记忆，避免每次进局都回到基地。 */
const TAB_KEY = 'pb.battleDamagePanel.tab';

const EMPTY_STATS: SlotDamageStats = { toCastle: 0, toUnits: 0 };

/**
 * 2v2 实时输出面板：基地 / 兵种分页，自己与队友各一条占比进度条。
 * 挂在顶部血条下方；1v1 始终隐藏；默认折叠。
 */
export function createBattleDamagePanel(): BattleDamagePanelHandle {
  const root = requiredElement<HTMLElement>('#battle-damage-panel');
  const toggle = requiredElement<HTMLButtonElement>('#btn-battle-damage-toggle');
  const castleTab = requiredElement<HTMLButtonElement>('#btn-battle-damage-tab-castle');
  const unitsTab = requiredElement<HTMLButtonElement>('#btn-battle-damage-tab-units');
  const selfName = requiredElement<HTMLElement>('#battle-damage-self-name');
  const mateName = requiredElement<HTMLElement>('#battle-damage-mate-name');
  const selfValue = requiredElement<HTMLElement>('#battle-damage-self-value');
  const mateValue = requiredElement<HTMLElement>('#battle-damage-mate-value');
  const selfBar = requiredElement<HTMLElement>('#battle-damage-self-bar');
  const mateBar = requiredElement<HTMLElement>('#battle-damage-mate-bar');

  let sessionVisible = false;
  let collapsed = readCollapsed();
  let tab = readTab();
  let lastTick = -1;
  let lastSelfName = '';
  let lastMateName = '';
  let lastSelfText = '';
  let lastMateText = '';
  let lastSelfWidth = '';
  let lastMateWidth = '';
  let selfStats: SlotDamageStats = EMPTY_STATS;
  let mateStats: SlotDamageStats = EMPTY_STATS;
  let context: BattleDamagePanelContext = {
    localName: '我',
    localSlot: 0,
  };

  const applyCollapsed = (): void => {
    root.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '伤害面板' : '收起';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };

  const applyTab = (): void => {
    castleTab.setAttribute('aria-selected', String(tab === 'castle'));
    unitsTab.setAttribute('aria-selected', String(tab === 'units'));
  };

  const setCollapsed = (next: boolean): void => {
    collapsed = next;
    applyCollapsed();
    writeStorage(COLLAPSE_KEY, collapsed ? '1' : '0');
  };

  /** 切换页签后立刻用缓存数字重绘，不必等下一帧。 */
  const setTab = (next: DamageTab): void => {
    if (tab === next) return;
    tab = next;
    applyTab();
    writeStorage(TAB_KEY, tab);
    renderValues();
  };

  const syncVisibility = (): void => {
    const is2v2 = context.teammateSlot != null;
    root.classList.toggle('is-hidden', !sessionVisible || !is2v2);
  };

  /** 当前页签下自己/队友的数值与队内占比条。 */
  const renderValues = (): void => {
    const selfAmount = tabAmount(selfStats, tab);
    const mateAmount = tabAmount(mateStats, tab);
    const total = selfAmount + mateAmount;
    writeText(selfValue, formatDamage(selfAmount), lastSelfText, (value) => {
      lastSelfText = value;
    });
    writeText(mateValue, formatDamage(mateAmount), lastMateText, (value) => {
      lastMateText = value;
    });
    writeWidth(selfBar, barWidth(selfAmount, total), lastSelfWidth, (value) => {
      lastSelfWidth = value;
    });
    writeWidth(mateBar, barWidth(mateAmount, total), lastMateWidth, (value) => {
      lastMateWidth = value;
    });
  };

  applyCollapsed();
  applyTab();
  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  castleTab.addEventListener('click', () => setTab('castle'));
  unitsTab.addEventListener('click', () => setTab('units'));

  return {
    show() {
      sessionVisible = true;
      lastTick = -1;
      syncVisibility();
    },
    hide() {
      sessionVisible = false;
      lastTick = -1;
      syncVisibility();
    },
    setContext(next) {
      context = next;
      syncVisibility();
    },
    update(match) {
      if (!sessionVisible || context.teammateSlot == null) return;
      const tick = match.world.tick;
      if (tick === lastTick) return;
      lastTick = tick;

      const localSlot = context.localSlot ?? 0;
      writeText(selfName, context.localName || '我', lastSelfName, (value) => {
        lastSelfName = value;
      });
      writeText(mateName, context.teammateName || '队友', lastMateName, (value) => {
        lastMateName = value;
      });
      selfStats = match.getSlotDamageStats(localSlot);
      mateStats = match.getSlotDamageStats(context.teammateSlot);
      renderValues();
    },
  };
}

/** 当前页签对应的累计伤害。 */
function tabAmount(stats: SlotDamageStats, tab: DamageTab): number {
  return tab === 'castle' ? stats.toCastle : stats.toUnits;
}

/** 队内占比；双方都是 0 时条宽为 0，避免空数据看起来像打满。 */
function barWidth(amount: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.max(0, Math.min(100, (amount / total) * 100))}%`;
}

/** 定点伤害转整数展示，避免 HUD 刷小数。 */
function formatDamage(amount: number): string {
  return String(Math.round(toFloat(amount)));
}

function writeText(
  element: HTMLElement,
  next: string,
  current: string,
  assign: (value: string) => void,
): void {
  if (current === next) return;
  element.textContent = next;
  assign(next);
}

function writeWidth(
  element: HTMLElement,
  next: string,
  current: string,
  assign: (value: string) => void,
): void {
  if (current === next) return;
  element.style.width = next;
  assign(next);
}

function readCollapsed(): boolean {
  const stored = readStorage(COLLAPSE_KEY);
  if (stored === null) return true;
  return stored === '1';
}

function readTab(): DamageTab {
  return readStorage(TAB_KEY) === 'units' ? 'units' : 'castle';
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式写不进 storage 时忽略
  }
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
