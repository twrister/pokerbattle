import {
  DRAW_INTERVAL_TICKS,
  Faction,
  TICK_RATE,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type CardFormation,
  type UnitTypeId,
  fromFloat,
  getFormationBuildingTypeId,
  halfCourtSafeAnchor,
  isBuildingConfig,
  isBuildingInsideHalfCourt,
  isBuildingOnlyFormation,
  isFormationInsideHalfCourt,
  playFormationCommand,
  resolveFormationSpawns,
  snapBuildingCenter,
  spawnCommand,
  takeSnapshot,
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
  enablePlacement,
  isBuildingInsideBlueHalf,
  isFormationInsideBlueHalf,
  screenToSim,
} from './input/placement.js';
import { connectVersusSession } from './net/session.js';
import { createHandPanel, type FormationSpawnRequest } from './ui/handPanel.js';
import { createCodexPage } from './ui/codexPage.js';
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
const lobbyStatus = document.querySelector<HTMLElement>('#lobby-status');

// 供 CSS 区分开发服 / 正式服可见功能
document.documentElement.classList.toggle('is-dev', IS_DEV_SERVER);

let screens: ScreenController;
const mainMenu = createMainMenu({
  onStartSandbox: () => screens.show('sandbox'),
  onStartSolo: () => screens.show('solo'),
  onStartVersus: () => screens.show('versus'),
  onOpenDeckConfig: () => screens.show('deck-config'),
  onOpenCodex: () => screens.show('codex'),
});
const deckConfigPage = createDeckConfigPage({ onBack: () => screens.show('menu') });
const codexPage = createCodexPage({ onBack: () => screens.show('menu') });

/**
 * 战斗场景与配置面板跨「大厅 ↔ 单机/沙盒/联机」复用。
 * 退出大厅只停循环、藏 UI；WebGL dispose 与整表单拆解推迟到页面卸载，避免返回卡顿。
 */
let sharedScene: SceneContext | null = null;
let sharedBattleView: BattleView | null = null;
let sharedConfigPanel: ConfigPanelHandle | null = null;

/** 懒创建或切换镜头模式，始终复用同一个 WebGLRenderer。 */
function ensureBattleScene(mode: BattleMode, viewFaction: Faction = Faction.Blue): SceneContext {
  if (!sharedScene) {
    sharedScene = createScene(container, { mode, viewFaction });
    sharedBattleView = new BattleView(sharedScene.scene);
    return sharedScene;
  }
  sharedScene.setMode(mode, viewFaction);
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

  const sceneContext = ensureBattleScene(mode, Faction.Blue);
  sceneContext.resize();

  const battleView = sharedBattleView!;
  battleView.reset();

  // 单机走 MatchState，与联机共用出牌/抽牌规则，避免双路径漂移
  const loop = new SimLoop(20260806, { withMatch: isSolo });
  if (isSolo) {
    loop.match!.seedStartingCastles();
    // 立刻拍一帧快照，首帧就能看到城堡
    loop.curr = takeSnapshot(loop.world);
    loop.prev = loop.curr;
  }

  let disableUnitPlacement = (): void => {};
  let disableBuildingPlacementFn = (): void => {};
  let soloBuildingPreview: BuildingPlacementHandle | null = null;

  const stopSoloBuildingPreview = (): void => {
    if (!soloBuildingPreview) return;
    soloBuildingPreview.dispose();
    soloBuildingPreview = null;
  };

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

  const canSpawnAt = (
    formation: CardFormation,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (isBuildingOnlyFormation(formation)) {
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
      : halfCourtSafeAnchor(formation, Faction.Blue);
    if (!anchor) return false;
    const points = resolveFormationSpawns(formation, Faction.Blue, anchor.x, anchor.y);
    return isFormationInsideBlueHalf(points);
  };

  /** 单机出兵：上报 PlayFormation，由 MatchState 扣牌并展开。 */
  const requestSpawn = (request: FormationSpawnRequest): boolean => {
    if (!canSpawnAt(request.formation, request.point)) return false;
    const match = loop.match;
    if (!match) return false;

    let anchorX: number;
    let anchorY: number;
    if (isBuildingOnlyFormation(request.formation)) {
      const typeId = getFormationBuildingTypeId(request.formation)!;
      const footprint = UNIT_CONFIGS[typeId].footprint;
      const point = request.point!;
      const anchor = screenToSim(
        sceneContext.renderer.domElement,
        sceneContext.camera,
        sceneContext.groundPlane,
        point.clientX,
        point.clientY,
      );
      if (!anchor) return false;
      anchorX = snapBuildingCenter(anchor.x, footprint);
      anchorY = snapBuildingCenter(anchor.y, footprint);
    } else {
      const anchor = request.point
        ? screenToSim(
            sceneContext.renderer.domElement,
            sceneContext.camera,
            sceneContext.groundPlane,
            request.point.clientX,
            request.point.clientY,
          )
        : halfCourtSafeAnchor(request.formation, Faction.Blue);
      if (!anchor) return false;
      anchorX = anchor.x;
      anchorY = anchor.y;
    }

    const cmd = playFormationCommand(
      Faction.Blue,
      request.formation.id,
      request.cards.map((card) => card.id),
      fromFloat(anchorX),
      fromFloat(anchorY),
    );
    if (!match.validate(cmd)) return false;
    loop.enqueue(cmd);
    return true;
  };

  const handPanel = isSolo
    ? createHandPanel({
        deck: loop.match!.decks[Faction.Blue],
        externalDraw: true,
        externalCardConsume: true,
        getDrawRemainingMs: () => ticksUntilDrawMs(loop.world.tick),
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
    battleView.invalidateUnitViews();
    handPanel?.syncFromDeck();
  };

  const thumbFrame = getFormationThumbnailFrameSettings();
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
            soloViewBottomExtra: {
              initial: sceneContext.getSoloViewBottomExtra(),
              onChange: (value) => sceneContext.setSoloViewBottomExtra(value),
            },
            soloDrawInterval: {
              initialSeconds: 3,
              onChange: () => {
                /* 抽牌间隔已由 DRAW_INTERVAL_TICKS 固定；保留控件以免调试面板缺项 */
              },
            },
            formationThumbnailFrame: {
              initialUnitDisplayScale: thumbFrame.unitDisplayScale,
              onChange: (settings) => {
                setFormationThumbnailFrameSettings(settings);
                handPanel?.refreshFormations();
              },
            },
          }
        : {}
      : { onBrawl: () => spawnBrawl(loop) }),
  });

  const configPanel = IS_DEV_SERVER ? ensureConfigPanel() : null;
  configPanel?.setOnApplied(() => {
    clearBattlefield();
    panel.refreshUnitLabels();
  });

  if (!isSolo && !panel.buildingType) bindUnitPlacement();

  const returnToMenu = (): void => screens.show('menu');
  backButton.addEventListener('click', returnToMenu);

  let lastFrameAt = performance.now();
  let smoothedFps = 60;
  let animationFrameId = 0;
  let lastHandSyncTick = loop.world.tick;

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    smoothedFps += (1000 / Math.max(deltaMs, 1) - smoothedFps) * 0.08;

    loop.advance(deltaMs);
    if (handPanel && loop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = loop.world.tick;
      handPanel.syncFromDeck();
    }
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
    configPanel?.setOnApplied(() => {});
    battleView.reset();
  };
}

/** 联机对战：等人齐后用 NetSimLoop 帧驱动。 */
function enterVersus(): () => void {
  let disposed = false;
  let leave: (() => void) | null = null;
  let cancelled = false;

  container.classList.add('is-solo', 'is-versus');
  hud.classList.add('is-solo', 'is-versus');
  // 匹配期仍留在大厅层提示状态；对局开始后再由 runVersusSession 揭开战场
  mainMenu.show();
  setLobbyStatus('正在匹配联机对手…');

  void connectVersusSession({
    onStatus: setLobbyStatus,
    onDesync: (tick, serverHash) => {
      console.error(`[desync] tick=${tick} serverHash=${serverHash}`);
      setLobbyStatus(`不同步：tick ${tick}`);
    },
    onPeerLeft: () => {
      setLobbyStatus('对手已离开');
      screens.show('menu');
    },
  })
    .then((session) => {
      if (cancelled) {
        session.close();
        return;
      }
      leave = runVersusSession(session.loop, session.faction, session.close);
    })
    .catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setLobbyStatus(message);
      screens.show('menu');
    });

  return () => {
    cancelled = true;
    disposed = true;
    leave?.();
    leave = null;
    // 匹配阶段返回大厅时也清掉联机标记，避免残留样式
    hud.classList.remove('is-versus');
    container.classList.remove('is-versus');
    void disposed;
  };
}

/** 联机会话主循环：本地输入只 send，手牌读 MatchState。 */
function runVersusSession(
  netLoop: import('./net/netLoop.js').NetSimLoop,
  faction: Faction,
  closeSocket: () => void,
): () => void {
  mainMenu.hide();
  container.classList.add('is-solo', 'is-versus');
  hud.classList.add('is-solo', 'is-versus');
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');

  const sceneContext = ensureBattleScene('solo', faction);
  sceneContext.resize();
  const battleView = sharedBattleView!;
  battleView.reset();

  let soloBuildingPreview: BuildingPlacementHandle | null = null;
  const stopBuildingPreview = (): void => {
    if (!soloBuildingPreview) return;
    soloBuildingPreview.dispose();
    soloBuildingPreview = null;
  };

  const canSpawnAt = (
    formation: CardFormation,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (isBuildingOnlyFormation(formation)) {
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
      if (!isBuildingInsideHalfCourt(cx, cy, footprint, faction)) return false;
      return netLoop.world.canPlaceBuilding(typeId, fromFloat(cx), fromFloat(cy));
    }
    const anchor = point
      ? screenToSim(
          sceneContext.renderer.domElement,
          sceneContext.camera,
          sceneContext.groundPlane,
          point.clientX,
          point.clientY,
        )
      : halfCourtSafeAnchor(formation, faction);
    if (!anchor) return false;
    const points = resolveFormationSpawns(formation, faction, anchor.x, anchor.y);
    return isFormationInsideHalfCourt(points, faction);
  };

  const requestSpawn = (request: FormationSpawnRequest): boolean => {
    if (!canSpawnAt(request.formation, request.point)) return false;

    let anchorX: number;
    let anchorY: number;
    if (isBuildingOnlyFormation(request.formation)) {
      const typeId = getFormationBuildingTypeId(request.formation)!;
      const footprint = UNIT_CONFIGS[typeId].footprint;
      const point = request.point!;
      const anchor = screenToSim(
        sceneContext.renderer.domElement,
        sceneContext.camera,
        sceneContext.groundPlane,
        point.clientX,
        point.clientY,
      );
      if (!anchor) return false;
      anchorX = snapBuildingCenter(anchor.x, footprint);
      anchorY = snapBuildingCenter(anchor.y, footprint);
    } else {
      const anchor = request.point
        ? screenToSim(
            sceneContext.renderer.domElement,
            sceneContext.camera,
            sceneContext.groundPlane,
            request.point.clientX,
            request.point.clientY,
          )
        : halfCourtSafeAnchor(request.formation, faction);
      if (!anchor) return false;
      anchorX = anchor.x;
      anchorY = anchor.y;
    }

    const cmd = playFormationCommand(
      faction,
      request.formation.id,
      request.cards.map((card) => card.id),
      fromFloat(anchorX),
      fromFloat(anchorY),
    );
    if (!netLoop.match.validate(cmd)) return false;
    netLoop.sendInput([cmd]);
    return true;
  };

  const handPanel = createHandPanel({
    deck: netLoop.match.decks[faction],
    externalDraw: true,
    externalCardConsume: true,
    getDrawRemainingMs: () => ticksUntilDrawMs(netLoop.world.tick),
    onRequestSpawn: requestSpawn,
    canDropAt: (point, formation) => canSpawnAt(formation, point),
    onBuildingDragStart: (formation) => {
      const typeId = getFormationBuildingTypeId(formation);
      if (!typeId) return;
      stopBuildingPreview();
      soloBuildingPreview = enableBuildingPlacement({
        domElement: sceneContext.renderer.domElement,
        camera: sceneContext.camera,
        groundPlane: sceneContext.groundPlane,
        scene: sceneContext.scene,
        world: netLoop.world,
        getFaction: () => faction,
        getTypeId: () => typeId,
        halfCourtFaction: faction,
        listenInput: false,
        onPlace: () => {},
      });
    },
    onBuildingDragMove: (clientX, clientY) => soloBuildingPreview?.syncPointer(clientX, clientY),
    onBuildingDragEnd: stopBuildingPreview,
  });

  // 联机禁用运行控制；面板只读 world 统计，挂一个只读壳避免改 SimLoop API
  const statsLoop = {
    world: netLoop.world,
    match: netLoop.match,
    paused: false,
    speed: 1,
    prev: netLoop.prev,
    curr: netLoop.curr,
    enqueue() {},
    advance() {},
    stepOnce() {},
    get alpha() {
      return netLoop.alpha;
    },
    reset() {},
  } as unknown as SimLoop;

  const panel = createPanel({
    loop: statsLoop,
    onClear: () => {},
    enableSpawnControls: false,
    enableRuntimeControls: false,
  });

  const returnToMenu = (): void => screens.show('menu');
  backButton.addEventListener('click', returnToMenu);

  let lastFrameAt = performance.now();
  let smoothedFps = 60;
  let animationFrameId = 0;
  let lastHandSyncTick = netLoop.world.tick;

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    smoothedFps += (1000 / Math.max(deltaMs, 1) - smoothedFps) * 0.08;

    netLoop.advance(deltaMs);
    if (netLoop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = netLoop.world.tick;
      handPanel.syncFromDeck();
    }
    handPanel.update(deltaMs);
    battleView.render(netLoop.prev, netLoop.curr, netLoop.alpha, sceneContext.camera);
    sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
    panel.updateStats(smoothedFps);

    animationFrameId = requestAnimationFrame(frame);
  };

  animationFrameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(animationFrameId);
    hud.classList.add('is-hidden');
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-versus');
    container.classList.remove('is-solo', 'is-versus');
    backButton.removeEventListener('click', returnToMenu);
    stopBuildingPreview();
    handPanel.dispose();
    panel.dispose();
    battleView.reset();
    closeSocket();
  };
}

function enterSandbox(): () => void {
  return enterBattleSession('sandbox');
}

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
  codex: () => {
    codexPage.show();
    return () => codexPage.hide();
  },
  sandbox: enterSandbox,
  solo: enterSolo,
  versus: enterVersus,
});
screens.show('menu');

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
  codexPage.dispose();
}

window.addEventListener('pagehide', disposeApp, { once: true });

/** 距下次 tick 抽牌的剩余毫秒。 */
function ticksUntilDrawMs(tick: number): number {
  const into = tick % DRAW_INTERVAL_TICKS;
  const remain = into === 0 ? DRAW_INTERVAL_TICKS : DRAW_INTERVAL_TICKS - into;
  return (remain * 1000) / TICK_RATE;
}

function setLobbyStatus(text: string): void {
  if (!lobbyStatus) return;
  lobbyStatus.textContent = text;
  lobbyStatus.classList.add('is-visible');
}

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

function pickRandomUnitType(): UnitTypeId {
  const mobile = UNIT_TYPE_IDS.filter((id) => !isBuildingConfig(UNIT_CONFIGS[id]));
  const index = Math.floor(Math.random() * mobile.length);
  return mobile[index]!;
}

function spawnRandomPk(target: SimLoop, clear: () => void): void {
  clear();
  const x = ARENA_W / 2;
  const blueType = pickRandomUnitType();
  const redType = pickRandomUnitType();
  target.enqueue(spawnCommand(Faction.Blue, blueType, fromFloat(x), fromFloat(6)));
  target.enqueue(spawnCommand(Faction.Red, redType, fromFloat(x), fromFloat(ARENA_H - 6)));
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
