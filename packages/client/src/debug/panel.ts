import { Faction, UNIT_CONFIGS, UNIT_TYPE_IDS, type UnitTypeId } from '@pb/sim';
import type { SimLoop } from '../loop.js';

/** 可切换的倍速档位 */
const SPEED_STEPS = [1, 2, 4, 0.25, 0.5];
/** 状态栏刷新间隔，60fps 刷文本纯属浪费还看不清 */
const STATS_REFRESH_MS = 150;

export interface PanelOptions {
  loop: SimLoop;
  onClear: () => void;
  /** 是否启用沙盒的阵营、兵种选择和对应快捷键。 */
  enableSpawnControls?: boolean;
  /** 沙盒专用的快速开团预设；单机模式不提供。 */
  onBrawl?: () => void;
  /** 清空后双方各随机一个兵种 1v1 */
  onRandomPk?: () => void;
  /** 单机正交镜头俯仰角；传入后绑定运行控制里的滑条 */
  soloCameraAngle?: {
    initial: number;
    onChange: (degrees: number) => void;
  };
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
  const spawnControlsEnabled = options.enableSpawnControls ?? true;

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
  const cameraAngleInput = required<HTMLInputElement>('#solo-camera-angle');
  const cameraAngleValue = required<HTMLElement>('#solo-camera-angle-value');

  const tickOut = required<HTMLElement>('#stat-tick');
  const unitsOut = required<HTMLElement>('#stat-units');
  const projectilesOut = required<HTMLElement>('#stat-projectiles');
  const hashOut = required<HTMLElement>('#stat-hash');
  const fpsOut = required<HTMLElement>('#stat-fps');

  if (spawnControlsEnabled) {
    // 兵种按钮直接由配置表生成，加新兵种不需要动 HTML
    for (const typeId of UNIT_TYPE_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.unit = typeId;
      button.textContent = UNIT_CONFIGS[typeId].name;
      button.addEventListener('click', () => selectUnit(typeId));
      unitGroup.appendChild(button);
    }
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
        if (!spawnControlsEnabled) break;
        const index = Number(event.code.slice(5)) - 1;
        const next = UNIT_TYPE_IDS[index];
        if (next) selectUnit(next);
        break;
      }
      case 'KeyQ':
        if (spawnControlsEnabled) selectFaction(Faction.Blue);
        break;
      case 'KeyE':
        if (spawnControlsEnabled) selectFaction(Faction.Red);
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
        options.onBrawl?.();
        break;
    }
  };

  /** 同步滑条旁的角度读数，并回写到场景镜头。 */
  const onCameraAngleInput = (): void => {
    const degrees = Number(cameraAngleInput.value);
    cameraAngleValue.textContent = `${degrees}°`;
    options.soloCameraAngle?.onChange(degrees);
  };

  if (spawnControlsEnabled) factionGroup.addEventListener('click', selectFactionFromButton);
  pauseButton.addEventListener('click', togglePause);
  stepButton.addEventListener('click', stepOnce);
  speedButton.addEventListener('click', cycleSpeed);
  if (options.onBrawl) brawlButton.addEventListener('click', options.onBrawl);
  if (options.onRandomPk) randomPkButton.addEventListener('click', options.onRandomPk);
  clearButton.addEventListener('click', options.onClear);
  if (options.soloCameraAngle) {
    cameraAngleInput.value = String(Math.round(options.soloCameraAngle.initial));
    cameraAngleValue.textContent = `${cameraAngleInput.value}°`;
    cameraAngleInput.addEventListener('input', onCameraAngleInput);
  }
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
      if (spawnControlsEnabled) factionGroup.removeEventListener('click', selectFactionFromButton);
      pauseButton.removeEventListener('click', togglePause);
      stepButton.removeEventListener('click', stepOnce);
      speedButton.removeEventListener('click', cycleSpeed);
      if (options.onBrawl) brawlButton.removeEventListener('click', options.onBrawl);
      if (options.onRandomPk) randomPkButton.removeEventListener('click', options.onRandomPk);
      clearButton.removeEventListener('click', options.onClear);
      if (options.soloCameraAngle) {
        cameraAngleInput.removeEventListener('input', onCameraAngleInput);
      }
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
