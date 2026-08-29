import {
  applyArenaPreset,
  Faction,
  opposingFaction,
  SoloBotController,
  teammateSlot,
  teamSlots,
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
  halfCourtSlotAnchorX,
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
  shouldConfirmVersusLeave,
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
import {
  attackReachPreviewRadius,
  enableAttackRangePlacement,
  formationAttackRangePreviewRadius,
  showsAttackRangeOnPlace,
  type AttackRangePlacementHandle,
} from './input/attackRangePreview.js';
import { enableCastlePackClick } from './input/castlePackClick.js';
import { enableUnitSelection } from './input/unitSelection.js';
import {
  connectRoomSession,
  connectSpectateSession,
  createLobbyPresence,
  type LobbyPresenceHandle,
  type RoomConnecting,
  type RoomJoinRequest,
  type RoomSession,
  type SpectateConnecting,
  type SpectateSession,
} from './net/session.js';
import type { RoomStateMessage } from '@pb/net';
import type { NetSimLoop } from './net/netLoop.js';
import { createHandPanel, type FormationSpawnRequest } from './ui/handPanel.js';
import { enableDebugUnitDrag } from './ui/debugUnitDrag.js';
import {
  BASE_DOWN_ANNOUNCE,
  createBattleAnnounce,
  TEAMMATE_DOWN_ANNOUNCE,
} from './ui/battleAnnounce.js';
import { createBattleHud } from './ui/battleHud.js';
import { createBattleResult } from './ui/battleResult.js';
import { createVersusExitConfirm } from './ui/versusExitConfirm.js';
import { createSpectatorHands, type SpectatorHandNames } from './ui/spectatorHands.js';
import { createCodexPage } from './ui/codexPage.js';
import { createDeckConfigPage } from './ui/deckConfigPage.js';
import { createHandOddsPage } from './ui/handOddsPage.js';
import { createSpecialTierPage } from './ui/specialTierPage.js';
import { createLeaderboardPage } from './ui/leaderboardPage.js';
import { createMainMenu } from './ui/mainMenu.js';
import { createReplayControls } from './ui/replayControls.js';
import { createReplayListPage } from './ui/replayListPage.js';
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
import {
  createArenaSignature,
  createReplayStore,
  ReplayLoop,
  ReplayRecorder,
  type ReplayRecord,
  type ReplaySideContext,
} from './replay/index.js';

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');

// 供 CSS 区分开发服 / 正式服可见功能
document.documentElement.classList.toggle('is-dev', IS_DEV_SERVER);

/** 设备档案：启动时静默建档，后续结算/改名都走同一实例。 */
const playerProfile = createPlayerProfileService();
/** 联机录像独立落盘，避免改档案时重写整段指令序列。 */
const replayStore = createReplayStore();

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
let pendingSpectate: { loop: NetSimLoop; blueName: string; redName: string } | null = null;
let activeSpectateSession: SpectateSession | null = null;
let joiningSpectate: SpectateConnecting | null = null;
let spectateMatchEnded = false;
let pendingReplay: ReplayRecord | null = null;
let replaySessionActive = false;
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
  if (screen === 'versus' || screen === 'room' || screen === 'spectate') {
    stopAppLobbyPresence();
    return;
  }
  const activity = lobbyActivityForScreen(screen);
  ensureAppLobbyPresence(activity).setActivity(activity);
}

const mainMenu = createMainMenu({
  onStartSandbox: () => {
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
  onOpenLeaderboard: () => screens.show('leaderboard'),
  onOpenReplays: () => screens.show('replay-list'),
  onSyncBattleScore: async () => {
    try {
      const board = await ensureAppLobbyPresence().listLeaderboard();
      if (board.self) {
        playerProfile.setProgression({ battleScore: board.self.score });
      }
    } catch {
      /* 离线保留上次积分 */
    }
  },
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
  onOpenSpecialTiers: () => screens.show('special-tiers'),
});
const specialTierPage = createSpecialTierPage({
  onBack: () => screens.show('deck-config'),
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
const spectatorHands = createSpectatorHands();
const versusExitConfirm = createVersusExitConfirm();
const battleResult = createBattleResult(() => {
  if (replaySessionActive || pendingReplay) {
    screens.show('replay-list');
    return;
  }
  if (activeSpectateSession || pendingSpectate || spectateMatchEnded) {
    screens.show('online');
    return;
  }
  if (activeRoomSession) {
    keepRoomSession = true;
    screens.show('room');
    return;
  }
  screens.show('menu');
});
const leaderboardPage = createLeaderboardPage({
  onBack: () => screens.show('menu'),
  loadLeaderboard: () => ensureAppLobbyPresence().listLeaderboard(),
});
const replayListPage = createReplayListPage({
  onBack: () => screens.show('menu'),
  listReplays: () => replayStore.list(),
  onPlay: (record) => {
    pendingReplay = record;
    screens.show('replay');
  },
});
const onlineLobbyPage = createOnlineLobbyPage({
  onBack: () => screens.show('menu'),
  onJoinRoom: (request) => beginJoinRoom(request),
  onSpectateRoom: (roomId) => beginSpectate(roomId),
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
  onSetMatchMode: (mode) => {
    activeRoomSession?.sendSetRoomOptions(mode);
  },
  onPickSeat: (seat) => {
    activeRoomSession?.sendPickSeat(seat);
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

/** 关闭观战连接，避免离开后仍占服务端观战席。 */
function disposeSpectateSession(): void {
  joiningSpectate?.close();
  joiningSpectate = null;
  activeSpectateSession?.close();
  activeSpectateSession = null;
  pendingSpectate = null;
  spectateMatchEnded = false;
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
    matchMode: request.matchMode,
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
      // 败方可能还停在结算屏；重复 show('versus') 会被忽略，上一局 playLocked / 旧 loop 会留下。
      screens.show('versus', { remount: screens.current === 'versus' });
    },
    onSpectatorCount: (count) => {
      battleHud.setSpectatorCount(count);
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

/** 观战已开局房间：独立 WS，成功后切到 spectate 屏。 */
function beginSpectate(roomId: string): void {
  joiningSpectate?.close();
  joiningSpectate = null;
  stopAppLobbyPresence();
  spectateMatchEnded = false;
  onlineLobbyPage.showError(`正在观战房间 ${roomId}…`);
  const connecting = connectSpectateSession({
    roomId,
    name: playerProfile.getProfile().displayName,
    playerId: playerProfile.getProfile().deviceAccountId,
    onStatus: (text) => {
      if (screens.current === 'online') onlineLobbyPage.showError(text);
    },
    onReady: (loop, names) => {
      pendingSpectate = { loop, blueName: names.blueName, redName: names.redName };
      if (screens.current !== 'spectate') screens.show('spectate');
    },
    onSpectatorCount: (count) => {
      battleHud.setSpectatorCount(count);
    },
    onMatchEnd: () => {
      spectateMatchEnded = true;
    },
    onClosed: (reason) => {
      joiningSpectate = null;
      activeSpectateSession = null;
      if (spectateMatchEnded) return;
      pendingSpectate = null;
      onlineLobbyPage.showError(reason);
      if (screens.current === 'spectate') screens.show('online');
    },
  });
  joiningSpectate = connecting;
  void connecting.done
    .then((session) => {
      if (joiningSpectate !== connecting) {
        session.close();
        return;
      }
      joiningSpectate = null;
      activeSpectateSession = session;
    })
    .catch((error: unknown) => {
      if (joiningSpectate !== connecting) return;
      joiningSpectate = null;
      pendingSpectate = null;
      const message = error instanceof Error ? error.message : String(error);
      ensureAppLobbyPresence('lobby');
      onlineLobbyPage.showError(message);
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
    // 先收回弹道再重建地形，避免共享箭矢材质/几何被 dispose 后第二局隐形
    sharedBattleView?.reset();
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
  applyArenaPreset('1v1');
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
  battleView.setLocalSlot(Faction.Blue);

  // 单机走 MatchState，与联机共用出牌/抽牌规则，避免双路径漂移
  // 每局随机 seed（对齐服务端 room.ts），避免开局手牌永远相同
  const battleSeed = isSolo ? createBattleSeed() : 20260806;
  const loop = new SimLoop(battleSeed, { withMatch: isSolo });
  // 开发服「保存为默认」后的节奏；本局改数只动这份内存，重开/再进局都套它
  let soloMatchRulesView = isSolo ? loadRuntimeDefaults().matchRules : defaultMatchRulesView();
  if (isSolo) {
    loop.match!.seedStartingCastles();
    applyMatchRulesView(loop.match!, soloMatchRulesView);
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
  let attackRangePreview: AttackRangePlacementHandle | null = null;

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

  /** 清除连弩车/投弹车拖拽时的攻击范围圈。 */
  const stopAttackRangePreview = (): void => {
    attackRangePreview?.dispose();
    attackRangePreview = null;
  };

  /** 显示蓝方半场白色部署区；含射程预览兵种时再叠白圈。 */
  const startPlaceableHighlight = (formation?: CardFormation): void => {
    stopPlaceableHighlight();
    stopAttackRangePreview();
    placeableHighlight = showPlaceableHighlight(
      sceneContext.scene,
      collectHalfCourtPlaceableCells(Faction.Blue),
    );
    const radius = formation ? formationAttackRangePreviewRadius(formation) : null;
    if (radius == null) return;
    attackRangePreview = enableAttackRangePlacement({
      domElement: sceneContext.renderer.domElement,
      camera: sceneContext.camera,
      groundPlane: sceneContext.groundPlane,
      scene: sceneContext.scene,
      radius,
    });
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
      : halfCourtSafeAnchor(formation, Faction.Blue, halfCourtSlotAnchorX(loop.match?.mode ?? '1v1', 0));
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
        : halfCourtSafeAnchor(request.formation, Faction.Blue, halfCourtSlotAnchorX(loop.match?.mode ?? '1v1', 0));
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
        getDrawRemainingMs: () => (loop.match!.getTicksUntilDraw(Faction.Blue) * 1000) / TICK_RATE,
        getDrawIntervalMs: () => (loop.match!.getDrawIntervalTicks() * 1000) / TICK_RATE,
        getMaxHandSize: () => loop.match!.getMaxHandSize(),
        getHasPendingDraw: () => loop.match!.hasPendingDraw(Faction.Blue),
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
        onPlaceableHighlightMove: (clientX, clientY) => attackRangePreview?.syncPointer(clientX, clientY),
        onPlaceableHighlightEnd: () => {
          stopPlaceableHighlight();
          stopAttackRangePreview();
        },
      })
    : null;

  const clearBattlefield = (): void => {
    loop.reset();
    if (isSolo && loop.match) applyMatchRulesView(loop.match, soloMatchRulesView);
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
              initial: soloMatchRulesView,
              onChange: (rules) => {
                soloMatchRulesView = rules;
                applyMatchRulesView(loop.match!, rules);
              },
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
          stopAttackRangePreview();
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
          stopAttackRangePreview();
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
        if (showsAttackRangeOnPlace(typeId)) {
          attackRangePreview = enableAttackRangePlacement({
            domElement: sceneContext.renderer.domElement,
            camera: sceneContext.camera,
            groundPlane: sceneContext.groundPlane,
            scene: sceneContext.scene,
            radius: attackReachPreviewRadius(typeId),
          });
        }
      },
      onDragMove: (typeId, clientX, clientY) => {
        if (isFuseBombTypeId(typeId)) aoePreview?.syncPointer(clientX, clientY);
        if (isArcherTowerId(typeId)) soloBuildingPreview?.syncPointer(clientX, clientY);
        attackRangePreview?.syncPointer(clientX, clientY);
      },
      onDragEnd: () => {
        stopPlaceableHighlight();
        stopAoePreview();
        stopAttackRangePreview();
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
  let replaySaved = false;
  const peerLeft = versusPeerLeft;
  versusPeerLeft = false;
  reconnectBanner = createReconnectBanner(hud);
  battleResult.setReturnLabel('返回房间');

  const recordVersusResult = (result: MatchResult, faction: Faction, context?: ReplaySideContext): void => {
    if (battleRecorded) return;
    battleRecorded = true;
    recordLocalBattle(result, faction, 'versus');
    if (replaySaved || !context) return;
    replaySaved = true;
    persistVersusReplay(match.loop, result, context);
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
      onOfficialResult: (result, context) => recordVersusResult(result, localFaction, context),
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
    onOfficialResult: (result: MatchResult, context: ReplaySideContext) => void;
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
  versusExitConfirm.hide();
  battleAnnounce.reset();
  battleHud.setSpectatorCount(0);
  battleHud.setCatchingUp(false);
  const localSlot = netLoop.seat;
  const matchMode = netLoop.match.mode;
  applyArenaPreset(matchMode);
  const mate = teammateSlot(localSlot, matchMode);
  const oppSlots = teamSlots(opposingFaction(faction), matchMode);
  const members = latestRoomState?.members ?? [];
  const memberName = (slot: number | null | undefined, fallback: string): string =>
    slot == null ? fallback : (members.find((entry) => entry.seat === slot)?.name ?? fallback);
  const hudContext = {
    localFaction: faction,
    localSlot,
    localName: names.localName,
    opponentName: memberName(oppSlots[0], names.opponentName),
    opponentSlot: oppSlots[0],
    teammateSlot: mate,
    teammateName: mate == null ? undefined : memberName(mate, '队友'),
    extraOpponentSlot: oppSlots[1] ?? null,
    extraOpponentName: oppSlots[1] == null ? undefined : memberName(oppSlots[1], '对手'),
  };
  battleHud.setContext(hudContext);
  battleResult.setContext(hudContext);
  battleHud.show();

  const recorder = new ReplayRecorder();
  netLoop.setOnFrameApplied((tick, commands) => recorder.record(tick, commands));

  const sceneContext = ensureBattleScene('solo', faction);
  sceneContext.resize();
  const battleView = sharedBattleView!;
  battleView.reset();
  battleView.setLocalFaction(faction);
  battleView.setLocalSlot(localSlot);
  let dealFromCastle = false;
  let prevPackState = netLoop.match.getSlotCastlePackState(localSlot);
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
      const command = claimCastlePackCommand(faction, localSlot);
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
  let attackRangePreview: AttackRangePlacementHandle | null = null;
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

  /** 清除连弩车/投弹车拖拽时的攻击范围圈。 */
  const stopAttackRangePreview = (): void => {
    attackRangePreview?.dispose();
    attackRangePreview = null;
  };

  /** 显示本地阵营白色部署区；含射程预览兵种时再叠白圈。 */
  const startPlaceableHighlight = (formation?: CardFormation): void => {
    stopPlaceableHighlight();
    stopAttackRangePreview();
    placeableHighlight = showPlaceableHighlight(sceneContext.scene, collectHalfCourtPlaceableCells(faction));
    const radius = formation ? formationAttackRangePreviewRadius(formation) : null;
    if (radius == null) return;
    attackRangePreview = enableAttackRangePlacement({
      domElement: sceneContext.renderer.domElement,
      camera: sceneContext.camera,
      groundPlane: sceneContext.groundPlane,
      scene: sceneContext.scene,
      radius,
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
      : halfCourtSafeAnchor(formation, faction, halfCourtSlotAnchorX(matchMode, localSlot));
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
        : halfCourtSafeAnchor(request.formation, faction, halfCourtSlotAnchorX(matchMode, localSlot));
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
      localSlot,
    );
    if (!netLoop.match.validate(cmd)) return false;
    netLoop.sendInput([cmd]);
    return true;
  };

  const handPanel = createHandPanel({
    deck: netLoop.match.decks[localSlot],
    externalDraw: true,
    externalCardConsume: true,
    getDrawRemainingMs: () => (netLoop.match.getTicksUntilDraw(localSlot) * 1000) / TICK_RATE,
    getDrawIntervalMs: () => (netLoop.match.getDrawIntervalTicksForSlot(localSlot) * 1000) / TICK_RATE,
    getMaxHandSize: () => netLoop.match.getMaxHandSize(),
    getHasPendingDraw: () => netLoop.match.hasPendingDraw(localSlot),
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
    onPlaceableHighlightMove: (clientX, clientY) => attackRangePreview?.syncPointer(clientX, clientY),
    onPlaceableHighlightEnd: () => {
      stopPlaceableHighlight();
      stopAttackRangePreview();
    },
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

  const leaveBattle = (): void => {
    sceneConfigPage.hide();
    versusExitConfirm.hide();
    keepRoomSession = false;
    screens.show('online');
  };
  /** 对局未结束时先确认，避免误点返回直接记失败。 */
  const requestLeave = (): void => {
    if (
      !shouldConfirmVersusLeave({
        versus: true,
        spectating: false,
        matchEnded: Boolean(netLoop.match.result),
      })
    ) {
      leaveBattle();
      return;
    }
    versusExitConfirm.show(leaveBattle);
  };
  backButton.addEventListener('click', requestLeave);

  let lastFrameAt = performance.now();
  let smoothedFps = 60;
  let animationFrameId = 0;
  let lastHandSyncTick = netLoop.world.tick;
  let resultShown = false;
  let selfEliminated = netLoop.match.isSlotEliminated(localSlot);
  let mateEliminated = mate != null && netLoop.match.isSlotEliminated(mate);

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    smoothedFps += (1000 / Math.max(deltaMs, 1) - smoothedFps) * 0.08;

    netLoop.advance(deltaMs);
    const nowEliminated = netLoop.match.isSlotEliminated(localSlot);
    if (nowEliminated && !selfEliminated) {
      battleAnnounce.show(BASE_DOWN_ANNOUNCE);
    }
    selfEliminated = nowEliminated;
    if (mate != null) {
      const mateDown = netLoop.match.isSlotEliminated(mate);
      if (mateDown && !mateEliminated) battleAnnounce.show(TEAMMATE_DOWN_ANNOUNCE);
      mateEliminated = mateDown;
    }
    const packState = netLoop.match.getSlotCastlePackState(localSlot);
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
      accountHooks.onOfficialResult(netLoop.match.result, hudContext);
      versusExitConfirm.hide();
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
    if (netLoop.match.result) accountHooks.onOfficialResult(netLoop.match.result, hudContext);
    else accountHooks.onLeaveWithoutResult();
    netLoop.setOnFrameApplied(undefined);
    hud.classList.add('is-hidden');
    battleHud.hide();
    battleAnnounce.reset();
    battleResult.hide();
    versusExitConfirm.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-versus');
    container.classList.remove('is-solo', 'is-versus');
    backButton.removeEventListener('click', requestLeave);
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

/** 观战只读循环：复用战场渲染，不创建手牌/出牌交互。 */
function enterReplay(): () => void {
  const record = pendingReplay;
  pendingReplay = null;
  if (!record) {
    queueMicrotask(() => screens.show('replay-list'));
    return () => {};
  }
  return runReplaySession(record);
}

/** 回放只读循环：复用观战渲染，数据源换成本地 ReplayLoop。 */
function runReplaySession(record: ReplayRecord): () => void {
  replaySessionActive = true;
  mainMenu.hide();
  container.classList.add('is-solo', 'is-versus', 'is-replay');
  hud.classList.add('is-solo', 'is-versus', 'is-replay');
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');
  battleResult.hide();
  versusExitConfirm.hide();
  battleAnnounce.reset();
  battleResult.setReturnLabel('返回列表');
  battleHud.setSpectatorCount(0);
  battleHud.setCatchingUp(false);
  battleHud.setContext(record.context);
  battleResult.setContext(record.context);
  spectatorHands.setNames(replayHandNames(record.context));
  spectatorHands.show();
  battleHud.show();

  applyArenaPreset(record.matchMode);
  const replayLoop = new ReplayLoop(record, {
    onMismatch: (actual, expected) => {
      console.warn('[replay] 回放结算与录像不一致', { actual, expected });
    },
  });
  const sceneContext = ensureBattleScene('solo', record.context.localFaction);
  sceneContext.resize();
  const battleView = sharedBattleView!;
  battleView.reset();
  battleView.setLocalFaction(record.context.localFaction);
  battleView.setLocalSlot(record.context.localSlot ?? record.context.localFaction);
  const disableUnitSelection = enableUnitSelection({
    domElement: sceneContext.renderer.domElement,
    camera: sceneContext.camera,
    groundPlane: sceneContext.groundPlane,
    pickUnit: (simX, simY) => battleView.pickUnitAtSim(simX, simY),
    onSelect: (unitId) => battleView.selectUnit(unitId),
  });

  const replayControls = createReplayControls({
    onTogglePause: () => {
      replayLoop.setPaused(!replayLoop.isPaused);
      replayControls.setPaused(replayLoop.isPaused);
    },
    onSetSpeed: (speed) => {
      replayLoop.setSpeed(speed);
      replayControls.setSpeed(speed);
    },
    onRestart: () => {
      replayLoop.restart();
      resultShown = false;
      battleResult.hide();
      battleAnnounce.reset();
      replayControls.setPaused(replayLoop.isPaused);
      replayControls.setProgress(replayLoop.tick, record.endTick);
    },
  });
  replayControls.setPaused(false);
  replayControls.setSpeed(1);
  replayControls.setProgress(0, record.endTick);
  replayControls.show();

  const returnToList = (): void => {
    screens.show('replay-list');
  };
  backButton.addEventListener('click', returnToList);

  let lastFrameAt = performance.now();
  let animationFrameId = 0;
  let lastHandSyncTick = -1;
  let resultShown = false;

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    replayLoop.advance(deltaMs);
    battleView.syncCastlePack(replayLoop.match, sceneContext.camera);
    if (replayLoop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = replayLoop.world.tick;
      spectatorHands.update(replayLoop.match);
      replayControls.setProgress(replayLoop.tick, record.endTick);
    }
    battleHud.update(replayLoop.match);
    battleAnnounce.tick(replayLoop.match);
    if (replayLoop.match.result && !resultShown) {
      resultShown = true;
      battleResult.show(replayLoop.match.result, record.context.localFaction, replayLoop.match);
    }
    battleView.render(replayLoop.prev, replayLoop.curr, replayLoop.alpha, sceneContext.camera);
    sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
    animationFrameId = requestAnimationFrame(frame);
  };
  animationFrameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(animationFrameId);
    replaySessionActive = false;
    hud.classList.add('is-hidden');
    battleHud.hide();
    battleHud.setCatchingUp(false);
    spectatorHands.hide();
    battleAnnounce.reset();
    battleResult.hide();
    replayControls.hide();
    replayControls.dispose();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-versus', 'is-replay');
    container.classList.remove('is-solo', 'is-versus', 'is-replay');
    backButton.removeEventListener('click', returnToList);
    disableUnitSelection();
    battleView.reset();
  };
}

/** 回放手牌按席位拆名，2v2 同队两人各占一栏。 */
function replayHandNames(context: ReplaySideContext): SpectatorHandNames {
  const localIsBlue = context.localFaction === Faction.Blue;
  const self = { name: context.localName, mate: context.teammateName };
  const opp = { name: context.opponentName, mate: context.extraOpponentName };
  const blue = localIsBlue ? self : opp;
  const red = localIsBlue ? opp : self;
  return {
    blue: blue.name,
    blueMate: blue.mate,
    red: red.name,
    redMate: red.mate,
  };
}

function enterSpectate(): () => void {
  const match = pendingSpectate;
  pendingSpectate = null;
  if (!match) {
    queueMicrotask(() => screens.show('online'));
    return () => {};
  }
  return runSpectateSession(match.loop, match.blueName, match.redName);
}

function runSpectateSession(
  netLoop: import('./net/netLoop.js').NetSimLoop,
  blueName: string,
  redName: string,
): () => void {
  mainMenu.hide();
  container.classList.add('is-solo', 'is-versus', 'is-spectate');
  hud.classList.add('is-solo', 'is-versus', 'is-spectate');
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');
  battleResult.hide();
  versusExitConfirm.hide();
  battleAnnounce.reset();
  battleResult.setReturnLabel('返回大厅');
  const matchMode = netLoop.match.mode;
  const members = latestRoomState?.members ?? [];
  const memberName = (slot: number | undefined, fallback: string): string =>
    slot == null ? fallback : (members.find((entry) => entry.seat === slot)?.name ?? fallback);
  const blueSlots = teamSlots(Faction.Blue, matchMode);
  const redSlots = teamSlots(Faction.Red, matchMode);
  const spectateContext = {
    localFaction: Faction.Blue,
    localSlot: blueSlots[0],
    localName: memberName(blueSlots[0], blueName || '蓝方'),
    opponentName: memberName(redSlots[0], redName || '红方'),
    opponentSlot: redSlots[0],
    teammateSlot: blueSlots[1] ?? null,
    teammateName: blueSlots[1] == null ? undefined : memberName(blueSlots[1], '蓝方2'),
    extraOpponentSlot: redSlots[1] ?? null,
    extraOpponentName: redSlots[1] == null ? undefined : memberName(redSlots[1], '红方2'),
  };
  battleHud.setContext(spectateContext);
  battleResult.setContext(spectateContext);
  spectatorHands.setNames({
    blue: spectateContext.localName,
    blueMate: spectateContext.teammateName,
    red: spectateContext.opponentName,
    redMate: spectateContext.extraOpponentName,
  });
  spectatorHands.show();
  battleHud.setCatchingUp(netLoop.pendingTicks > 0);
  battleHud.show();

  applyArenaPreset(netLoop.match.mode);
  const sceneContext = ensureBattleScene('solo', Faction.Blue);
  sceneContext.resize();
  const battleView = sharedBattleView!;
  battleView.reset();
  battleView.setLocalFaction(Faction.Blue);
  battleView.setLocalSlot(0);
  const disableUnitSelection = enableUnitSelection({
    domElement: sceneContext.renderer.domElement,
    camera: sceneContext.camera,
    groundPlane: sceneContext.groundPlane,
    pickUnit: (simX, simY) => battleView.pickUnitAtSim(simX, simY),
    onSelect: (unitId) => battleView.selectUnit(unitId),
  });

  const returnToLobby = (): void => {
    screens.show('online');
  };
  backButton.addEventListener('click', returnToLobby);

  let lastFrameAt = performance.now();
  let animationFrameId = 0;
  let lastHandSyncTick = -1;
  let resultShown = false;

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    netLoop.advance(deltaMs);
    battleHud.setCatchingUp(netLoop.pendingTicks > 0);
    battleView.syncCastlePack(netLoop.match, sceneContext.camera);
    if (netLoop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = netLoop.world.tick;
      spectatorHands.update(netLoop.match);
    }
    battleHud.update(netLoop.match);
    battleAnnounce.tick(netLoop.match);
    if (netLoop.match.result && !resultShown) {
      resultShown = true;
      spectateMatchEnded = true;
      battleResult.show(netLoop.match.result, Faction.Blue, netLoop.match);
    }
    battleView.render(netLoop.prev, netLoop.curr, netLoop.alpha, sceneContext.camera);
    sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
    animationFrameId = requestAnimationFrame(frame);
  };
  animationFrameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(animationFrameId);
    hud.classList.add('is-hidden');
    battleHud.hide();
    battleHud.setCatchingUp(false);
    spectatorHands.hide();
    battleAnnounce.reset();
    battleResult.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-versus', 'is-spectate');
    container.classList.remove('is-solo', 'is-versus', 'is-spectate');
    backButton.removeEventListener('click', returnToLobby);
    disableUnitSelection();
    battleView.reset();
    disposeSpectateSession();
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
    if (!activeSpectateSession && !pendingSpectate) {
      joiningSpectate?.close();
      joiningSpectate = null;
    }
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
  'special-tiers': () => {
    syncLobbyPresenceForScreen('special-tiers');
    specialTierPage.show();
    return () => specialTierPage.hide();
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
  leaderboard: () => {
    syncLobbyPresenceForScreen('leaderboard');
    leaderboardPage.show();
    return () => leaderboardPage.hide();
  },
  'replay-list': () => {
    syncLobbyPresenceForScreen('replay-list');
    replayListPage.show();
    return () => replayListPage.hide();
  },
  replay: () => {
    syncLobbyPresenceForScreen('replay');
    return enterReplay();
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
  spectate: () => {
    syncLobbyPresenceForScreen('spectate');
    return enterSpectate();
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
  disposeSpectateSession();
  spectatorHands.dispose();
  onlineLobbyPage.dispose();
  leaderboardPage.dispose();
  replayListPage.dispose();
  onlineRoomPage.dispose();
  mainMenu.dispose();
  deckConfigPage.dispose();
  specialTierPage.dispose();
  handOddsPage.dispose();
  unitStatsPage.dispose();
  sceneConfigPage.dispose();
  codexPage.dispose();
}

window.addEventListener('pagehide', disposeApp, { once: true });

/** 联机正式结算后落一条可回放录像；失败不影响对局流程。 */
function persistVersusReplay(
  loop: NetSimLoop,
  result: MatchResult,
  context: ReplaySideContext,
): void {
  try {
    const frames = loop.getAppliedFrames();
    replayStore.save({
      seed: loop.match.world.seed,
      matchMode: loop.match.mode,
      endTick: result.endTick,
      result: { winner: result.winner, reason: result.reason },
      context: { ...context },
      frames,
      arenaSignature: createArenaSignature(loop.match.mode),
    });
  } catch (error) {
    console.warn('[replay] 录像保存失败', error);
  }
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
