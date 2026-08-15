import {
  Faction,
  SoloBotController,
  TICK_RATE,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type CardFormation,
  type MatchResult,
  type SoloDifficulty,
  type UnitTypeId,
  fromFloat,
  getFormationBuildingTypeId,
  getFuseBombTypeId,
  getUnitConfig,
  halfCourtSafeAnchor,
  halfCourtSafeBuildingAnchor,
  halfCourtYRange,
  isArcherTowerId,
  isBuildingConfig,
  isBuildingInsideHalfCourt,
  isBuildingOnlyFormation,
  isDeployAnchorInsideHalfCourt,
  isFuseBombFormation,
  isFuseBombTypeId,
  toFloat,
  claimCastlePackCommand,
  placeBuildingCommand,
  playFormationCommand,
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
import { createPanel } from './debug/panel.js';
import { IS_DEV_SERVER } from './env.js';
import {
  collectPlaceableBuildingCenters,
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
  screenToSim,
} from './input/placement.js';
import { enableAoePlacement, type AoePlacementHandle } from './input/aoePlacement.js';
import { enableCastlePackClick } from './input/castlePackClick.js';
import { enableUnitSelection } from './input/unitSelection.js';
import {
  connectRoomSession,
  createLobbyPresence,
  type LobbyPresenceHandle,
  type RoomConnecting,
  type RoomJoinRequest,
  type RoomSession,
} from './net/session.js';
import type { RoomStateMessage } from '@pb/net';
import type { NetSimLoop } from './net/netLoop.js';
import { createHandPanel, type FormationSpawnRequest } from './ui/handPanel.js';
import { enableDebugUnitDrag } from './ui/debugUnitDrag.js';
import { createBattleAnnounce } from './ui/battleAnnounce.js';
import { createBattleHud } from './ui/battleHud.js';
import { createBattleResult } from './ui/battleResult.js';
import { createCodexPage } from './ui/codexPage.js';
import { createDeckConfigPage } from './ui/deckConfigPage.js';
import { createHandOddsPage } from './ui/handOddsPage.js';
import { createMainMenu } from './ui/mainMenu.js';
import { createOnlineLobbyPage } from './ui/onlineLobbyPage.js';
import { createOnlineRoomPage } from './ui/onlineRoomPage.js';
import { createReconnectBanner } from './ui/reconnectBanner.js';
import { createScreenController, type AppScreen, type ScreenController } from './ui/screenController.js';
import { createSceneConfigPage } from './ui/sceneConfigPage.js';
import { createUnitStatsPage } from './ui/unitStatsPage.js';
import { ARENA_H, ARENA_W } from './view/coords.js';
import { applyMatchRulesView, defaultMatchRulesView } from './debug/matchRulesView.js';
import { loadRuntimeDefaults } from './debug/runtimeDefaults.js';
import { disposeFormationThumbnailRenderer } from './view/formationThumbnail.js';
import { createScene, type SceneContext } from './view/scene.js';
import { BattleView } from './view/viewSync.js';

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');

// 供 CSS 区分开发服 / 正式服可见功能
document.documentElement.classList.toggle('is-dev', IS_DEV_SERVER);

/** 设备档案：启动时静默建档，后续结算/改名都走同一实例。 */
const playerProfile = createPlayerProfileService();

let screens: ScreenController;
/** 大厅选择只影响下一场单机，避免在 UI 路由中扩散难度状态。 */
let selectedSoloDifficulty: SoloDifficulty = 'hard';
/** 开发服调试模式：人机对局但玩家侧改为任意单兵种放置；正常人机必须保持 false。 */
let selectedSoloDebugSpawn = false;
/** 房间会话跨 room/versus 复用；切屏时靠 keepRoomSession 避免误关 WS。 */
let activeRoomSession: RoomSession | null = null;
let joiningRoom: RoomConnecting | null = null;
let latestRoomState: RoomStateMessage | null = null;
let pendingMatch: { loop: NetSimLoop; faction: Faction; opponentName: string } | null = null;
let keepRoomSession = false;
/** 对局中对手离开时置位，避免中途退出被记成 abandoned。 */
let versusPeerLeft = false;
let reconnectBanner: ReturnType<typeof createReconnectBanner> | null = null;
/**
 * 应用层大厅 presence：凡未进入联机房间（含卡组/图鉴/单机）都保持登记。
 * 仅 room / versus 入房期间关闭，避免与 join 连接重复计数。
 * 单机页会上报 activity=solo，供运维站区分「大厅」与「单机模式」。
 */
let appLobbyPresence: LobbyPresenceHandle | null = null;

/** 未入房页面里，只有单机对局单独标成 solo。 */
function lobbyActivityForScreen(screen: AppScreen | null): 'lobby' | 'solo' {
  return screen === 'solo' ? 'solo' : 'lobby';
}

/** 确保未入房玩家登记为大厅；幂等。 */
function ensureAppLobbyPresence(activity: 'lobby' | 'solo' = 'lobby'): LobbyPresenceHandle {
  if (!appLobbyPresence) {
    const profile = playerProfile.getProfile();
    appLobbyPresence = createLobbyPresence({
      name: profile.displayName,
      playerId: profile.deviceAccountId,
      activity,
    });
  }
  return appLobbyPresence;
}

/** 进入联机房间或销毁应用时注销大厅。 */
function stopAppLobbyPresence(): void {
  appLobbyPresence?.dispose();
  appLobbyPresence = null;
}

/** 按当前页面同步大厅 presence：入房页断开，单机刷新 activity。 */
function syncLobbyPresenceForScreen(screen: AppScreen): void {
  if (screen === 'versus' || screen === 'room') {
    stopAppLobbyPresence();
    return;
  }
  const activity = lobbyActivityForScreen(screen);
  ensureAppLobbyPresence(activity).setActivity(activity);
}

const mainMenu = createMainMenu({
  // 正式服入口仍显示，点击提示由大厅处理；这里再挡一层防止误入
  onStartSandbox: () => {
    if (!IS_DEV_SERVER) return;
    screens.show('sandbox');
  },
  onStartSolo: (difficulty) => {
    selectedSoloDifficulty = difficulty;
    selectedSoloDebugSpawn = false;
    screens.show('solo');
  },
  onStartSoloDebug: () => {
    if (!IS_DEV_SERVER) return;
    selectedSoloDifficulty = 'hard';
    selectedSoloDebugSpawn = true;
    screens.show('solo');
  },
  onOpenOnline: () => screens.show('online'),
  onOpenDeckConfig: () => screens.show('deck-config'),
  onOpenCodex: () => screens.show('codex'),
  getProfile: () => playerProfile.getProfile(),
  onRename: (displayName) => {
    playerProfile.setDisplayName(displayName);
    // 大厅连接已带旧名，重连一次让运维站立刻看到新名字。
    if (appLobbyPresence) {
      const activity = lobbyActivityForScreen(screens.current);
      stopAppLobbyPresence();
      ensureAppLobbyPresence(activity);
    }
  },
});
const deckConfigPage = createDeckConfigPage({
  onBack: () => screens.show('menu'),
  onOpenHandOdds: () => screens.show('hand-odds'),
});
const unitStatsPage = createUnitStatsPage({ onBack: () => screens.show('codex') });
const handOddsPage = createHandOddsPage({
  onBack: () => screens.show('deck-config'),
  onBeforeBalance: () => unitStatsPage.flushPending(),
});
const sceneConfigPage = createSceneConfigPage({ onBack: () => screens.show('codex') });
const codexPage = createCodexPage({
  onBack: () => screens.show('menu'),
  onOpenUnitStats: () => screens.show('unit-stats'),
  onOpenSceneConfig: () => screens.show('scene-config'),
});
const battleHud = createBattleHud();
const battleAnnounce = createBattleAnnounce();
const battleResult = createBattleResult(() => {
  if (activeRoomSession) {
    keepRoomSession = true;
    screens.show('room');
    return;
  }
  screens.show('menu');
});
const onlineLobbyPage = createOnlineLobbyPage({
  onBack: () => screens.show('menu'),
  onJoinRoom: (request) => beginJoinRoom(request),
  getDefaultRoomName: () => {
    const displayName = playerProfile.getProfile().displayName.trim() || '玩家';
    return `${displayName}的房间`;
  },
  listRooms: () => ensureAppLobbyPresence().listRooms(),
});
const onlineRoomPage = createOnlineRoomPage({
  onLeave: () => {
    keepRoomSession = false;
    screens.show('online');
  },
  onStartMatch: () => {
    activeRoomSession?.sendStartMatch();
  },
  onSetReady: (ready) => {
    activeRoomSession?.sendSetReady(ready);
  },
});

/** 关闭入房中的连接，避免重复占席。 */
function cancelJoiningRoom(): void {
  joiningRoom?.close();
  joiningRoom = null;
}

/** 主动离房：关会话并清掉房间快照。 */
function disposeRoomSession(): void {
  cancelJoiningRoom();
  activeRoomSession?.close();
  activeRoomSession = null;
  latestRoomState = null;
  pendingMatch = null;
}

/** 创建或加入房间，成功后进入房间页。 */
function beginJoinRoom(request: RoomJoinRequest): void {
  cancelJoiningRoom();
  stopAppLobbyPresence();
  onlineLobbyPage.showError(
    request.mode === 'create' ? '正在创建房间…' : `正在加入房间 ${request.roomId ?? ''}…`,
  );
  const connecting = connectRoomSession({
    name: playerProfile.getProfile().displayName,
    playerId: playerProfile.getProfile().deviceAccountId,
    mode: request.mode,
    roomId: request.roomId,
    roomName: request.roomName,
    onStatus: (text) => {
      if (screens.current === 'online') onlineLobbyPage.showError(text);
      else onlineRoomPage.showStatus(text);
    },
    onRoomState: (state) => {
      latestRoomState = state;
      if (activeRoomSession && screens.current === 'room') {
        onlineRoomPage.applyRoomState(state, activeRoomSession.seat);
      }
    },
    onMatchStart: (loop, faction, opponentName) => {
      pendingMatch = { loop, faction, opponentName };
      keepRoomSession = true;
      screens.show('versus');
    },
    onMatchEnd: () => {
      // 结算展示与记账由对局循环处理，避免重复写入档案
    },
    onPeerDisconnected: () => {
      reconnectBanner?.showPeerDisconnected();
    },
    onPeerReconnected: () => {
      reconnectBanner?.showPeerReconnected();
    },
    onReconnecting: (remainingMs) => {
      reconnectBanner?.showReconnecting(remainingMs);
    },
    onReconnected: () => {
      reconnectBanner?.showRestored();
    },
    onPeerLeft: () => {
      versusPeerLeft = true;
      keepRoomSession = false;
      disposeRoomSession();
      onlineLobbyPage.showError('对手已离开');
      screens.show('online');
    },
    onDisconnected: (reason) => {
      keepRoomSession = false;
      disposeRoomSession();
      onlineLobbyPage.showError(reason);
      screens.show('online');
    },
    onReconnectFailed: (reason) => {
      keepRoomSession = false;
      disposeRoomSession();
      onlineLobbyPage.showError(reason);
      screens.show('online');
    },
  });
  joiningRoom = connecting;
  void connecting.done
    .then((session) => {
      if (joiningRoom !== connecting) {
        session.close();
        return;
      }
      joiningRoom = null;
      activeRoomSession = session;
      screens.show('room');
    })
    .catch((error: unknown) => {
      if (joiningRoom !== connecting) return;
      joiningRoom = null;
      const message = error instanceof Error ? error.message : String(error);
      if (screens.current === 'online') {
        ensureAppLobbyPresence('lobby');
        onlineLobbyPage.showError(message);
      }
    });
}
const openUnitStatsButton = document.querySelector<HTMLButtonElement>('#btn-open-unit-stats');
const openSceneConfigButton = document.querySelector<HTMLButtonElement>('#btn-open-scene-config');

/** 开发服对局里用 overlay 调场景，改完立刻重建当前战场镜头/地形。 */
function bindSceneConfigOverlay(): () => void {
  if (!IS_DEV_SERVER) return () => {};
  const open = (): void => {
    sceneConfigPage.setOnApplied(() => {
      sharedScene?.rebuildArena();
    });
    sceneConfigPage.showAsOverlay();
  };
  openSceneConfigButton?.addEventListener('click', open);
  return () => {
    openSceneConfigButton?.removeEventListener('click', open);
    sceneConfigPage.setOnApplied(() => {});
    sceneConfigPage.hide();
  };
}

/**
 * 战斗场景跨「大厅 ↔ 单机/沙盒/联机」复用。
 * 退出大厅只停循环、藏 UI；WebGL dispose 推迟到页面卸载，避免返回卡顿。
 */
let sharedScene: SceneContext | null = null;
let sharedBattleView: BattleView | null = null;

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
    sharedScene.rebuildArena();
    sharedScene.setMode(mode, viewFaction);
  }
  // 每次进单机都套用已保存默认，保证场景配置页保存后的后续对局生效
  if (mode === 'solo') {
    sharedScene.setSoloCameraAngle(defaults.cameraAngle);
    sharedScene.setSoloViewBottomExtra(defaults.viewBottomExtra);
  }
  return sharedScene;
}

type BattleMode = 'sandbox' | 'solo';

/** 启动一轮战斗会话；离开时释放本局监听与循环，场景与配置面板保留。 */
function enterBattleSession(mode: BattleMode): () => void {
  const isSolo = mode === 'solo';
  const debugSpawn = isSolo && selectedSoloDebugSpawn && IS_DEV_SERVER;

  container.classList.toggle('is-solo', isSolo);
  hud.classList.toggle('is-solo', isSolo);
  hud.classList.toggle('is-solo-debug', debugSpawn);
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');
  if (isSolo) {
    battleResult.setReturnLabel('返回主界面');
    battleResult.hide();
    battleAnnounce.reset();
    battleHud.setContext({
      localFaction: Faction.Blue,
      localName: playerProfile.getProfile().displayName,
      opponentName: '电脑',
    });
    battleResult.setContext({
      localName: playerProfile.getProfile().displayName,
      opponentName: '电脑',
    });
    battleHud.show();
  }

  const sceneContext = ensureBattleScene(mode, Faction.Blue);
  sceneContext.resize();

  const battleView = sharedBattleView!;
  battleView.reset();
  battleView.setLocalFaction(Faction.Blue);

  // 单机走 MatchState，与联机共用出牌/抽牌规则，避免双路径漂移
  // 每局随机 seed（对齐服务端 room.ts），避免开局手牌永远相同
  const battleSeed = isSolo ? createBattleSeed() : 20260806;
  const loop = new SimLoop(battleSeed, { withMatch: isSolo });
  if (isSolo) {
    loop.match!.seedStartingCastles();
    // 立刻拍一帧快照，首帧就能看到城堡
    loop.curr = takeSnapshot(loop.world, loop.curr);
    loop.prev = takeSnapshot(loop.world, loop.prev);
  }
  const soloBot = isSolo ? new SoloBotController(selectedSoloDifficulty, battleSeed) : null;
  const removeSoloBot = soloBot
    ? loop.addCommandSource((match) => (match ? soloBot.decide(match) : null))
    : () => {};

  let disableUnitPlacement = (): void => {};
  let disableBuildingPlacementFn = (): void => {};
  let disableDebugUnitDrag = (): void => {};
  let dealFromCastle = false;
  let prevPackState = loop.match?.getCastlePackState(Faction.Blue) ?? 'none';
  const disableCastlePackClick = isSolo
    ? enableCastlePackClick({
        domElement: sceneContext.renderer.domElement,
        pickPack: (clientX, clientY) =>
          battleView.pickCastlePack(
            clientX,
            clientY,
            sceneContext.camera,
            sceneContext.renderer.domElement,
          ),
        onClaim: () => {
          const match = loop.match;
          if (!match) return;
          const command = claimCastlePackCommand(Faction.Blue);
          if (!match.validate(command)) return;
          loop.enqueue(command);
        },
      })
    : () => {};
  const disableUnitSelection = enableUnitSelection({
    domElement: sceneContext.renderer.domElement,
    camera: sceneContext.camera,
    groundPlane: sceneContext.groundPlane,
    pickUnit: (simX, simY) => battleView.pickUnitAtSim(simX, simY),
    onSelect: (unitId) => battleView.selectUnit(unitId),
  });
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

  /** 显示蓝方半场白色部署区；落点锚点落在该区域内即可放置。 */
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
    if (isFuseBombFormation(formation)) {
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
    return isDeployAnchorInsideHalfCourt(anchor.x, anchor.y, Faction.Blue);
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

  /** 调试单兵种自动落点：半场中央，与阵型按钮内松开一致。 */
  const debugSafeAnchor = (): { x: number; y: number } | null => {
    const { minY, maxY } = halfCourtYRange(Faction.Blue);
    const x = ARENA_W / 2;
    const y = (minY + maxY) / 2;
    if (!isDeployAnchorInsideHalfCourt(x, y, Faction.Blue)) return null;
    return { x, y };
  };

  /** 调试箭塔自动落点：半场中央附近最近的可放吸附格。 */
  const debugSafeBuildingAnchor = (typeId: UnitTypeId): { x: number; y: number } | null => {
    const centers = collectPlaceableBuildingCenters(loop.world, typeId, true);
    if (centers.length === 0) return null;
    const preferred = halfCourtSafeBuildingAnchor(UNIT_CONFIGS[typeId].footprint, Faction.Blue);
    const tx = preferred?.x ?? ARENA_W / 2;
    const ty = preferred?.y ?? 8;
    return centers.reduce((best, center) => {
      const bestDist = (best.x - tx) ** 2 + (best.y - ty) ** 2;
      const dist = (center.x - tx) ** 2 + (center.y - ty) ** 2;
      return dist < bestDist ? center : best;
    });
  };

  /** 调试箭塔落点：拖到场内则吸附校验；按钮内松开走半场最近可放格。 */
  const resolveDebugBuildingAnchor = (
    typeId: UnitTypeId,
    point: { clientX: number; clientY: number } | null,
  ): { x: number; y: number } | null => {
    if (!point) return debugSafeBuildingAnchor(typeId);
    const raw = screenToSim(
      sceneContext.renderer.domElement,
      sceneContext.camera,
      sceneContext.groundPlane,
      point.clientX,
      point.clientY,
    );
    if (!raw) return null;
    const footprint = UNIT_CONFIGS[typeId].footprint;
    const cx = snapBuildingCenter(raw.x, footprint);
    const cy = snapBuildingCenter(raw.y, footprint);
    if (!isBuildingInsideBlueHalf(cx, cy, footprint)) return null;
    if (!loop.world.canPlaceBuilding(typeId, fromFloat(cx), fromFloat(cy))) return null;
    return { x: cx, y: cy };
  };

  /** 调试放兵落点校验：普通兵走蓝方半场；引信炸弹与出牌相同，必须拖到场内。 */
  const canDebugSpawnAt = (
    typeId: UnitTypeId,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (isArcherTowerId(typeId)) return resolveDebugBuildingAnchor(typeId, point) !== null;
    if (isFuseBombTypeId(typeId)) {
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
    const anchor = point
      ? screenToSim(
          sceneContext.renderer.domElement,
          sceneContext.camera,
          sceneContext.groundPlane,
          point.clientX,
          point.clientY,
        )
      : debugSafeAnchor();
    if (!anchor) return false;
    return isDeployAnchorInsideHalfCourt(anchor.x, anchor.y, Faction.Blue);
  };

  /** 调试模式出兵：普通兵 Spawn 到半场；炸弹走抛物线；箭塔走 PlaceBuilding。 */
  const requestDebugSpawn = (
    typeId: UnitTypeId,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (!canDebugSpawnAt(typeId, point)) return false;
    if (isArcherTowerId(typeId)) {
      const buildingAnchor = resolveDebugBuildingAnchor(typeId, point);
      if (!buildingAnchor) return false;
      loop.enqueue(
        placeBuildingCommand(Faction.Blue, typeId, fromFloat(buildingAnchor.x), fromFloat(buildingAnchor.y)),
      );
      return true;
    }
    const anchor = point
      ? screenToSim(
          sceneContext.renderer.domElement,
          sceneContext.camera,
          sceneContext.groundPlane,
          point.clientX,
          point.clientY,
        )
      : debugSafeAnchor();
    if (!anchor) return false;
    loop.enqueue(spawnCommand(Faction.Blue, typeId, fromFloat(anchor.x), fromFloat(anchor.y)));
    return true;
  };

  const handPanel = isSolo && !debugSpawn
    ? createHandPanel({
        deck: loop.match!.decks[Faction.Blue],
        externalDraw: true,
        externalCardConsume: true,
        getDrawRemainingMs: () => (loop.match!.getTicksUntilDraw() * 1000) / TICK_RATE,
        getDrawIntervalMs: () => (loop.match!.getDrawIntervalTicks() * 1000) / TICK_RATE,
        getMaxHandSize: () => loop.match!.getMaxHandSize(),
        getDealOrigin: () => {
          if (!dealFromCastle) return null;
          return battleView.getCastlePackClientPoint(
            sceneContext.camera,
            sceneContext.renderer.domElement,
          );
        },
        onRequestSpawn: requestSpawn,
        canDropAt: (point, formation) => canSpawnAt(formation, point),
        onBuildingDragStart,
        onBuildingDragMove: (clientX, clientY) => {
          soloBuildingPreview?.syncPointer(clientX, clientY);
        },
        onBuildingDragEnd: stopSoloBuildingPreview,
        onAoeDragStart: (formation) => {
          stopAoePreview();
          aoePreview = enableAoePlacement({
            domElement: sceneContext.renderer.domElement,
            camera: sceneContext.camera,
            groundPlane: sceneContext.groundPlane,
            scene: sceneContext.scene,
            radius: fuseBombPreviewRadius(formation),
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
    dealFromCastle = false;
    prevPackState = loop.match?.getCastlePackState(Faction.Blue) ?? 'none';
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
    enableSpawnControls: !isSolo || debugSpawn,
    enableRuntimeControls: runtimeControlsEnabled,
    onRandomPk: runtimeControlsEnabled
      ? () => spawnRandomPk(loop, clearBattlefield)
      : undefined,
    onDropCastlePack: isSolo
      ? () => {
          const match = loop.match;
          if (!match?.debugDropCastlePack(Faction.Blue)) return;
          battleView.replayCastlePack();
        }
      : undefined,
    ...(debugSpawn ? { lockFaction: Faction.Blue, includeArcherTowers: true } : {}),
    onBuildingModeChange: debugSpawn
      ? undefined
      : (typeId) => {
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
            soloMatchRules: {
              initial: defaultMatchRulesView(),
              onChange: (rules) => applyMatchRulesView(loop.match!, rules),
            },
          }
        : {}
      : { onBrawl: () => spawnBrawl(loop) }),
  });

  /** 战场入口以 overlay 打开参数页，避免切屏拆掉对局。 */
  const openUnitStatsOverlay = (): void => {
    unitStatsPage.setOnApplied(() => {
      clearBattlefield();
      panel.refreshUnitLabels();
    });
    unitStatsPage.showAsOverlay();
  };
  if (IS_DEV_SERVER) openUnitStatsButton?.addEventListener('click', openUnitStatsOverlay);
  const unbindSceneConfig = bindSceneConfigOverlay();

  if (!isSolo && !panel.buildingType) bindUnitPlacement();
  if (debugSpawn) {
    const unitGroup = document.querySelector<HTMLElement>('#unit-group');
    if (!unitGroup) throw new Error('调试模式缺少兵种栏');
    const drag = enableDebugUnitDrag({
      unitGroup,
      onPickUnit: (typeId) => panel.selectUnit(typeId),
      canDropAt: canDebugSpawnAt,
      onRequestSpawn: requestDebugSpawn,
      onDragStart: (typeId) => {
        if (isFuseBombTypeId(typeId)) {
          stopPlaceableHighlight();
          stopSoloBuildingPreview();
          stopAoePreview();
          aoePreview = enableAoePlacement({
            domElement: sceneContext.renderer.domElement,
            camera: sceneContext.camera,
            groundPlane: sceneContext.groundPlane,
            scene: sceneContext.scene,
            radius: fuseBombTypePreviewRadius(typeId),
          });
          return;
        }
        if (isArcherTowerId(typeId)) {
          stopPlaceableHighlight();
          stopAoePreview();
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
          return;
        }
        stopAoePreview();
        stopSoloBuildingPreview();
        startPlaceableHighlight();
      },
      onDragMove: (typeId, clientX, clientY) => {
        if (isFuseBombTypeId(typeId)) aoePreview?.syncPointer(clientX, clientY);
        if (isArcherTowerId(typeId)) soloBuildingPreview?.syncPointer(clientX, clientY);
      },
      onDragEnd: () => {
        stopPlaceableHighlight();
        stopAoePreview();
        stopSoloBuildingPreview();
      },
    });
    disableDebugUnitDrag = () => drag.dispose();
  }

  const returnToMenu = (): void => {
    unitStatsPage.hide();
    sceneConfigPage.hide();
    screens.show('menu');
  };
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
    if (isSolo && loop.match) {
      const packState = loop.match.getCastlePackState(Faction.Blue);
      if (loop.world.tick !== lastHandSyncTick) {
        dealFromCastle = prevPackState === 'pending' && packState === 'claimed';
        prevPackState = packState;
      }
      battleView.syncCastlePack(loop.match, sceneContext.camera);
    }
    if (handPanel && loop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = loop.world.tick;
      handPanel.syncFromDeck();
    }
    handPanel?.update(deltaMs);
    if (isSolo) {
      battleHud.update(loop.match!);
      battleAnnounce.tick(loop.match!);
      if (loop.match!.result && !resultShown) {
        resultShown = true;
        // 调试模式不写档案，避免污染正常人机战绩
        if (!debugSpawn) {
          recordLocalBattle(loop.match!.result, Faction.Blue, 'solo');
        }
        battleResult.show(loop.match!.result, Faction.Blue, loop.match!);
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
    battleAnnounce.reset();
    battleResult.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-solo-debug');
    container.classList.remove('is-solo');
    backButton.removeEventListener('click', returnToMenu);
    disableUnitPlacement();
    disableBuildingPlacementFn();
    disableDebugUnitDrag();
    disableCastlePackClick();
    disableUnitSelection();
    stopSoloBuildingPreview();
    stopPlaceableHighlight();
    stopAoePreview();
    handPanel?.dispose();
    removeSoloBot();
    panel.dispose();
    openUnitStatsButton?.removeEventListener('click', openUnitStatsOverlay);
    unitStatsPage.setOnApplied(() => {});
    unitStatsPage.hide();
    unbindSceneConfig();
    battleView.reset();
  };
}

/** 联机对战：等人齐后用 NetSimLoop 帧驱动。 */
function enterVersus(): () => void {
  const match = pendingMatch;
  pendingMatch = null;
  if (!match || !activeRoomSession) {
    queueMicrotask(() => screens.show(activeRoomSession ? 'room' : 'online'));
    return () => {};
  }

  let leave: (() => void) | null = null;
  let localFaction: Faction = match.faction;
  let matchStarted = true;
  let battleRecorded = false;
  const peerLeft = versusPeerLeft;
  versusPeerLeft = false;
  reconnectBanner = createReconnectBanner(hud);
  battleResult.setReturnLabel('返回房间');

  const recordVersusResult = (result: MatchResult, faction: Faction): void => {
    if (battleRecorded) return;
    battleRecorded = true;
    recordLocalBattle(result, faction, 'versus');
  };

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

  leave = runVersusSession(
    match.loop,
    match.faction,
    () => {},
    {
      onOfficialResult: (result) => recordVersusResult(result, localFaction),
      onLeaveWithoutResult: recordVersusAbandonedIfNeeded,
    },
    {
      localName: playerProfile.getProfile().displayName,
      opponentName: match.opponentName || activeRoomSession.opponentName || '对手',
    },
  );

  return () => {
    leave?.();
    leave = null;
    reconnectBanner?.dispose();
    reconnectBanner = null;
    hud.classList.remove('is-versus');
    container.classList.remove('is-versus');
    if (!keepRoomSession) {
      disposeRoomSession();
    }
    keepRoomSession = false;
  };
}

/** 联机会话主循环：本地输入只 send，手牌读 MatchState。 */
function runVersusSession(
  netLoop: import('./net/netLoop.js').NetSimLoop,
  faction: Faction,
  _closeSocket: () => void,
  accountHooks: {
    onOfficialResult: (result: MatchResult) => void;
    onLeaveWithoutResult: () => void;
  },
  names: {
    localName: string;
    opponentName: string;
  },
): () => void {
  mainMenu.hide();
  container.classList.add('is-solo', 'is-versus');
  hud.classList.add('is-solo', 'is-versus');
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');
  battleResult.hide();
  battleAnnounce.reset();
  battleHud.setContext({
    localFaction: faction,
    localName: names.localName,
    opponentName: names.opponentName,
  });
  battleResult.setContext({
    localName: names.localName,
    opponentName: names.opponentName,
  });
  battleHud.show();

  const sceneContext = ensureBattleScene('solo', faction);
  sceneContext.resize();
  const battleView = sharedBattleView!;
  battleView.reset();
  battleView.setLocalFaction(faction);
  let dealFromCastle = false;
  let prevPackState = netLoop.match.getCastlePackState(faction);
  const disableCastlePackClick = enableCastlePackClick({
    domElement: sceneContext.renderer.domElement,
    pickPack: (clientX, clientY) =>
      battleView.pickCastlePack(
        clientX,
        clientY,
        sceneContext.camera,
        sceneContext.renderer.domElement,
      ),
    onClaim: () => {
      const command = claimCastlePackCommand(faction);
      if (!netLoop.match.validate(command)) return;
      netLoop.sendInput([command]);
    },
  });
  const disableUnitSelection = enableUnitSelection({
    domElement: sceneContext.renderer.domElement,
    camera: sceneContext.camera,
    groundPlane: sceneContext.groundPlane,
    pickUnit: (simX, simY) => battleView.pickUnitAtSim(simX, simY),
    onSelect: (unitId) => battleView.selectUnit(unitId),
  });

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

  /** 显示本地阵营白色部署区；落点锚点落在该区域内即可放置。 */
  const startPlaceableHighlight = (): void => {
    stopPlaceableHighlight();
    placeableHighlight = showPlaceableHighlight(sceneContext.scene, collectHalfCourtPlaceableCells(faction));
  };

  const canSpawnAt = (
    formation: CardFormation,
    point: { clientX: number; clientY: number } | null,
  ): boolean => {
    if (isFuseBombFormation(formation)) {
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
    return isDeployAnchorInsideHalfCourt(anchor.x, anchor.y, faction);
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
    getMaxHandSize: () => netLoop.match.getMaxHandSize(),
    getDealOrigin: () => {
      if (!dealFromCastle) return null;
      return battleView.getCastlePackClientPoint(
        sceneContext.camera,
        sceneContext.renderer.domElement,
      );
    },
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
    onAoeDragStart: (formation) => {
      stopAoePreview();
      aoePreview = enableAoePlacement({
        domElement: sceneContext.renderer.domElement,
        camera: sceneContext.camera,
        groundPlane: sceneContext.groundPlane,
        scene: sceneContext.scene,
        radius: fuseBombPreviewRadius(formation),
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

  const unbindSceneConfig = bindSceneConfigOverlay();

  const returnToMenu = (): void => {
    sceneConfigPage.hide();
    keepRoomSession = false;
    screens.show('online');
  };
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
    const packState = netLoop.match.getCastlePackState(faction);
    if (netLoop.world.tick !== lastHandSyncTick) {
      dealFromCastle = prevPackState === 'pending' && packState === 'claimed';
      prevPackState = packState;
    }
    battleView.syncCastlePack(netLoop.match, sceneContext.camera);
    if (netLoop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = netLoop.world.tick;
      handPanel.syncFromDeck();
    }
    handPanel.update(deltaMs);
    battleHud.update(netLoop.match);
    battleAnnounce.tick(netLoop.match);
    if (netLoop.match.result && !resultShown) {
      resultShown = true;
      // 与 onMatchEnd 共用会话防重；谁先到都只记一次
      accountHooks.onOfficialResult(netLoop.match.result);
      battleResult.show(netLoop.match.result, faction, netLoop.match);
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
    battleAnnounce.reset();
    battleResult.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-versus');
    container.classList.remove('is-solo', 'is-versus');
    backButton.removeEventListener('click', returnToMenu);
    stopBuildingPreview();
    stopPlaceableHighlight();
    stopAoePreview();
    disableCastlePackClick();
    disableUnitSelection();
    handPanel.dispose();
    panel.dispose();
    unbindSceneConfig();
    battleView.reset();
  };
}

function enterSandbox(): () => void {
  return enterBattleSession('sandbox');
}

function enterSolo(): () => void {
  return enterBattleSession('solo');
}

function enterOnline(): () => void {
  syncLobbyPresenceForScreen('online');
  onlineLobbyPage.show();
  return () => {
    onlineLobbyPage.hide();
    if (!activeRoomSession) cancelJoiningRoom();
  };
}

function enterRoom(): () => void {
  syncLobbyPresenceForScreen('room');
  onlineRoomPage.show();
  if (activeRoomSession) {
    onlineRoomPage.setRoomInfo(activeRoomSession.roomId, activeRoomSession.roomName);
    if (latestRoomState) {
      onlineRoomPage.applyRoomState(latestRoomState, activeRoomSession.seat);
    }
  }
  return () => {
    onlineRoomPage.hide();
    if (!keepRoomSession) {
      disposeRoomSession();
    }
    keepRoomSession = false;
  };
}

screens = createScreenController({
  menu: () => {
    syncLobbyPresenceForScreen('menu');
    mainMenu.show();
    return () => mainMenu.hide();
  },
  online: () => enterOnline(),
  room: () => enterRoom(),
  'deck-config': () => {
    syncLobbyPresenceForScreen('deck-config');
    deckConfigPage.show();
    return () => deckConfigPage.hide();
  },
  'hand-odds': () => {
    syncLobbyPresenceForScreen('hand-odds');
    handOddsPage.show();
    return () => handOddsPage.hide();
  },
  codex: () => {
    syncLobbyPresenceForScreen('codex');
    codexPage.show();
    return () => codexPage.hide();
  },
  'unit-stats': () => {
    syncLobbyPresenceForScreen('unit-stats');
    unitStatsPage.setOnApplied(() => {});
    unitStatsPage.show();
    return () => unitStatsPage.hide();
  },
  'scene-config': () => {
    syncLobbyPresenceForScreen('scene-config');
    sceneConfigPage.show();
    return () => sceneConfigPage.hide();
  },
  sandbox: () => {
    // 正式服禁止进入沙盒；若被直接调起则立刻回大厅
    if (!IS_DEV_SERVER) {
      queueMicrotask(() => screens.show('menu'));
      return () => {};
    }
    syncLobbyPresenceForScreen('sandbox');
    return enterSandbox();
  },
  solo: () => {
    syncLobbyPresenceForScreen('solo');
    return enterSolo();
  },
  versus: () => {
    syncLobbyPresenceForScreen('versus');
    return enterVersus();
  },
});
screens.show('menu');

function disposeApp(): void {
  screens.dispose();
  stopAppLobbyPresence();
  sharedBattleView?.reset();
  sharedBattleView = null;
  sharedScene?.dispose();
  sharedScene = null;
  disposeFormationThumbnailRenderer();
  disposeRoomSession();
  onlineLobbyPage.dispose();
  onlineRoomPage.dispose();
  mainMenu.dispose();
  deckConfigPage.dispose();
  handOddsPage.dispose();
  unitStatsPage.dispose();
  sceneConfigPage.dispose();
  codexPage.dispose();
}

window.addEventListener('pagehide', disposeApp, { once: true });

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

/** 引信炸弹拖拽预览半径：读取兵种 aoeRadius，缺省回落 8。 */
function fuseBombTypePreviewRadius(typeId: 'giant_bomb' | 'small_bomb'): number {
  const attack = getUnitConfig(typeId).attack;
  return attack.kind === 'projectile_aoe' ? toFloat(attack.aoeRadius) : 8;
}

function fuseBombPreviewRadius(formation: CardFormation): number {
  const typeId = getFuseBombTypeId(formation);
  if (!typeId) return 8;
  return fuseBombTypePreviewRadius(typeId);
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

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
