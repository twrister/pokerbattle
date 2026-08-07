import { Faction, UNIT_TYPE_IDS, type UnitTypeId, fromFloat, spawnCommand } from '@pb/sim';
import { SimLoop } from './loop.js';
import { createConfigPanel, type ConfigPanelHandle } from './debug/configPanel.js';
import { createPanel } from './debug/panel.js';
import { enablePlacement } from './input/placement.js';
import { createMainMenu } from './ui/mainMenu.js';
import { createScreenController, type ScreenController } from './ui/screenController.js';
import { ARENA_H, ARENA_W } from './view/coords.js';
import { createScene, type SceneContext } from './view/scene.js';
import { BattleView } from './view/viewSync.js';

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');

// 兵种参数在 @pb/sim 加载 units.json 时已生效，无需再 hydrate

let screens: ScreenController;
const mainMenu = createMainMenu({
  onStartSandbox: () => screens.show('sandbox'),
  onStartSolo: () => screens.show('solo'),
});

/**
 * 战斗场景与配置面板跨「大厅 ↔ 单机/沙盒」复用。
 * 退出大厅只停循环、藏 UI；WebGL dispose 与整表单拆解推迟到页面卸载，避免返回卡顿。
 */
let sharedScene: SceneContext | null = null;
let sharedBattleView: BattleView | null = null;
let sharedConfigPanel: ConfigPanelHandle | null = null;

/** 懒创建或切换镜头模式，始终复用同一个 WebGLRenderer。 */
function ensureBattleScene(mode: BattleMode): SceneContext {
  if (!sharedScene) {
    sharedScene = createScene(container, { mode });
    sharedBattleView = new BattleView(sharedScene.scene);
    return sharedScene;
  }
  sharedScene.setMode(mode);
  return sharedScene;
}

/** 配置表单 DOM 很重，只建一次，会话切换只换 onApplied。 */
function ensureConfigPanel(): ConfigPanelHandle {
  if (!sharedConfigPanel) {
    sharedConfigPanel = createConfigPanel({ onApplied: () => {} });
  }
  return sharedConfigPanel;
}

type BattleMode = 'sandbox' | 'solo';

/** 启动一轮战斗会话；离开时释放本局监听与循环，场景与配置面板保留。 */
function enterBattleSession(mode: BattleMode): () => void {
  const isSolo = mode === 'solo';

  container.classList.toggle('is-solo', isSolo);
  hud.classList.toggle('is-solo', isSolo);
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');

  const sceneContext = ensureBattleScene(mode);
  // 容器刚从 display:none 恢复，按当前布局重设画布尺寸
  sceneContext.resize();

  const battleView = sharedBattleView!;
  battleView.reset();

  const loop = new SimLoop(20260806);

  const clearBattlefield = (): void => {
    loop.reset();
    battleView.invalidateUnitViews();
  };

  const panel = createPanel({
    loop,
    onClear: clearBattlefield,
    enableSpawnControls: !isSolo,
    onRandomPk: () => spawnRandomPk(loop, clearBattlefield),
    ...(isSolo
      ? {
          soloCameraAngle: {
            initial: sceneContext.getSoloCameraAngle(),
            onChange: (degrees) => sceneContext.setSoloCameraAngle(degrees),
          },
        }
      : { onBrawl: () => spawnBrawl(loop) }),
  });

  const configPanel = ensureConfigPanel();
  configPanel.setOnApplied(() => {
    clearBattlefield();
    panel.refreshUnitLabels();
  });

  const disablePlacement = isSolo
    ? () => {}
    : enablePlacement({
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
    sceneContext.controls?.update();
    battleView.render(loop.prev, loop.curr, loop.alpha, sceneContext.camera);
    sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
    panel.updateStats(smoothedFps);

    animationFrameId = requestAnimationFrame(frame);
  };

  animationFrameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(animationFrameId);
    // 先藏战斗层，让随后的大厅 show 立刻可见；其余清理都很轻，可同步做完
    hud.classList.add('is-hidden');
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo');
    container.classList.remove('is-solo');
    backButton.removeEventListener('click', returnToMenu);
    disablePlacement();
    panel.dispose();
    // 断开已离开会话的清场回调，避免隐藏期间误触保存仍引用旧 loop
    configPanel.setOnApplied(() => {});
    battleView.reset();
  };
}

/** 启动调试用途的自由镜头沙盒。 */
function enterSandbox(): () => void {
  return enterBattleSession('sandbox');
}

/** 启动正交斜视角的单机战斗场景。 */
function enterSolo(): () => void {
  return enterBattleSession('solo');
}

screens = createScreenController({
  menu: () => {
    mainMenu.show();
    return () => mainMenu.hide();
  },
  sandbox: enterSandbox,
  solo: enterSolo,
});
screens.show('menu');

/** 页面卸载时释放战斗场景、配置面板和大厅事件。 */
function disposeApp(): void {
  screens.dispose();
  sharedConfigPanel?.dispose();
  sharedConfigPanel = null;
  sharedBattleView?.reset();
  sharedBattleView = null;
  sharedScene?.dispose();
  sharedScene = null;
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
