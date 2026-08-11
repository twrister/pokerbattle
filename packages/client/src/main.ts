import {
  Faction,
  SoloBotController,
  TICK_RATE,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type CardFormation,
  type MatchResult,
  type MatchState,
  type SoloDifficulty,
  type UnitTypeId,
  fromFloat,
  getFormationBuildingTypeId,
  halfCourtSafeAnchor,
  isBuildingConfig,
  isBuildingInsideHalfCourt,
  isBuildingOnlyFormation,
  isGiantBombFormation,
  isFormationInsideHalfCourt,
  playFormationCommand,
  resolveFormationSpawns,
  snapBuildingCenter,
  spawnCommand,
  takeSnapshot,
} from '@pb/sim';
import {
  battleInputFromMatchResult,
  createPlayerProfileService,
  shouldRecordVersusAbandon,
} from './account/index.js';
import { SimLoop } from './loop.js';
import { createConfigPanel, type ConfigPanelHandle } from './debug/configPanel.js';
import { createPanel } from './debug/panel.js';
import { IS_DEV_SERVER } from './env.js';
import {
  enableBuildingPlacement,
  type BuildingPlacementHandle,
} from './input/buildingPlacement.js';
import {
  collectHalfCourtPlaceableCells,
  showPlaceableHighlight,
  type PlaceableHighlightHandle,
} from './input/placeableHighlight.js';
import {
  enablePlacement,
  isBuildingInsideBlueHalf,
  isFormationInsideBlueHalf,
  screenToSim,
} from './input/placement.js';
import { enableAoePlacement, type AoePlacementHandle } from './input/aoePlacement.js';
import { connectVersusSession } from './net/session.js';
import { createHandPanel, type FormationSpawnRequest } from './ui/handPanel.js';
import { createBattleHud } from './ui/battleHud.js';
import { createBattleResult } from './ui/battleResult.js';
import { createCodexPage } from './ui/codexPage.js';
import { createDeckConfigPage } from './ui/deckConfigPage.js';
import { createHandOddsPage } from './ui/handOddsPage.js';
import { createMainMenu, type VersusJoinRequest } from './ui/mainMenu.js';
import { createReconnectBanner } from './ui/reconnectBanner.js';
import { createScreenController, type ScreenController } from './ui/screenController.js';
import { ARENA_H, ARENA_W } from './view/coords.js';
import {
  loadRuntimeDefaults,
  type RuntimeDefaults,
} from './debug/runtimeDefaults.js';
import { disposeFormationThumbnailRenderer } from './view/formationThumbnail.js';
import { createScene, type SceneContext } from './view/scene.js';
import { BattleView } from './view/viewSync.js';

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');
const lobbyStatus = document.querySelector<HTMLElement>('#lobby-status');

// 供 CSS 区分开发服 / 正式服可见功能
document.documentElement.classList.toggle('is-dev', IS_DEV_SERVER);

/** 设备档案：启动时静默建档，后续结算/改名都走同一实例。 */
const playerProfile = createPlayerProfileService();

let screens: ScreenController;
/** 大厅选择只影响下一场单机，避免在 UI 路由中扩散难度状态。 */
let selectedSoloDifficulty: SoloDifficulty = 'easy';
/** 进入 versus 前暂存入房参数，因 ScreenController 不携带 payload。 */
let pendingVersusJoin: VersusJoinRequest = { mode: 'quick' };
const mainMenu = createMainMenu({
  onStartSandbox: () => screens.show('sandbox'),
  onStartSolo: (difficulty) => {
    selectedSoloDifficulty = difficulty;
    screens.show('solo');
  },
  onStartVersus: (request) => {
    pendingVersusJoin = request;
    screens.show('versus');
  },
  onOpenDeckConfig: () => screens.show('deck-config'),
  onOpenCodex: () => screens.show('codex'),
  getProfile: () => playerProfile.getProfile(),
  onRename: (displayName) => {
    playerProfile.setDisplayName(displayName);
  },
});
const deckConfigPage = createDeckConfigPage({
  onBack: () => screens.show('menu'),
  onOpenHandOdds: () => screens.show('hand-odds'),
});
const handOddsPage = createHandOddsPage({ onBack: () => screens.show('deck-config') });
const codexPage = createCodexPage({ onBack: () => screens.show('menu') });
const battleHud = createBattleHud();
const battleResult = createBattleResult(() => screens.show('menu'));

/**
 * 战斗场景与配置面板跨「大厅 ↔ 单机/沙盒/联机」复用。
 * 退出大厅只停循环、藏 UI；WebGL dispose 与整表单拆解推迟到页面卸载，避免返回卡顿。
 */
let sharedScene: SceneContext | null = null;
let sharedBattleView: BattleView | null = null;
let sharedConfigPanel: ConfigPanelHandle | null = null;

/** 懒创建或切换镜头模式，始终复用同一个 WebGLRenderer。 */
function ensureBattleScene(mode: BattleMode, viewFaction: Faction = Faction.Blue): SceneContext {
  const defaults = loadRuntimeDefaults();
  if (!sharedScene) {
    sharedScene = createScene(container, {
      mode,
      viewFaction,
      soloCameraAngle: defaults.cameraAngle,
      soloViewBottomExtra: defaults.viewBottomExtra,
    });
    sharedBattleView = new BattleView(sharedScene.scene);
  } else {
    sharedScene.setMode(mode, viewFaction);
  }
  // 每次进单机都套用已保存默认，保证「保存为默认」后的后续对局生效
  if (mode === 'solo') {
    sharedScene.setSoloCameraAngle(defaults.cameraAngle);
    sharedScene.setSoloViewBottomExtra(defaults.viewBottomExtra);
  }
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
  if (isSolo) {
    battleResult.hide();
    battleHud.show();
  }

  const sceneContext = ensureBattleScene(mode, Faction.Blue);
  sceneContext.resize();

  const battleView = sharedBattleView!;
  battleView.reset();

  // 单机走 MatchState，与联机共用出牌/抽牌规则，避免双路径漂移
  // 每局随机 seed（对齐服务端 room.ts），避免开局手牌永远相同
  const battleSeed = isSolo ? createBattleSeed() : 20260806;
  const loop = new SimLoop(battleSeed, { withMatch: isSolo });
  if (isSolo) {
    const runtimeDefaults = loadRuntimeDefaults();
    applySoloDrawIntervals(loop.match!, runtimeDefaults);
    loop.match!.seedStartingCastles();
    // 立刻拍一帧快照，首帧就能看到城堡
    loop.curr = takeSnapshot(loop.world);
    loop.prev = loop.curr;
  }
  const soloBot = isSolo ? new SoloBotController(selectedSoloDifficulty, battleSeed) : null;
  const removeSoloBot = soloBot
    ? loop.addCommandSource((match) => (match ? soloBot.decide(match) : null))
    : () => {};

  let disableUnitPlacement = (): void => {};
  let disableBuildingPlacementFn = (): void => {};
  let soloBuildingPreview: BuildingPlacementHandle | null = null;
  let placeableHighlight: PlaceableHighlightHandle | null = null;
  let aoePreview: AoePlacementHandle | null = null;

  const stopSoloBuildingPreview = (): void => {
    if (!soloBuildingPreview) return;
    soloBuildingPreview.dispose();
    soloBuildingPreview = null;
  };

  /** 清除当前手牌拖拽所显示的白色部署区。 */
  const stopPlaceableHighlight = (): void => {
    if (!placeableHighlight) return;
    placeableHighlight.dispose();
    placeableHighlight = null;
  };

  /** 清除巨型炸弹拖拽时的半径提示。 */
  const stopAoePreview = (): void => {
    aoePreview?.dispose();
    aoePreview = null;
  };

  /** 显示蓝方半场的基础部署区，具体阵型边界仍由落点校验处理。 */
  const startPlaceableHighlight = (): void => {
    stopPlaceableHighlight();
    placeableHighlight = showPlaceableHighlight(
      sceneContext.scene,
      collectHalfCourtPlaceableCells(Faction.Blue),
    );
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
    if (isGiantBombFormation(formation)) {
      if (!point) return false;
      const anchor = screenToSim(
        sceneContext.renderer.domElement,
        sceneContext.camera,
        sceneContext.groundPlane,
        point.clientX,
        point.clientY,
      );
      return Boolean(anchor && anchor.x >= 0 && anchor.x <= ARENA_W && anchor.y >= 0 && anchor.y <= ARENA_H);
    }
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
        getDrawRemainingMs: () => (loop.match!.getTicksUntilDraw() * 1000) / TICK_RATE,
        getDrawIntervalMs: () => (loop.match!.getDrawIntervalTicks() * 1000) / TICK_RATE,
        onRequestSpawn: requestSpawn,
        canDropAt: (point, formation) => canSpawnAt(formation, point),
        onBuildingDragStart,
        onBuildingDragMove: (clientX, clientY) => {
          soloBuildingPreview?.syncPointer(clientX, clientY);
        },
        onBuildingDragEnd: stopSoloBuildingPreview,
        onAoeDragStart: () => {
          stopAoePreview();
          aoePreview = enableAoePlacement({
            domElement: sceneContext.renderer.domElement,
            camera: sceneContext.camera,
            groundPlane: sceneContext.groundPlane,
            scene: sceneContext.scene,
            radius: 8,
          });
        },
        onAoeDragMove: (clientX, clientY) => aoePreview?.syncPointer(clientX, clientY),
        onAoeDragEnd: stopAoePreview,
        onPlaceableHighlightStart: startPlaceableHighlight,
        onPlaceableHighlightEnd: stopPlaceableHighlight,
      })
    : null;

  const clearBattlefield = (): void => {
    loop.reset();
    battleView.invalidateUnitViews();
    handPanel?.syncFromDeck();
  };

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
            soloDrawIntervals: {
              initial: loadRuntimeDefaults(),
              onChange: (intervals) => applySoloDrawIntervals(loop.match!, intervals),
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
  let resultShown = false;

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
    if (isSolo) {
      battleHud.update(loop.match!);
      if (loop.match!.result && !resultShown) {
        resultShown = true;
        // 单机仅在权威结算时记一笔；中途返回不写档案
        recordLocalBattle(loop.match!.result, Faction.Blue, 'solo');
        battleResult.show(loop.match!.result, Faction.Blue);
      }
    }
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
    battleHud.hide();
    battleResult.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo');
    container.classList.remove('is-solo');
    backButton.removeEventListener('click', returnToMenu);
    disableUnitPlacement();
    disableBuildingPlacementFn();
    stopSoloBuildingPreview();
    stopPlaceableHighlight();
    stopAoePreview();
    handPanel?.dispose();
    removeSoloBot();
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
  let localFaction: Faction | null = null;
  /** 对局已真正开始后才可能记 abandoned；匹配期退出不计。 */
  let matchStarted = false;
  /** 会话内只记一笔：权威结算优先，主动退出次之。 */
  let battleRecorded = false;
  /** 对手离开不记本方失败。 */
  let peerLeft = false;
  const joinRequest = pendingVersusJoin;
  const reconnectBanner = createReconnectBanner(hud);

  /** 权威结算写入档案；重复调用会被会话标记挡住。 */
  const recordVersusResult = (result: MatchResult, faction: Faction): void => {
    if (battleRecorded) return;
    battleRecorded = true;
    recordLocalBattle(result, faction, 'versus');
  };

  /** 本机中途退出：记一次 abandoned 失败。 */
  const recordVersusAbandonedIfNeeded = (): void => {
    if (!shouldRecordVersusAbandon({ matchStarted, battleRecorded, peerLeft })) return;
    battleRecorded = true;
    try {
      playerProfile.recordBattle({
        mode: 'versus',
        outcome: 'loss',
        reason: 'abandoned',
      });
      mainMenu.refreshProfile();
    } catch (error) {
      console.error('[account] 联机中途退出记录失败', error);
    }
  };

  container.classList.add('is-solo', 'is-versus');
  hud.classList.add('is-solo', 'is-versus');
  // 匹配期仍留在大厅层提示状态；对局开始后再由 runVersusSession 揭开战场
  mainMenu.show();
  setLobbyStatus(
    joinRequest.mode === 'create'
      ? '正在创建房间…'
      : joinRequest.mode === 'room'
        ? `正在加入房间 ${joinRequest.roomId}…`
        : '正在匹配联机对手…',
  );

  void connectVersusSession({
    name: playerProfile.getProfile().displayName,
    mode: joinRequest.mode,
    roomId: joinRequest.roomId,
    roomName: joinRequest.roomName,
    onStatus: setLobbyStatus,
    onDesync: (tick, serverHash) => {
      console.error(`[desync] tick=${tick} serverHash=${serverHash}`);
      setLobbyStatus(`不同步：tick ${tick}`);
    },
    onPeerLeft: () => {
      peerLeft = true;
      reconnectBanner.hide();
      setLobbyStatus('对手已离开');
      screens.show('menu');
    },
    onPeerDisconnected: () => {
      reconnectBanner.showPeerDisconnected();
    },
    onPeerReconnected: () => {
      reconnectBanner.showPeerReconnected();
    },
    onReconnecting: (remainingMs) => {
      reconnectBanner.showReconnecting(remainingMs);
    },
    onReconnected: () => {
      reconnectBanner.showRestored();
    },
    onReconnectFailed: (reason) => {
      reconnectBanner.showFailed(reason);
      setLobbyStatus(reason);
      screens.show('menu');
    },
    onMatchEnd: (result) => {
      if (localFaction === null) return;
      recordVersusResult(result, localFaction);
      battleResult.show(result, localFaction);
    },
  })
    .then((session) => {
      if (cancelled) {
        session.close();
        return;
      }
      localFaction = session.faction;
      matchStarted = true;
      leave = runVersusSession(session.loop, session.faction, session.close, {
        onOfficialResult: (result) => recordVersusResult(result, session.faction),
        onLeaveWithoutResult: recordVersusAbandonedIfNeeded,
      });
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
    reconnectBanner.dispose();
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
  accountHooks: {
    onOfficialResult: (result: MatchResult) => void;
    onLeaveWithoutResult: () => void;
  },
): () => void {
  mainMenu.hide();
  container.classList.add('is-solo', 'is-versus');
  hud.classList.add('is-solo', 'is-versus');
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');
  battleResult.hide();
  battleHud.show();

  const sceneContext = ensureBattleScene('solo', faction);
  sceneContext.resize();
  const battleView = sharedBattleView!;
  battleView.reset();

  let soloBuildingPreview: BuildingPlacementHandle | null = null;
  let placeableHighlight: PlaceableHighlightHandle | null = null;
  let aoePreview: AoePlacementHandle | null = null;
  const stopBuildingPreview = (): void => {
    if (!soloBuildingPreview) return;
    soloBuildingPreview.dispose();
    soloBuildingPreview = null;
  };

  /** 清除当前手牌拖拽所显示的白色部署区。 */
  const stopPlaceableHighlight = (): void => {
    if (!placeableHighlight) return;
    placeableHighlight.dispose();
    placeableHighlight = null;
  };

  /** 清除巨型炸弹拖拽时的半径提示。 */
  const stopAoePreview = (): void => {
    aoePreview?.dispose();
    aoePreview = null;
  };

  /** 显示本地阵营半场的基础部署区，具体阵型边界仍由落点校验处理。 */
  const startPlaceableHighlight = (): void => {
    stopPlaceableHighlight();
    placeableHighlight = showPlaceableHighlight(sceneContext.scene, collectHalfCourtPlaceableCells(faction));
  };

  const canSpawnAt = (
    formation: CardFormation,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (isGiantBombFormation(formation)) {
      if (!point) return false;
      const anchor = screenToSim(
        sceneContext.renderer.domElement,
        sceneContext.camera,
        sceneContext.groundPlane,
        point.clientX,
        point.clientY,
      );
      return Boolean(anchor && anchor.x >= 0 && anchor.x <= ARENA_W && anchor.y >= 0 && anchor.y <= ARENA_H);
    }
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
    getDrawRemainingMs: () => (netLoop.match.getTicksUntilDraw() * 1000) / TICK_RATE,
    getDrawIntervalMs: () => (netLoop.match.getDrawIntervalTicks() * 1000) / TICK_RATE,
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
    onAoeDragStart: () => {
      stopAoePreview();
      aoePreview = enableAoePlacement({
        domElement: sceneContext.renderer.domElement,
        camera: sceneContext.camera,
        groundPlane: sceneContext.groundPlane,
        scene: sceneContext.scene,
        radius: 8,
      });
    },
    onAoeDragMove: (clientX, clientY) => aoePreview?.syncPointer(clientX, clientY),
    onAoeDragEnd: stopAoePreview,
    onPlaceableHighlightStart: startPlaceableHighlight,
    onPlaceableHighlightEnd: stopPlaceableHighlight,
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
  let resultShown = false;

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
    battleHud.update(netLoop.match);
    if (netLoop.match.result && !resultShown) {
      resultShown = true;
      // 与 onMatchEnd 共用会话防重；谁先到都只记一次
      accountHooks.onOfficialResult(netLoop.match.result);
      battleResult.show(netLoop.match.result, faction);
    }
    battleView.render(netLoop.prev, netLoop.curr, netLoop.alpha, sceneContext.camera);
    sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
    panel.updateStats(smoothedFps);

    animationFrameId = requestAnimationFrame(frame);
  };

  animationFrameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(animationFrameId);
    // 离开时兜底：已有权威结果则补记，否则按本机中途退出处理
    if (netLoop.match.result) accountHooks.onOfficialResult(netLoop.match.result);
    else accountHooks.onLeaveWithoutResult();
    hud.classList.add('is-hidden');
    battleHud.hide();
    battleResult.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-versus');
    container.classList.remove('is-solo', 'is-versus');
    backButton.removeEventListener('click', returnToMenu);
    stopBuildingPreview();
    stopPlaceableHighlight();
    stopAoePreview();
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
  'hand-odds': () => {
    handOddsPage.show();
    return () => handOddsPage.hide();
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
  handOddsPage.dispose();
  codexPage.dispose();
}

window.addEventListener('pagehide', disposeApp, { once: true });

/** 距下次 tick 抽牌的剩余毫秒。 */
function setLobbyStatus(text: string): void {
  if (!lobbyStatus) return;
  lobbyStatus.textContent = text;
  lobbyStatus.classList.add('is-visible');
}

/** 把权威结算写入设备档案，并刷新大厅展示。 */
function recordLocalBattle(
  result: MatchResult,
  playerFaction: Faction,
  mode: 'solo' | 'versus',
): void {
  try {
    playerProfile.recordBattle(battleInputFromMatchResult(result, playerFaction, mode));
    mainMenu.refreshProfile();
  } catch (error) {
    console.error('[account] 对战记录写入失败', error);
  }
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

/** 生成非 0 对局种子，写法与服务端 room 一致，保证每局手牌可变化。 */
function createBattleSeed(): number {
  let seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
  if (seed === 0) seed = 0x9e3779b9;
  return seed;
}

/** 把运行控制里的秒数换算成 tick，写回单机 MatchState。 */
function applySoloDrawIntervals(
  match: MatchState,
  intervals: Pick<
    RuntimeDefaults,
    | 'normalDrawIntervalSeconds'
    | 'doubleSpeedDrawIntervalSeconds'
    | 'overtimeDrawIntervalSeconds'
  >,
): void {
  match.setDrawIntervals({
    normalTicks: Math.round(intervals.normalDrawIntervalSeconds * TICK_RATE),
    doubleSpeedTicks: Math.round(intervals.doubleSpeedDrawIntervalSeconds * TICK_RATE),
    overtimeTicks: Math.round(intervals.overtimeDrawIntervalSeconds * TICK_RATE),
  });
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
