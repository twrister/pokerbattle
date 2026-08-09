import {
  Faction,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  isBuildingConfig,
  type UnitTypeId,
} from '@pb/sim';
import type { SimLoop } from '../loop.js';

/** 可切换的倍速档位 */
const SPEED_STEPS = [1, 2, 4, 0.25, 0.5];
/** 状态栏刷新间隔，60fps 刷文本纯属浪费还看不清 */
const STATS_REFRESH_MS = 150;
/** 沙盒可出兵的非建筑兵种（建筑走独立建造面板） */
const MOBILE_UNIT_TYPE_IDS = UNIT_TYPE_IDS.filter((id) => !isBuildingConfig(UNIT_CONFIGS[id]));

export interface PanelOptions {
  loop: SimLoop;
  onClear: () => void;
  /** 是否启用沙盒的阵营、兵种选择和对应快捷键。 */
  enableSpawnControls?: boolean;
  /** 是否启用暂停/单步/倍速/清空等运行控制（正式服单机关闭）。 */
  enableRuntimeControls?: boolean;
  /** 沙盒专用的快速开团预设；单机模式不提供。 */
  onBrawl?: () => void;
  /** 清空后双方各随机一个兵种 1v1 */
  onRandomPk?: () => void;
  /** 建造模式切换：传入建筑 typeId 进入，null 退出 */
  onBuildingModeChange?: (typeId: UnitTypeId | null) => void;
  /** 单机正交镜头俯仰角；传入后绑定运行控制里的滑条 */
  soloCameraAngle?: {
    initial: number;
    onChange: (degrees: number) => void;
  };
  /** 单机自动发牌间隔；传入后允许在运行时立即调整。 */
  soloDrawInterval?: {
    initialSeconds: number;
    onChange: (seconds: number) => void;
  };
  /** 兵种搭配缩略图取景；传入后绑定运行控制滑条。 */
  formationThumbnailFrame?: {
    initialUnitDisplayScale: number;
    initialFrameMargin: number;
    onChange: (settings: { unitDisplayScale: number; frameMargin: number }) => void;
  };
}

export interface PanelHandle {
  /** 当前选中的放兵阵营 */
  readonly faction: Faction;
  /** 当前选中的兵种 */
  readonly unitType: UnitTypeId;
  /** 当前建造中的建筑类型；null 表示未在建造模式 */
  readonly buildingType: UnitTypeId | null;
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
  const runtimeControlsEnabled = options.enableRuntimeControls ?? true;

  let faction: Faction = Faction.Blue;
  let unitType: UnitTypeId = MOBILE_UNIT_TYPE_IDS[0]!;
  let buildingType: UnitTypeId | null = null;
  let speedIndex = 0;
  let lastStatsAt = 0;

  const factionGroup = required<HTMLDivElement>('#faction-group');
  const unitGroup = required<HTMLDivElement>('#unit-group');
  const buildingPanel = required<HTMLElement>('#panel-building');
  const buildingGroup = required<HTMLDivElement>('#building-group');
  const buildingCancelButton = required<HTMLButtonElement>('#btn-building-cancel');
  const pauseButton = required<HTMLButtonElement>('#btn-pause');
  const stepButton = required<HTMLButtonElement>('#btn-step');
  const speedButton = required<HTMLButtonElement>('#btn-speed');
  const brawlButton = required<HTMLButtonElement>('#btn-brawl');
  const randomPkButton = required<HTMLButtonElement>('#btn-random-pk');
  const clearButton = required<HTMLButtonElement>('#btn-clear');
  const cameraAngleInput = required<HTMLInputElement>('#solo-camera-angle');
  const cameraAngleValue = required<HTMLElement>('#solo-camera-angle-value');
  const drawIntervalInput = required<HTMLInputElement>('#solo-draw-interval');
  const thumbScaleInput = required<HTMLInputElement>('#formation-thumb-scale');
  const thumbScaleValue = required<HTMLElement>('#formation-thumb-scale-value');
  const thumbMarginInput = required<HTMLInputElement>('#formation-thumb-margin');
  const thumbMarginValue = required<HTMLElement>('#formation-thumb-margin-value');

  const tickOut = required<HTMLElement>('#stat-tick');
  const unitsOut = required<HTMLElement>('#stat-units');
  const projectilesOut = required<HTMLElement>('#stat-projectiles');
  const hashOut = required<HTMLElement>('#stat-hash');
  const fpsOut = required<HTMLElement>('#stat-fps');

  if (spawnControlsEnabled) {
    // 兵种按钮只列可移动单位；建筑走独立建造面板
    for (const typeId of MOBILE_UNIT_TYPE_IDS) {
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
    // 选兵种时退出建造，避免两种放置模式叠在一起
    setBuildingType(null);
    for (const button of unitGroup.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.unit === next));
    }
  }

  /** 进入/退出建造模式，并同步按钮态与外部放置监听 */
  function setBuildingType(next: UnitTypeId | null): void {
    if (next && !isBuildingConfig(UNIT_CONFIGS[next])) return;
    // 状态未变则不回调，避免初始化 selectUnit 时在 panel 赋值前挂监听
    if (next === buildingType) return;
    buildingType = next;
    buildingPanel.classList.toggle('is-building', next !== null);
    for (const button of buildingGroup.querySelectorAll<HTMLButtonElement>('button[data-building]')) {
      button.setAttribute('aria-pressed', String(button.dataset.building === next));
    }
    buildingCancelButton.setAttribute('aria-pressed', String(next === null));
    options.onBuildingModeChange?.(next);
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
        const next = MOBILE_UNIT_TYPE_IDS[index];
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
        if (!runtimeControlsEnabled) break;
        event.preventDefault();
        togglePause();
        break;
      case 'KeyN':
        if (!runtimeControlsEnabled) break;
        loop.stepOnce();
        break;
      case 'KeyR':
        if (!runtimeControlsEnabled) break;
        options.onClear();
        break;
      case 'KeyB':
        if (!runtimeControlsEnabled) break;
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

  /** 校验数字框后再通知手牌，避免编辑中的空值把计时器改成无效状态。 */
  const onDrawIntervalInput = (): void => {
    const seconds = Number(drawIntervalInput.value);
    if (!Number.isFinite(seconds) || seconds < 0.25) return;
    options.soloDrawInterval?.onChange(seconds);
  };

  /** 同步阵型缩略图取景滑条读数，并立刻重渲按钮图。 */
  const onFormationThumbFrameInput = (): void => {
    const unitDisplayScale = Number(thumbScaleInput.value);
    const frameMargin = Number(thumbMarginInput.value);
    thumbScaleValue.textContent = unitDisplayScale.toFixed(2);
    thumbMarginValue.textContent = frameMargin.toFixed(2);
    options.formationThumbnailFrame?.onChange({ unitDisplayScale, frameMargin });
  };

  const onBuildingGroupClick = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-building]');
    if (!button?.dataset.building) return;
    const typeId = button.dataset.building as UnitTypeId;
    setBuildingType(buildingType === typeId ? null : typeId);
  };
  const onBuildingCancel = (): void => setBuildingType(null);

  if (spawnControlsEnabled) {
    factionGroup.addEventListener('click', selectFactionFromButton);
    buildingGroup.addEventListener('click', onBuildingGroupClick);
    buildingCancelButton.addEventListener('click', onBuildingCancel);
  }
  if (runtimeControlsEnabled) {
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
    if (options.soloDrawInterval) {
      drawIntervalInput.value = String(options.soloDrawInterval.initialSeconds);
      drawIntervalInput.addEventListener('input', onDrawIntervalInput);
    }
    if (options.formationThumbnailFrame) {
      const { initialUnitDisplayScale, initialFrameMargin } = options.formationThumbnailFrame;
      thumbScaleInput.value = String(initialUnitDisplayScale);
      thumbMarginInput.value = String(initialFrameMargin);
      thumbScaleValue.textContent = initialUnitDisplayScale.toFixed(2);
      thumbMarginValue.textContent = initialFrameMargin.toFixed(2);
      thumbScaleInput.addEventListener('input', onFormationThumbFrameInput);
      thumbMarginInput.addEventListener('input', onFormationThumbFrameInput);
    }
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
    get buildingType() {
      return buildingType;
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
      if (spawnControlsEnabled) {
        factionGroup.removeEventListener('click', selectFactionFromButton);
        buildingGroup.removeEventListener('click', onBuildingGroupClick);
        buildingCancelButton.removeEventListener('click', onBuildingCancel);
        // 只复位 UI，不再回调挂监听——外层已自行 unbind
        buildingType = null;
        buildingPanel.classList.remove('is-building');
        for (const button of buildingGroup.querySelectorAll<HTMLButtonElement>('button[data-building]')) {
          button.setAttribute('aria-pressed', 'false');
        }
      }
      if (runtimeControlsEnabled) {
        pauseButton.removeEventListener('click', togglePause);
        stepButton.removeEventListener('click', stepOnce);
        speedButton.removeEventListener('click', cycleSpeed);
        if (options.onBrawl) brawlButton.removeEventListener('click', options.onBrawl);
        if (options.onRandomPk) randomPkButton.removeEventListener('click', options.onRandomPk);
        clearButton.removeEventListener('click', options.onClear);
        if (options.soloCameraAngle) {
          cameraAngleInput.removeEventListener('input', onCameraAngleInput);
        }
        if (options.soloDrawInterval) {
          drawIntervalInput.removeEventListener('input', onDrawIntervalInput);
        }
        if (options.formationThumbnailFrame) {
          thumbScaleInput.removeEventListener('input', onFormationThumbFrameInput);
          thumbMarginInput.removeEventListener('input', onFormationThumbFrameInput);
        }
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
