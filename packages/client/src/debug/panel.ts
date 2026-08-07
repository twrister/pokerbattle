import { Faction, UNIT_CONFIGS, UNIT_TYPE_IDS, type UnitTypeId } from '@pb/sim';
import type { SimLoop } from '../loop.js';

/** 可切换的倍速档位 */
const SPEED_STEPS = [1, 2, 4, 0.25, 0.5];
/** 状态栏刷新间隔，60fps 刷文本纯属浪费还看不清 */
const STATS_REFRESH_MS = 150;

export interface PanelOptions {
  loop: SimLoop;
  onClear: () => void;
  onBrawl: () => void;
  /** 清空后双方各随机一个兵种 1v1 */
  onRandomPk: () => void;
}

export interface PanelHandle {
  /** 当前选中的放兵阵营 */
  readonly faction: Faction;
  /** 当前选中的兵种 */
  readonly unitType: UnitTypeId;
  updateStats: (fps: number) => void;
  /** 配置面板改了兵种显示名后刷新底部按钮文案 */
  refreshUnitLabels: () => void;
  /** 移除全局快捷键和控件事件，供沙盒退出时释放 */
  dispose: () => void;
}

/** 把 HUD 里的按钮和 SimLoop 接起来，并定时刷新状态读数 */
export function createPanel(options: PanelOptions): PanelHandle {
  const { loop } = options;

  let faction: Faction = Faction.Blue;
  let unitType: UnitTypeId = UNIT_TYPE_IDS[0]!;
  let speedIndex = 0;
  let lastStatsAt = 0;

  const factionGroup = required<HTMLDivElement>('#faction-group');
  const unitGroup = required<HTMLDivElement>('#unit-group');
  const pauseButton = required<HTMLButtonElement>('#btn-pause');
  const stepButton = required<HTMLButtonElement>('#btn-step');
  const speedButton = required<HTMLButtonElement>('#btn-speed');
  const brawlButton = required<HTMLButtonElement>('#btn-brawl');
  const randomPkButton = required<HTMLButtonElement>('#btn-random-pk');
  const clearButton = required<HTMLButtonElement>('#btn-clear');

  const tickOut = required<HTMLElement>('#stat-tick');
  const unitsOut = required<HTMLElement>('#stat-units');
  const projectilesOut = required<HTMLElement>('#stat-projectiles');
  const hashOut = required<HTMLElement>('#stat-hash');
  const fpsOut = required<HTMLElement>('#stat-fps');

  // 兵种按钮直接由配置表生成，加新兵种不需要动 HTML
  for (const typeId of UNIT_TYPE_IDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.unit = typeId;
    button.textContent = UNIT_CONFIGS[typeId].name;
    button.addEventListener('click', () => selectUnit(typeId));
    unitGroup.appendChild(button);
  }

  function selectFaction(next: Faction): void {
    faction = next;
    for (const button of factionGroup.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.faction) === next));
    }
  }

  function selectUnit(next: UnitTypeId): void {
    unitType = next;
    for (const button of unitGroup.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.unit === next));
    }
  }

  function togglePause(): void {
    loop.paused = !loop.paused;
    pauseButton.textContent = loop.paused ? '继续' : '暂停';
    pauseButton.setAttribute('aria-pressed', String(loop.paused));
  }

  function cycleSpeed(): void {
    speedIndex = (speedIndex + 1) % SPEED_STEPS.length;
    loop.speed = SPEED_STEPS[speedIndex]!;
    speedButton.textContent = `${loop.speed}x`;
  }

  const selectFactionFromButton = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-faction]');
    if (button) selectFaction(Number(button.dataset.faction) as Faction);
  };

  const stepOnce = (): void => loop.stepOnce();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    switch (event.code) {
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9': {
        const index = Number(event.code.slice(5)) - 1;
        const next = UNIT_TYPE_IDS[index];
        if (next) selectUnit(next);
        break;
      }
      case 'KeyQ':
        selectFaction(Faction.Blue);
        break;
      case 'KeyE':
        selectFaction(Faction.Red);
        break;
      case 'Space':
        event.preventDefault();
        togglePause();
        break;
      case 'KeyN':
        loop.stepOnce();
        break;
      case 'KeyR':
        options.onClear();
        break;
      case 'KeyB':
        options.onBrawl();
        break;
    }
  };

  factionGroup.addEventListener('click', selectFactionFromButton);
  pauseButton.addEventListener('click', togglePause);
  stepButton.addEventListener('click', stepOnce);
  speedButton.addEventListener('click', cycleSpeed);
  brawlButton.addEventListener('click', options.onBrawl);
  randomPkButton.addEventListener('click', options.onRandomPk);
  clearButton.addEventListener('click', options.onClear);
  window.addEventListener('keydown', onKeyDown);

  selectFaction(faction);
  selectUnit(unitType);

  return {
    get faction() {
      return faction;
    },
    get unitType() {
      return unitType;
    },
    updateStats(fps: number) {
      const now = performance.now();
      if (now - lastStatsAt < STATS_REFRESH_MS) return;
      lastStatsAt = now;

      tickOut.textContent = String(loop.world.tick);
      unitsOut.textContent = String(loop.world.units.length);
      projectilesOut.textContent = String(loop.world.projectiles.length);
      hashOut.textContent = loop.world.hash().toString(16).padStart(8, '0');
      fpsOut.textContent = fps.toFixed(0);
    },
    refreshUnitLabels() {
      for (const button of unitGroup.querySelectorAll<HTMLButtonElement>('button')) {
        const typeId = button.dataset.unit as UnitTypeId | undefined;
        if (typeId) button.textContent = UNIT_CONFIGS[typeId].name;
      }
    },
    dispose() {
      factionGroup.removeEventListener('click', selectFactionFromButton);
      pauseButton.removeEventListener('click', togglePause);
      stepButton.removeEventListener('click', stepOnce);
      speedButton.removeEventListener('click', cycleSpeed);
      brawlButton.removeEventListener('click', options.onBrawl);
      randomPkButton.removeEventListener('click', options.onRandomPk);
      clearButton.removeEventListener('click', options.onClear);
      window.removeEventListener('keydown', onKeyDown);
      unitGroup.replaceChildren();
    },
  };
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`HUD 缺少元素：${selector}`);
  return element;
}
