import {
  Faction,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type CardFormation,
  type UnitTypeId,
  fromFloat,
  getFormationBuildingTypeId,
  isBuildingConfig,
  isBuildingOnlyFormation,
  placeBuildingCommand,
  resolveFormationSpawns,
  snapBuildingCenter,
  spawnCommand,
} from '@pb/sim';
import { SimLoop } from './loop.js';
import { createConfigPanel, type ConfigPanelHandle } from './debug/configPanel.js';
import { createPanel } from './debug/panel.js';
import { IS_DEV_SERVER } from './env.js';
import {
  enableBuildingPlacement,
  type BuildingPlacementHandle,
} from './input/buildingPlacement.js';
import {
  blueHalfSafeAnchor,
  enablePlacement,
  isBuildingInsideBlueHalf,
  isFormationInsideBlueHalf,
  screenToSim,
} from './input/placement.js';
import { createHandPanel, type FormationSpawnRequest } from './ui/handPanel.js';
import { createDeckConfigPage } from './ui/deckConfigPage.js';
import { createMainMenu } from './ui/mainMenu.js';
import { createScreenController, type ScreenController } from './ui/screenController.js';
import { ARENA_H, ARENA_W } from './view/coords.js';
import {
  disposeFormationThumbnailRenderer,
  getFormationThumbnailFrameSettings,
  setFormationThumbnailFrameSettings,
} from './view/formationThumbnail.js';
import { createScene, type SceneContext } from './view/scene.js';
import { BattleView } from './view/viewSync.js';

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');

// 供 CSS 区分开发服 / 正式服可见功能
document.documentElement.classList.toggle('is-dev', IS_DEV_SERVER);

// 兵种参数在 @pb/sim 加载 units.json 时已生效，无需再 hydrate

let screens: ScreenController;
const mainMenu = createMainMenu({
  onStartSandbox: () => screens.show('sandbox'),
  onStartSolo: () => screens.show('solo'),
  onOpenDeckConfig: () => screens.show('deck-config'),
});
const deckConfigPage = createDeckConfigPage({ onBack: () => screens.show('menu') });

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
  // 单机开局即摆双方主堡，清场后也要重刷
  if (isSolo) seedSoloStartingCastles(loop);

  /** 放兵与建造互斥：同一时间只挂一种地面点击监听 */
  let disableUnitPlacement = (): void => {};
  let disableBuildingPlacementFn = (): void => {};
  /** 单机拖拽建筑时的绿格预览句柄 */
  let soloBuildingPreview: BuildingPlacementHandle | null = null;

  const stopSoloBuildingPreview = (): void => {
    if (!soloBuildingPreview) return;
    soloBuildingPreview.dispose();
    soloBuildingPreview = null;
  };

  /** 按下建筑阵型：立刻铺绿色可放置格，仅预览不监听画布点击。 */
  const onBuildingDragStart = (formation: CardFormation): void => {
    const typeId = getFormationBuildingTypeId(formation);
    if (!typeId) return;
    stopSoloBuildingPreview();
    soloBuildingPreview = enableBuildingPlacement({
      domElement: sceneContext.renderer.domElement,
      camera: sceneContext.camera,
      groundPlane: sceneContext.groundPlane,
      scene: sceneContext.scene,
      world: loop.world,
      getFaction: () => Faction.Blue,
      getTypeId: () => typeId,
      blueHalfOnly: true,
      listenInput: false,
      onPlace: () => {},
    });
  };

  /**
   * 校验蓝方落点是否可出兵/建造（不入队）。
   * 非建筑：point 为 null 时用半场安全锚点（按钮内自动放置）。
   * 建筑：必须带屏幕落点，不支持自动放置。
   */
  const canSpawnAt = (
    formation: CardFormation,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (isBuildingOnlyFormation(formation)) {
      // 建筑只能拖到战场指定格，拒绝 null 自动锚点
      if (!point) return false;
      const typeId = getFormationBuildingTypeId(formation)!;
      const footprint = UNIT_CONFIGS[typeId].footprint;
      const anchor = screenToSim(
        sceneContext.renderer.domElement,
        sceneContext.camera,
        sceneContext.groundPlane,
        point.clientX,
        point.clientY,
      );
      if (!anchor) return false;
      const cx = snapBuildingCenter(anchor.x, footprint);
      const cy = snapBuildingCenter(anchor.y, footprint);
      if (!isBuildingInsideBlueHalf(cx, cy, footprint)) return false;
      return loop.world.canPlaceBuilding(typeId, fromFloat(cx), fromFloat(cy));
    }

    const anchor = point
      ? screenToSim(
          sceneContext.renderer.domElement,
          sceneContext.camera,
          sceneContext.groundPlane,
          point.clientX,
          point.clientY,
        )
      : blueHalfSafeAnchor(formation);
    if (!anchor) return false;
    const points = resolveFormationSpawns(formation, Faction.Blue, anchor.x, anchor.y);
    return isFormationInsideBlueHalf(points);
  };

  /**
   * 蓝方出兵：拖拽给屏幕落点；非建筑点击按钮则退回半场中央安全点。
   * 整阵越界直接拒绝（不逐单位 clamp，否则贴边阵型会被压扁重叠），由手牌面板提示重放。
   * 单建筑：必须拖到战场松手落成 PlaceBuilding（吸附 + 半场 + 重叠）；绿格由 onBuildingDrag* 负责。
   */
  const requestSpawn = (request: FormationSpawnRequest): boolean => {
    if (!canSpawnAt(request.formation, request.point)) return false;

    if (isBuildingOnlyFormation(request.formation)) {
      const typeId = getFormationBuildingTypeId(request.formation)!;
      const footprint = UNIT_CONFIGS[typeId].footprint;
      // canSpawnAt 已拒绝 null；此处 point 必有值
      const point = request.point!;
      const anchor = screenToSim(
        sceneContext.renderer.domElement,
        sceneContext.camera,
        sceneContext.groundPlane,
        point.clientX,
        point.clientY,
      );
      if (!anchor) return false;
      const cx = snapBuildingCenter(anchor.x, footprint);
      const cy = snapBuildingCenter(anchor.y, footprint);
      loop.enqueue(placeBuildingCommand(Faction.Blue, typeId, fromFloat(cx), fromFloat(cy)));
      return true;
    }

    const anchor = request.point
      ? screenToSim(
          sceneContext.renderer.domElement,
          sceneContext.camera,
          sceneContext.groundPlane,
          request.point.clientX,
          request.point.clientY,
        )
      : blueHalfSafeAnchor(request.formation);
    if (!anchor) return false;

    const points = resolveFormationSpawns(request.formation, Faction.Blue, anchor.x, anchor.y);
    for (const point of points) {
      loop.enqueue(
        spawnCommand(Faction.Blue, point.typeId, fromFloat(point.x), fromFloat(point.y)),
      );
    }
    return true;
  };

  const handPanel = isSolo
    ? createHandPanel({
        drawIntervalSeconds: 3,
        onRequestSpawn: requestSpawn,
        canDropAt: (point, formation) => canSpawnAt(formation, point),
        onBuildingDragStart,
        onBuildingDragMove: (clientX, clientY) => {
          soloBuildingPreview?.syncPointer(clientX, clientY);
        },
        onBuildingDragEnd: stopSoloBuildingPreview,
      })
    : null;

  const clearBattlefield = (): void => {
    loop.reset();
    if (isSolo) seedSoloStartingCastles(loop);
    battleView.invalidateUnitViews();
  };

  const thumbFrame = getFormationThumbnailFrameSettings();
  // 正式服单机不开放运行控制；沙盒调试控件两种服都保留
  const runtimeControlsEnabled = IS_DEV_SERVER || !isSolo;

  const bindUnitPlacement = (): void => {
    disableUnitPlacement();
    disableBuildingPlacementFn();
    disableUnitPlacement = () => {};
    disableBuildingPlacementFn = () => {};
    if (isSolo) return;
    disableUnitPlacement = enablePlacement({
      domElement: sceneContext.renderer.domElement,
      camera: sceneContext.camera,
      groundPlane: sceneContext.groundPlane,
      onPlace: (simX, simY) => {
        loop.enqueue(spawnCommand(panel.faction, panel.unitType, fromFloat(simX), fromFloat(simY)));
      },
    });
  };

  const bindBuildingPlacement = (typeId: UnitTypeId): void => {
    disableUnitPlacement();
    disableBuildingPlacementFn();
    disableUnitPlacement = () => {};
    const handle = enableBuildingPlacement({
      domElement: sceneContext.renderer.domElement,
      camera: sceneContext.camera,
      groundPlane: sceneContext.groundPlane,
      scene: sceneContext.scene,
      world: loop.world,
      getFaction: () => panel.faction,
      getTypeId: () => typeId,
      onPlace: (command) => loop.enqueue(command),
    });
    disableBuildingPlacementFn = () => handle.dispose();
  };

  const panel = createPanel({
    loop,
    onClear: clearBattlefield,
    enableSpawnControls: !isSolo,
    enableRuntimeControls: runtimeControlsEnabled,
    onRandomPk: runtimeControlsEnabled
      ? () => spawnRandomPk(loop, clearBattlefield)
      : undefined,
    onBuildingModeChange: (typeId) => {
      if (typeId) bindBuildingPlacement(typeId);
      else bindUnitPlacement();
    },
    ...(isSolo
      ? IS_DEV_SERVER
        ? {
            soloCameraAngle: {
              initial: sceneContext.getSoloCameraAngle(),
              onChange: (degrees) => sceneContext.setSoloCameraAngle(degrees),
            },
            soloDrawInterval: {
              initialSeconds: 3,
              onChange: (seconds) => handPanel?.setDrawInterval(seconds),
            },
            formationThumbnailFrame: {
              initialUnitDisplayScale: thumbFrame.unitDisplayScale,
              initialFrameMargin: thumbFrame.frameMargin,
              onChange: (settings) => {
                setFormationThumbnailFrameSettings(settings);
                handPanel?.refreshFormations();
              },
            },
          }
        : {}
      : { onBrawl: () => spawnBrawl(loop) }),
  });

  // 单位参数面板仅开发服挂载
  const configPanel = IS_DEV_SERVER ? ensureConfigPanel() : null;
  configPanel?.setOnApplied(() => {
    clearBattlefield();
    panel.refreshUnitLabels();
  });

  // createPanel 初始化会回调 onBuildingModeChange(null)；沙盒下由此挂上放兵监听
  if (!isSolo && !panel.buildingType) bindUnitPlacement();

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
    handPanel?.update(deltaMs);
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
    disableUnitPlacement();
    disableBuildingPlacementFn();
    stopSoloBuildingPreview();
    handPanel?.dispose();
    panel.dispose();
    // 断开已离开会话的清场回调，避免隐藏期间误触保存仍引用旧 loop
    configPanel?.setOnApplied(() => {});
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
  'deck-config': () => {
    deckConfigPage.show();
    return () => deckConfigPage.hide();
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
  disposeFormationThumbnailRenderer();
  mainMenu.dispose();
  deckConfigPage.dispose();
}

window.addEventListener('pagehide', disposeApp, { once: true });

/**
 * 单机开局：双方半场底端各落一座主堡（王室战争式国王塔位置）。
 * 4×4 足迹贴齐各自底边：蓝方占 y∈[0,4)，红方占 y∈[28,32)。
 */
function seedSoloStartingCastles(target: SimLoop): void {
  const footprint = UNIT_CONFIGS.building_base.footprint;
  const centerX = ARENA_W / 2;
  const edgeInset = footprint / 2;
  target.enqueue(
    placeBuildingCommand(Faction.Blue, 'building_base', fromFloat(centerX), fromFloat(edgeInset)),
  );
  target.enqueue(
    placeBuildingCommand(
      Faction.Red,
      'building_base',
      fromFloat(centerX),
      fromFloat(ARENA_H - edgeInset),
    ),
  );
  // 立刻结算指令，首帧就能看到城堡，而不是空场闪一下
  target.stepOnce();
}

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

/** 从可移动兵种里随机抽一个，仅用于沙盒对战测试（排除建筑） */
function pickRandomUnitType(): UnitTypeId {
  const mobile = UNIT_TYPE_IDS.filter((id) => !isBuildingConfig(UNIT_CONFIGS[id]));
  const index = Math.floor(Math.random() * mobile.length);
  return mobile[index]!;
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
