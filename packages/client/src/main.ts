import { Faction, UNIT_TYPE_IDS, type UnitTypeId, fromFloat, spawnCommand } from '@pb/sim';
import { SimLoop } from './loop.js';
import { createConfigPanel } from './debug/configPanel.js';
import { createPanel } from './debug/panel.js';
import { enablePlacement } from './input/placement.js';
import { createMainMenu } from './ui/mainMenu.js';
import { createScreenController, type ScreenController } from './ui/screenController.js';
import { ARENA_H, ARENA_W } from './view/coords.js';
import { createScene } from './view/scene.js';
import { BattleView } from './view/viewSync.js';

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');

// 兵种参数在 @pb/sim 加载 units.json 时已生效，无需再 hydrate

let screens: ScreenController;
const mainMenu = createMainMenu({
  onStartSandbox: () => screens.show('sandbox'),
});

/** 待延后执行的 WebGL 拆解；快速再次进沙盒或卸载页面时需先冲刷，避免双上下文竞态。 */
let deferredSandboxCleanup: (() => void) | null = null;
let deferredSandboxCleanupFrame = 0;

/** 立即执行并清空延后的沙盒 GPU 清理。 */
function flushDeferredSandboxCleanup(): void {
  if (deferredSandboxCleanupFrame !== 0) {
    cancelAnimationFrame(deferredSandboxCleanupFrame);
    deferredSandboxCleanupFrame = 0;
  }
  const cleanup = deferredSandboxCleanup;
  deferredSandboxCleanup = null;
  cleanup?.();
}

/**
 * 把 WebGL dispose 挪到主界面绘制之后，避免返回大厅时卡在点击回调里。
 * 连等两帧：第一帧提交菜单显隐，第二帧确认已绘制后再拆 GPU。
 */
function scheduleDeferredSandboxCleanup(cleanup: () => void): void {
  flushDeferredSandboxCleanup();
  deferredSandboxCleanup = cleanup;
  deferredSandboxCleanupFrame = requestAnimationFrame(() => {
    deferredSandboxCleanupFrame = requestAnimationFrame(() => {
      deferredSandboxCleanupFrame = 0;
      const run = deferredSandboxCleanup;
      deferredSandboxCleanup = null;
      run?.();
    });
  });
}

/** 启动一轮可完整释放的沙盒会话，防止反复进出后累积监听器和渲染循环。 */
function enterSandbox(): () => void {
  // 上一轮延后 dispose 若未完成，先同步收尾，再创建新渲染器
  flushDeferredSandboxCleanup();

  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');

  const sceneContext = createScene(container);
  const loop = new SimLoop(20260806);
  const battleView = new BattleView(sceneContext.scene);

  const clearBattlefield = (): void => {
    loop.reset();
    battleView.invalidateUnitViews();
  };

  const panel = createPanel({
    loop,
    onClear: clearBattlefield,
    onBrawl: () => spawnBrawl(loop),
    onRandomPk: () => spawnRandomPk(loop, clearBattlefield),
  });

  const configPanel = createConfigPanel({
    onApplied: () => {
      clearBattlefield();
      panel.refreshUnitLabels();
    },
  });

  const disablePlacement = enablePlacement({
    domElement: sceneContext.renderer.domElement,
    camera: sceneContext.camera,
    groundPlane: sceneContext.groundPlane,
    onPlace: (simX, simY) => {
      loop.enqueue(spawnCommand(panel.faction, panel.unitType, fromFloat(simX), fromFloat(simY)));
    },
  });

  const returnToMenu = (): void => screens.show('menu');
  backButton.addEventListener('click', returnToMenu);

  let lastFrameAt = performance.now();
  let smoothedFps = 60;
  let animationFrameId = 0;

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    smoothedFps += (1000 / Math.max(deltaMs, 1) - smoothedFps) * 0.08;

    loop.advance(deltaMs);
    sceneContext.controls.update();
    battleView.render(loop.prev, loop.curr, loop.alpha, sceneContext.camera);
    sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
    panel.updateStats(smoothedFps);

    animationFrameId = requestAnimationFrame(frame);
  };

  animationFrameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(animationFrameId);
    backButton.removeEventListener('click', returnToMenu);
    disablePlacement();
    configPanel.dispose();
    panel.dispose();
    // 先藏沙盒 UI，让大厅能立刻上屏；GPU 拆解放到绘制后
    hud.classList.add('is-hidden');
    container.classList.add('is-hidden');
    scheduleDeferredSandboxCleanup(() => {
      battleView.reset();
      sceneContext.dispose();
    });
  };
}

screens = createScreenController({
  menu: () => {
    mainMenu.show();
    return () => mainMenu.hide();
  },
  sandbox: enterSandbox,
});
screens.show('menu');

/** 页面卸载时释放当前会话和大厅事件，避免热重载保留旧引用。 */
function disposeApp(): void {
  screens.dispose();
  flushDeferredSandboxCleanup();
  mainMenu.dispose();
}

window.addEventListener('pagehide', disposeApp, { once: true });

/** 一键摆一场混战，用来快速验证寻路、推挤和战斗结算 */
function spawnBrawl(target: SimLoop): void {
  const lineup: Array<[UnitTypeId, number]> = [
    ['melee_grunt', 5],
    ['melee_grunt', 7],
    ['melee_cavalry', 8.5],
    ['melee_grunt', 11],
    ['hero_king', 4],
    ['hero_queen', 13],
    ['ranged_archer', 6],
    ['ranged_archer', 9],
    ['ranged_archer', 12],
  ];
  for (const [typeId, x] of lineup) {
    const backRow = typeId === 'ranged_archer' || typeId === 'hero_queen';
    const midRow = typeId === 'melee_cavalry';
    const blueY = backRow ? 3 : midRow ? 5 : 6;
    const redY = ARENA_H - (backRow ? 3 : midRow ? 5 : 6);
    target.enqueue(spawnCommand(Faction.Blue, typeId, fromFloat(x), fromFloat(blueY)));
    target.enqueue(spawnCommand(Faction.Red, typeId, fromFloat(x), fromFloat(redY)));
  }
}

/** 从全部兵种里随机抽一个，仅用于沙盒对战测试 */
function pickRandomUnitType(): UnitTypeId {
  const index = Math.floor(Math.random() * UNIT_TYPE_IDS.length);
  return UNIT_TYPE_IDS[index]!;
}

/** 清空后双方各随机上场一个单位，方便快速测 1v1 */
function spawnRandomPk(target: SimLoop, clear: () => void): void {
  clear();
  const x = ARENA_W / 2;
  const blueType = pickRandomUnitType();
  const redType = pickRandomUnitType();
  target.enqueue(spawnCommand(Faction.Blue, blueType, fromFloat(x), fromFloat(6)));
  target.enqueue(spawnCommand(Faction.Red, redType, fromFloat(x), fromFloat(ARENA_H - 6)));
}

/** 启动阶段立即校验页面骨架，避免缺失元素在交互后才触发隐晦空引用。 */
function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
