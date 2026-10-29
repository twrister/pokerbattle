import {
  applyArenaPreset,
  Faction,
  opposingFaction,
  CAMPAIGN_STAGES,
  advanceWave,
  applyBoon,
  applyEndlessWaveSeconds,
  buildWaveStage,
  countLivingMobileUnits,
  createRun,
  collectSurvivors,
  defaultEndlessWaveSeconds,
  endlessWaveSpawnProgress,
  isBossWave,
  sanitizeRun,
  rollBoonChoices,
  type EndlessRunState,
  getNextStage,
  getStageById,
  SoloBotController,
  STAGE_FAIL_REASON_TEXT,
  StageRunner,
  teammateSlot,
  teamSlots,
  TICK_RATE,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type CardFormation,
  type MatchResult,
  type StageDef,
  type StageOutcome,
  type StagePresetUnit,
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
  normalizeDeployAnchor,
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
import { sfx } from './audio/sfx.js';
import { bindGlobalUiSfx } from './audio/uiSfx.js';
import { createSfxToggle } from './ui/sfxToggle.js';
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
import { createRejoinTicketStore } from './net/rejoinStore.js';
import { createHandPanel, type FormationSpawnRequest } from './ui/handPanel.js';
import { enableDebugUnitDrag } from './ui/debugUnitDrag.js';
import {
  BASE_DOWN_ANNOUNCE,
  createBattleAnnounce,
  TEAMMATE_DOWN_ANNOUNCE,
} from './ui/battleAnnounce.js';
import { createBattleHud } from './ui/battleHud.js';
import { createBattleDamagePanel } from './ui/battleDamagePanel.js';
import { createBattleResult } from './ui/battleResult.js';
import { createCampaignProgressStore } from './campaign/progress.js';
import { createCampaignPage } from './ui/campaignPage.js';
import { createEndlessProgressStore } from './campaign/endlessProgress.js';
import { createBoonPickPanel } from './ui/boonPickPanel.js';
import { createStageHud } from './ui/stageHud.js';
import { createEndlessStatsPanel } from './ui/endlessStatsPanel.js';
import { shouldShowHandGuide } from './ui/handGuide.js';
import { createVersusExitConfirm } from './ui/versusExitConfirm.js';
import { createPauseConfirm } from './ui/pauseConfirm.js';
import { createRejoinDialog } from './ui/rejoinDialog.js';
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
import { createQuickMatchDialog } from './ui/quickMatchDialog.js';
import { createReconnectBanner } from './ui/reconnectBanner.js';
import { createScreenController, type AppScreen, type ScreenController } from './ui/screenController.js';
import { createSceneConfigPage } from './ui/sceneConfigPage.js';
import { createSfxConfigPage } from './ui/sfxConfigPage.js';
import { createUnitStatsPage } from './ui/unitStatsPage.js';
import { createEndlessConfigPage } from './ui/endlessConfigPage.js';
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

/**
 * 战役结算延迟（毫秒）：目标落定后先让战场演完最后一击/清场动画，再停局弹结算。
 * 太久会让玩家以为卡住，1 秒刚好看得见结果又不拖节奏。
 */
const STAGE_RESULT_DELAY_MS = 1000;

const container = requiredElement<HTMLElement>('#app');
const hud = requiredElement<HTMLElement>('#hud');
const backButton = requiredElement<HTMLButtonElement>('#btn-back-menu');

// 音效：预加载全部短音资源，首次交互时解锁 AudioContext，再挂全局按钮点击音
sfx.attachUnlock();
sfx.preloadAll();
bindGlobalUiSfx(document);
// 局内音效开关：单机/联机在暂停弹窗里，回放/观战没有暂停框，只在 HUD 上放图标钮；
// 与大厅设置弹层共用 sfx 状态，靠订阅互相同步
createSfxToggle({
  buttons: [
    document.querySelector<HTMLButtonElement>('#btn-battle-sfx-toggle'),
    document.querySelector<HTMLButtonElement>('#btn-pause-sfx-toggle'),
  ].filter((button): button is HTMLButtonElement => Boolean(button)),
});

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
/** 战役选中的关卡；非 null 时单机局按关卡规则开打，进入普通人机前必须清空。 */
let selectedStage: StageDef | null = null;
/** 战役进度（本地存储）。 */
const campaignProgress = createCampaignProgressStore();
/** 无限防守存档（进行中的挑战 + 最佳成绩）。 */
const endlessProgress = createEndlessProgressStore();
/** 正在进行的无限防守挑战；非 null 时 selectedStage 是由它生成的波次关卡。 */
let endlessRun: EndlessRunState | null = null;
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
/** 局外重连凭据：把 roomId + token 落盘，页面刷新或回大厅后仍能自救。 */
const rejoinTickets = createRejoinTicketStore();
/** 局外重连窗；同一时刻只允许一个，避免重复探测弹多窗。 */
let rejoinDialog: ReturnType<typeof createRejoinDialog> | null = null;
/** 正在进行的重连探测，用于阻止并发重复询问。 */
let rejoinProbe: Promise<void> | null = null;
/**
 * 页面正在卸载（刷新/关标签）。
 * 卸载不是玩家主动退出：必须保留局外重连凭据，也不能把本局记成 abandoned。
 */
let appUnloading = false;
/**
 * 已收到开局但会话引用尚未就绪：冷启动接回时 welcome 与补帧可能同批到达，
 * 先记下意图，等 activeRoomSession 落好再跳对局屏。
 */
let versusScreenPending = false;
/**
 * 当前对局来自快速匹配：没有可回的房间页，
 * 结算与异常退出都按单机口径回主界面。
 */
let quickMatchActive = false;
/** 正在等待匹配结果（尚未开局），用于离开主菜单时作废这次匹配。 */
let quickMatchPending = false;

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
    selectedStage = null;
    screens.show('solo');
  },
  onStartSoloDebug: () => {
    if (!IS_DEV_SERVER) return;
    selectedSoloDifficulty = 'hard';
    selectedSoloDebugSpawn = true;
    selectedStage = null;
    screens.show('solo');
  },
  onOpenCampaign: () => screens.show('campaign'),
  onOpenOnline: () => screens.show('online'),
  onQuickMatch: () => beginQuickMatch(),
  onOpenDeckConfig: () => screens.show('deck-config'),
  onOpenCodex: () => screens.show('codex'),
  onOpenLeaderboard: () => screens.show('leaderboard'),
  onOpenReplays: () => screens.show('replay-list'),
  onOpenSfxConfig: () => screens.show('sfx-config'),
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
const endlessConfigPage = createEndlessConfigPage({ onBack: () => screens.show('codex') });
const handOddsPage = createHandOddsPage({
  onBack: () => screens.show('deck-config'),
  onBeforeBalance: () => unitStatsPage.flushPending(),
});
const sceneConfigPage = createSceneConfigPage({ onBack: () => screens.show('codex') });
const sfxConfigPage = createSfxConfigPage({ onBack: () => screens.show('menu') });
const codexPage = createCodexPage({
  onBack: () => screens.show('menu'),
  onOpenUnitStats: () => screens.show('unit-stats'),
  onOpenEndlessConfig: () => screens.show('endless-config'),
  onOpenSceneConfig: () => screens.show('scene-config'),
});
const battleHud = createBattleHud();
const battleDamagePanel = createBattleDamagePanel();
const battleAnnounce = createBattleAnnounce();
const spectatorHands = createSpectatorHands();
const versusExitConfirm = createVersusExitConfirm();
/** 快速匹配等待弹窗；只在主菜单阶段短暂展示。 */
const quickMatchDialog = createQuickMatchDialog();
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
    // 快速匹配局没有「房间」可回，按单机口径直接回主界面
    if (quickMatchActive || activeRoomSession.quickMatch) {
      disposeRoomSession();
      screens.show('menu');
      return;
    }
    keepRoomSession = true;
    screens.show('room');
    return;
  }
  // 战役局结算后回选关页；用后清空，防止下次普通人机误读
  if (selectedStage) {
    selectedStage = null;
    endlessRun = null;
    screens.show('campaign');
    return;
  }
  screens.show('menu');
});
const stageHud = createStageHud();
/** 无限防守的「本局叠加」面板，替代战役目标卡片。 */
const endlessStats = createEndlessStatsPanel();
const campaignPage = createCampaignPage({
  onBack: () => screens.show('menu'),
  onStartStage: (stageId) => {
    const stage = getStageById(stageId);
    if (!stage) return;
    endlessRun = null;
    selectedStage = stage;
    selectedSoloDifficulty = 'hard';
    selectedSoloDebugSpawn = false;
    screens.show('solo');
  },
  getStages: () => CAMPAIGN_STAGES,
  getProgress: () => campaignProgress.load(),
  // 开发服默认解锁全部战役，方便直接验证任意关卡
  unlockAllStages: IS_DEV_SERVER,
  endless: {
    getBestWave: () => endlessProgress.load().best?.bestWave ?? null,
    onStart: () => openEndlessEntry(),
  },
});
const boonPickPanel = createBoonPickPanel();
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

/**
 * 主动离房：关会话并清掉房间快照。
 * @param clearTicket 是否作废局外重连凭据；页面卸载时传 false，否则刷新页面就再也接不回来
 */
function disposeRoomSession(clearTicket = true): void {
  cancelJoiningRoom();
  activeRoomSession?.close();
  activeRoomSession = null;
  latestRoomState = null;
  pendingMatch = null;
  versusScreenPending = false;
  // 主动离开会话即不再有可接回的对局，顺手作废凭据；页面卸载时保留
  if (clearTicket && !appUnloading) rejoinTickets.clear();
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

/** 局外页面：只有这两屏才允许弹重连窗，避免打断单机/回放。 */
function canOfferRejoin(screen: AppScreen | null): boolean {
  return screen === 'menu' || screen === 'online';
}

/** 玩家拒绝重连：通知服务端立刻释放席位并清凭据。 */
function declineRejoinTicket(
  roomId: string,
  token: string,
  /** 玩家主动关闭才记失败；倒计时归零属自然超时，服务端已判负，不重复记。 */
  recordAbandon: boolean,
): void {
  rejoinTickets.clear();
  // 大厅连接可能刚被关掉，重新登记后再发，避免放弃指令发不出去
  ensureAppLobbyPresence('lobby').declineRejoin(roomId, token);
  if (!recordAbandon) return;
  // 关闭弹窗即放弃本局，和局内中途退出口径一致
  try {
    playerProfile.recordBattle({ mode: 'versus', outcome: 'loss', reason: 'abandoned' });
    mainMenu.refreshProfile();
  } catch (error) {
    console.error('[account] 放弃重连记录失败', error);
  }
}

/**
 * 局外检测：本机是否有仍在重连窗口内的对局。
 * 只在大厅允许的页面执行；探测期间切屏或已入房则丢弃本次结果。
 */
function checkPendingRejoin(): void {
  if (rejoinProbe || rejoinDialog?.isOpen()) return;
  const playerId = playerProfile.getProfile().deviceAccountId;
  if (!playerId) return;
  const ticket = rejoinTickets.load(playerId);
  if (!ticket) return;
  if (!canOfferRejoin(screens.current)) return;
  rejoinProbe = (async () => {
    try {
      const status = await ensureAppLobbyPresence('lobby').checkRejoin(ticket.roomId, ticket.token);
      // 房间已关/已结算/席位被占：凭据作废，安静清掉
      if (!status.alive) {
        rejoinTickets.clear();
        return;
      }
      // 结果回来时页面可能已变，或已自行入房，则不再打扰
      if (!canOfferRejoin(screens.current) || activeRoomSession || joiningRoom) return;
      if (rejoinDialog?.isOpen()) return;
      rejoinDialog = rejoinDialog ?? createRejoinDialog();
      rejoinDialog.show(
        {
          roomId: status.roomId || ticket.roomId,
          roomName: status.roomName ?? '',
          opponentName: status.opponentName ?? '',
          remainingMs: status.remainingMs ?? 0,
        },
        {
          onAccept: () => beginRejoinMatch(status.roomId || ticket.roomId, ticket.token),
          onDecline: (reason) =>
            declineRejoinTicket(ticket.roomId, ticket.token, reason === 'user'),
        },
      );
    } catch {
      // 服务端不可达时不打扰玩家，留到下次进大厅再查
    } finally {
      rejoinProbe = null;
    }
  })();
}

/** 创建或加入房间，成功后进入房间页。 */
function beginJoinRoom(request: RoomJoinRequest): void {
  startRoomSession(
    {
      mode: request.mode,
      roomId: request.roomId,
      roomName: request.roomName,
      matchMode: request.matchMode,
    },
    false,
  );
}

/**
 * 异常离开对局后的落点：匹配局没有房间页，直接回主界面；
 * 其余情况回联机大厅，并顺带展示离开原因。
 */
function leaveToLobby(quickMatch: boolean, message: string): void {
  if (quickMatch) {
    screens.show('menu');
    return;
  }
  onlineLobbyPage.showError(message);
  screens.show('online');
}

/**
 * 快速匹配：入房后停在主菜单并显示等待弹窗，
 * 由服务端凑满人数自动开局，不需要玩家再点开始。
 */
function beginQuickMatch(): void {
  // 重复点快速匹配时先清掉上一次的候选连接，避免两个连接争同一局
  cancelQuickMatch();
  quickMatchPending = true;
  quickMatchDialog.show(cancelQuickMatch);
  startRoomSession({ mode: 'quick' }, false);
}

/**
 * 取消匹配：断开候选连接并收起等待弹窗。
 * 玩家主动取消与切屏离开共用这一条路径，避免残留连接被自动开局拉走。
 */
function cancelQuickMatch(): void {
  if (!quickMatchPending) return;
  quickMatchPending = false;
  quickMatchDialog.hide();
  cancelJoiningRoom();
  disposeRoomSession();
  // 取消后仍停在主菜单，重新登记大厅 presence，否则运维站会以为人已离线
  ensureAppLobbyPresence(lobbyActivityForScreen(screens.current));
}


/**
 * 接回局外那局：凭本机存档的令牌直接 rejoin，
 * 成功即进对局屏，失败则清凭据并回大厅提示。
 */
function beginRejoinMatch(roomId: string, token: string): void {
  startRoomSession({ mode: 'room', roomId }, true, token);
}

/**
 * 建房间会话的统一入口：join 与 rejoin 共用断线/结算回调，
 * 差别只在首个包与成功后跳哪一屏。
 * @param coldRejoin 是否从局外凭令牌接回（成功后直接进对局，不回房间页）
 */
function startRoomSession(
  request: RoomJoinRequest,
  coldRejoin: boolean,
  rejoinToken = '',
): void {
  cancelJoiningRoom();
  stopAppLobbyPresence();
  /** 快速匹配没有房间页，状态与错误都就近显示在等待弹窗上。 */
  const quickMode = request.mode === 'quick';
  if (!coldRejoin && !quickMode) {
    onlineLobbyPage.showError(
      request.mode === 'create' ? '正在创建房间…' : `正在加入房间 ${request.roomId ?? ''}…`,
    );
  }
  const deviceId = playerProfile.getProfile().deviceAccountId;
  const connecting = connectRoomSession({
    name: playerProfile.getProfile().displayName,
    playerId: deviceId,
    mode: request.mode,
    roomId: request.roomId,
    roomName: request.roomName,
    matchMode: request.matchMode,
    ...(coldRejoin ? { intent: 'rejoin' as const, rejoinToken } : {}),
    onStatus: (text) => {
      if (coldRejoin) rejoinDialog?.setBusy(text);
      else if (quickMode) quickMatchDialog.setStatus(text);
      else if (screens.current === 'online') onlineLobbyPage.showError(text);
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
      // 匹配成功即收起等待弹窗并结束「等待中」状态，否则切到对局屏会把自己取消掉
      quickMatchPending = false;
      quickMatchDialog.hide();
      rejoinDialog?.hide();
      // 会话引用还没落好时先挂起，由 startRoomSession 的 then 补跳，避免 enterVersus 误判无会话
      if (!activeRoomSession) {
        versusScreenPending = true;
        return;
      }
      // 败方可能还停在结算屏；重复 show('versus') 会被忽略，上一局 playLocked / 旧 loop 会留下。
      screens.show('versus', { remount: screens.current === 'versus' });
    },
    onSpectatorCount: (count) => {
      battleHud.setSpectatorCount(count);
    },
    onRejoinTicket: (ticketRoomId, ticketToken) => {
      // 真正开局才落凭据：只有这时候重连才有意义，也避免等待期误弹窗
      rejoinTickets.save({ playerId: deviceId, roomId: ticketRoomId, token: ticketToken });
    },
    onMatchEnd: () => {
      // 结算展示与记账由对局循环处理，避免重复写入档案
      rejoinTickets.clear();
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
      rejoinTickets.clear();
      const wasQuick = quickMatchActive || quickMode;
      quickMatchActive = false;
      disposeRoomSession();
      leaveToLobby(wasQuick, '对手已离开');
    },
    onDisconnected: (reason) => {
      keepRoomSession = false;
      const wasQuick = quickMatchActive || quickMode;
      quickMatchActive = false;
      disposeRoomSession();
      leaveToLobby(wasQuick, reason);
    },
    onReconnectFailed: (reason) => {
      keepRoomSession = false;
      // 席位窗口已关，凭据自然作废
      rejoinTickets.clear();
      const wasQuick = quickMatchActive || quickMode;
      quickMatchActive = false;
      disposeRoomSession();
      leaveToLobby(wasQuick, reason);
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
      // 冷启动接回时对局屏由 onMatchStart 负责；若它早于会话就绪，这里补跳
      if (versusScreenPending) {
        versusScreenPending = false;
        screens.show('versus', { remount: screens.current === 'versus' });
        return;
      }
      // 匹配房入座后仍停在主菜单等自动开局，不跳没有意义的房间页
      if (quickMode) return;
      if (!coldRejoin) screens.show('room');
    })
    .catch((error: unknown) => {
      if (joiningRoom !== connecting) return;
      joiningRoom = null;
      versusScreenPending = false;
      const message = error instanceof Error ? error.message : String(error);
      // 匹配失败：收起等待弹窗，让玩家留在主界面看到原因
      if (quickMode) {
        quickMatchPending = false;
        quickMatchDialog.hide();
        ensureAppLobbyPresence('lobby');
        mainMenu.showStatus(message);
        return;
      }
      if (coldRejoin) {
        // 令牌已失效（房间结束/席位被占），丢掉存档并让玩家留在大厅
        rejoinTickets.clear();
        rejoinDialog?.hide();
        ensureAppLobbyPresence('lobby');
        onlineLobbyPage.showError(message);
        return;
      }
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
  // 战役关卡：仅单机且非调试模式；本局期间不再读 selectedStage，避免重开串关
  const stageDef: StageDef | null = isSolo && !debugSpawn ? selectedStage : null;

  container.classList.toggle('is-solo', isSolo);
  hud.classList.toggle('is-solo', isSolo);
  hud.classList.toggle('is-solo-debug', debugSpawn);
  container.classList.remove('is-hidden');
  hud.classList.remove('is-hidden');
  if (isSolo) {
    battleResult.setReturnLabel('返回主界面');
    battleResult.hide();
    battleAnnounce.reset();
    // 战役只有一段常规阶段，常规阶段末尾也读 10 秒
    if (stageDef) {
      // 无限防守没有时限：不读秒，开场只提示守住基地
      if (isEndlessStage(stageDef)) {
        battleAnnounce.setCountdownSeconds('normal', 0);
        battleAnnounce.setEnterText('normal', '守住基地');
      } else {
        battleAnnounce.setCountdownSeconds('normal', 10);
        // 无基地关卡没有城堡可拆，去掉默认的「摧毁对方城堡」开场播报
        if (stageDef.castles === false) battleAnnounce.setEnterText('normal', '');
        // 无限防守敌方没有主堡，开场改成守家提示
        else if (stageDef.enemyCastles === false) battleAnnounce.setEnterText('normal', '守住基地');
      }
    }
    battleHud.setContext({
      localFaction: Faction.Blue,
      localName: playerProfile.getProfile().displayName,
      opponentName: '电脑',
    });
    // 无基地关卡没有血量可看，整块血条收起，只留中间的阶段与计时
    battleHud.setCastleBarsVisible(stageDef ? stageDef.castles !== false : true);
    battleDamagePanel.setContext({
      localName: playerProfile.getProfile().displayName,
    });
    battleResult.setContext({
      localName: playerProfile.getProfile().displayName,
      opponentName: '电脑',
    });
    battleHud.show();
    battleDamagePanel.show();
  }

  const sceneContext = ensureBattleScene(mode, Faction.Blue);
  sceneContext.resize();

  const battleView = sharedBattleView!;
  battleView.reset();
  battleView.setLocalFaction(Faction.Blue);
  battleView.setLocalSlot(Faction.Blue);

  // 单机走 MatchState，与联机共用出牌/抽牌规则，避免双路径漂移
  // 每局随机 seed（对齐服务端 room.ts），避免开局手牌永远相同
  const battleSeed = stageDef ? stageDef.seed : isSolo ? createBattleSeed() : 20260806;
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
  // 关卡局由 StageRunner 提供敌方行为与目标判定，不再挂默认人机
  let stageRunner = stageDef ? new StageRunner(stageDef, loop.match!) : null;
  const soloBot = isSolo && !stageDef ? new SoloBotController(selectedSoloDifficulty, battleSeed) : null;
  const removeSoloBot = stageDef
    ? loop.addCommandSource((match) => (match && stageRunner ? stageRunner.decide(match) : null))
    : soloBot
      ? loop.addCommandSource((match) => (match ? soloBot.decide(match) : null))
      : () => {};
  /** 无限防守：顶部只显示波次与出兵进度，右上角显示本局叠加。 */
  const endlessWaveInfo = stageDef && isEndlessStage(stageDef) && endlessRun
    ? { wave: endlessRun.wave, boss: isBossWave(endlessRun.wave) }
    : null;
  /** 出兵结束时刻（秒），进度条推到它就满格；没有清场目标时为 0。 */
  const endlessSpawnEndSeconds = stageDef
    ? (stageDef.objectives.find((objective) => objective.kind === 'clear_wave')?.spawnEndSeconds ?? 0)
    : 0;
  battleHud.setEndlessMode(endlessWaveInfo);
  /** 按当前 tick 刷新出兵进度与剩余敌人数。 */
  const syncEndlessProgress = (): void => {
    const match = loop.match;
    if (!endlessWaveInfo || !match) return;
    const elapsedSeconds = match.world.tick / TICK_RATE;
    battleHud.updateEndlessProgress({
      ratio: endlessWaveSpawnProgress(endlessSpawnEndSeconds, elapsedSeconds),
      spawnDone: elapsedSeconds >= endlessSpawnEndSeconds,
      remaining: countLivingMobileUnits(match, Faction.Red),
    });
  };
  if (stageDef) {
    // 无限防守用「本局叠加」替代目标卡片，其余关卡仍看通关条件
    if (endlessWaveInfo && endlessRun) {
      stageHud.hide();
      endlessStats.show(endlessRun);
    } else {
      endlessStats.hide();
      stageHud.start();
    }
    // 战役地图在 StageRunner 里才换上，场景要按新河桥/障碍重建一次
    if (stageDef.arena) sceneContext.rebuildArena();
    // 套完关卡规则与预置单位后重拍首帧快照
    loop.curr = takeSnapshot(loop.world, loop.curr);
    loop.prev = takeSnapshot(loop.world, loop.prev);
  }

  let disableUnitPlacement = (): void => {};
  let disableBuildingPlacementFn = (): void => {};
  let disableDebugUnitDrag = (): void => {};
  let dealFromCastle = false;
  let prevPackState = loop.match?.getCastlePackState(Faction.Blue) ?? 'none';
  // 结算状态要在 clearBattlefield 之前声明：重开与首帧都会读写这几个字段
  let resultShown = false;
  /** 关卡结果已落定但还在等演出结束；null 表示尚未落定。 */
  let pendingStageOutcome: StageOutcome | null = null;
  /** 结果落定的时间戳（performance.now），用来算满 1 秒延迟。 */
  let pendingStageOutcomeAt = 0;
  /** 结果落定后是否已等满延迟。 */
  const isResultDelayElapsed = (now: number): boolean =>
    pendingStageOutcomeAt > 0 && now - pendingStageOutcomeAt >= STAGE_RESULT_DELAY_MS;
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
          if (!match.validate(command)) {
            // 校验不过通常是半场未到，给一声拒绝音解释「点了没反应」
            sfx.play('ui_error');
            return;
          }
          sfx.play('pack_open');
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

  /** 显示蓝方半场蓝色部署区；含射程预览兵种时再叠白圈。 */
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
    return normalizeDeployAnchor(anchor.x, anchor.y, Faction.Blue) !== null;
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
      if (isFuseBombFormation(request.formation)) {
        anchorX = anchor.x;
        anchorY = anchor.y;
      } else {
        const normalized = normalizeDeployAnchor(anchor.x, anchor.y, Faction.Blue);
        if (!normalized) return false;
        anchorX = normalized.x;
        anchorY = normalized.y;
      }
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
    return normalizeDeployAnchor(anchor.x, anchor.y, Faction.Blue) !== null;
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
    const normalized = isFuseBombTypeId(typeId)
      ? anchor
      : normalizeDeployAnchor(anchor.x, anchor.y, Faction.Blue);
    if (!normalized) return false;
    loop.enqueue(spawnCommand(Faction.Blue, typeId, fromFloat(normalized.x), fromFloat(normalized.y)));
    return true;
  };

  const handPanel = isSolo && !debugSpawn
    ? createHandPanel({
        deck: loop.match!.decks[Faction.Blue],
        externalDraw: true,
        externalCardConsume: true,
        // 教学段/首次上手才开虚拟手指；后续关卡与老玩家不再打扰
        guideEnabled: shouldShowHandGuide(stageDef, playerProfile.getProfile().stats),
        getDrawRemainingMs: () => (loop.match!.getTicksUntilDraw(Faction.Blue) * 1000) / TICK_RATE,
        getDrawIntervalMs: () => (loop.match!.getDrawIntervalTicks() * 1000) / TICK_RATE,
        getMaxHandSize: () => loop.match!.getMaxHandSizeForSlot(Faction.Blue),
        getHasPendingDraw: () => loop.match!.hasPendingDraw(Faction.Blue),
        getDrawDisabled: () => !loop.match!.isPeriodicDrawEnabled(),
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
    // 重开要把上一局的结算等待一起清掉，否则新一局开局就立刻弹结算
    resultShown = false;
    pendingStageOutcome = null;
    pendingStageOutcomeAt = 0;
    if (isSolo && loop.match) applyMatchRulesView(loop.match, soloMatchRulesView);
    if (stageDef && loop.match) {
      // 重开必须重新套关卡规则/牌池/预置单位，并换新的目标判定器与脚本敌人
      stageRunner = new StageRunner(stageDef, loop.match);
      if (endlessWaveInfo && endlessRun) {
        stageHud.hide();
        endlessStats.show(endlessRun);
      } else {
        endlessStats.hide();
        stageHud.start();
      }
      // 无基地关卡会在这里拆掉刚播种的主堡，必须重拍快照否则会闪一帧基地
      loop.curr = takeSnapshot(loop.world, loop.curr);
      loop.prev = takeSnapshot(loop.world, loop.prev);
    }
    battleView.invalidateUnitViews();
    dealFromCastle = false;
    prevPackState = loop.match?.getCastlePackState(Faction.Blue) ?? 'none';
    // 上一局结算前锁过手牌，重开要放开，否则新一局出不了牌
    handPanel?.setPlayLocked(false);
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
            soloEndlessWaveSeconds: {
              // 续玩时以挑战存档里的窗口为准，避免面板显示与当前波次不一致
              initial: endlessRun?.waveSeconds ?? defaultEndlessWaveSeconds(),
              // 无限关的出兵窗口跟着挑战存档走：改完同步进当前挑战，下一波生效
              onChange: (seconds) => {
                // 只改全局窗口，别把配置页维护的每波覆盖一起冲掉
                applyEndlessWaveSeconds(seconds);
                if (!endlessRun) return;
                endlessRun = sanitizeRun({ ...endlessRun, waveSeconds: seconds });
                endlessProgress.saveRun(endlessRun);
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
    // 战役/无限关的上下文只对当前这局有效，离开时一起清掉，
    // 否则下次普通人机会带着上次的关卡与波次信息
    if (stageDef) {
      selectedStage = null;
      endlessRun = null;
      // 关卡退出去选关页，玩家能立刻看到刚记下的成绩与解锁状态
      screens.show('campaign');
      return;
    }
    screens.show('menu');
  };

  /**
   * 单机/沙盒返回：未结算先暂停并弹确认框。
   *
   * 单机模拟只在本机推进，暂停是安全的；结算已经弹出时返回只是正常离场，
   * 不再多问一次。无限关主动退出等同挑战失败，要先结账再离开。
   */
  const pauseConfirm = createPauseConfirm({
    dialog: versusExitConfirm,
    isResolved: () => resultShown || pendingStageOutcome !== null,
    isPaused: () => loop.paused,
    setPaused: (paused) => {
      loop.paused = paused;
    },
    isEndless: () => Boolean(stageDef && isEndlessStage(stageDef) && endlessRun),
    onEndlessAbandon: () => {
      // 先结账并清掉进行中的存档，免得下次进关卡还能「继续」这条已经失败的路
      if (endlessRun) finishEndlessAsFailed(endlessRun);
    },
    onExit: returnToMenu,
  });
  backButton.addEventListener('click', pauseConfirm.requestExit);

  let lastFrameAt = performance.now();
  let smoothedFps = 60;
  let animationFrameId = 0;
  let lastHandSyncTick = loop.world.tick;

  const frame = (now: number): void => {
    const deltaMs = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    smoothedFps += (1000 / Math.max(deltaMs, 1) - smoothedFps) * 0.08;

    loop.advance(deltaMs);
    if (isSolo && loop.match) {
      const packState = loop.match.getCastlePackState(Faction.Blue);
      if (loop.world.tick !== lastHandSyncTick) {
        dealFromCastle = prevPackState === 'pending' && packState === 'claimed';
        // 卡包真正进手牌的瞬间补一声收牌音，与开包声区分开
        if (dealFromCastle) sfx.play('pack_claim');
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
      battleDamagePanel.update(loop.match!);
      battleAnnounce.tick(loop.match!);
      if (stageDef && stageRunner) {
        stageRunner.update();
        // 无限防守没有目标卡片，改刷顶部波次进度与剩余敌人数
        if (endlessWaveInfo) syncEndlessProgress();
        else stageHud.update(stageRunner.tracker.getProgress(loop.match!));
        const outcome = stageRunner.tracker.getOutcome();
        if (outcome && !resultShown) {
          // 先记下结果并开始计时，让最后一击的弹道与死亡动画演完再弹结算
          if (!pendingStageOutcome) {
            pendingStageOutcome = outcome;
            pendingStageOutcomeAt = now;
            // 结果已锁定，这段等待里继续出牌只会让战场和结算对不上，先收走操作权
            handPanel?.setPlayLocked(true);
          }
          if (isResultDelayElapsed(now)) {
            resultShown = true;
            // 目标落定后冻结对局，避免结算面板出现后战场还在继续打
            loop.paused = true;
            if (endlessRun && isEndlessStage(stageDef)) {
              // 本波残血与存活单位一起交给结算：下一波开局要把阵容原样摆回去
              showEndlessWaveResult(
                endlessRun,
                pendingStageOutcome,
                loop.match!.getCastleHpRatio(Faction.Blue),
                collectSurvivors(loop.match!),
              );
            } else {
              showStageResult(stageDef, pendingStageOutcome);
            }
          }
        }
      } else if (loop.match!.result && !resultShown) {
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
    battleDamagePanel.hide();
    battleAnnounce.reset();
    battleResult.hide();
    stageHud.hide();
    endlessStats.hide();
    container.classList.add('is-hidden');
    hud.classList.remove('is-solo', 'is-solo-debug');
    container.classList.remove('is-solo');
    backButton.removeEventListener('click', pauseConfirm.requestExit);
    // 暂停框可能还开着就切屏了，兜底收掉并恢复推进状态
    versusExitConfirm.hide();
    loop.paused = false;
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
    // 匹配局没有房间页，拿不到会话就退回主界面
    const fallback: AppScreen = quickMatchActive
      ? 'menu'
      : activeRoomSession
        ? 'room'
        : 'online';
    queueMicrotask(() => screens.show(fallback));
    return () => {};
  }

  let leave: (() => void) | null = null;
  let localFaction: Faction = match.faction;
  let matchStarted = true;
  let battleRecorded = false;
  let replaySaved = false;
  const peerLeft = versusPeerLeft;
  versusPeerLeft = false;
  // 本局是否匹配局：决定结算/中途离开后回主界面还是回房间
  const quickMatch = activeRoomSession.quickMatch;
  quickMatchActive = quickMatch;
  reconnectBanner = createReconnectBanner(hud);
  battleResult.setReturnLabel(quickMatch ? '返回主界面' : '返回房间');

  const recordVersusResult = (result: MatchResult, faction: Faction, context?: ReplaySideContext): void => {
    if (battleRecorded) return;
    battleRecorded = true;
    recordLocalBattle(result, faction, 'versus');
    if (replaySaved || !context) return;
    replaySaved = true;
    persistVersusReplay(match.loop, result, context);
  };

  const recordVersusAbandonedIfNeeded = (): void => {
    // 刷新/关标签会走到这里，但玩家并没有放弃对局，记账交给重连结果决定
    if (appUnloading) return;
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
      // 刷新时保留凭据，否则新页面再也接不回这一局
      disposeRoomSession(!appUnloading);
    }
    keepRoomSession = false;
    quickMatchActive = false;
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
  battleDamagePanel.setContext(hudContext);
  battleResult.setContext(hudContext);
  battleHud.setCastleBarsVisible(true);
  battleHud.show();
  battleDamagePanel.show();

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
      if (!netLoop.match.validate(command)) {
        sfx.play('ui_error');
        return;
      }
      sfx.play('pack_open');
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
    return normalizeDeployAnchor(anchor.x, anchor.y, faction) !== null;
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
      if (isFuseBombFormation(request.formation)) {
        anchorX = anchor.x;
        anchorY = anchor.y;
      } else {
        const normalized = normalizeDeployAnchor(anchor.x, anchor.y, faction);
        if (!normalized) return false;
        anchorX = normalized.x;
        anchorY = normalized.y;
      }
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
    getMaxHandSize: () => netLoop.match.getMaxHandSizeForSlot(localSlot),
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
    // 匹配局没有房间页可回，与单机一致回主界面
    screens.show(quickMatchActive ? 'menu' : 'online');
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
      if (dealFromCastle) sfx.play('pack_claim');
      prevPackState = packState;
    }
    battleView.syncCastlePack(netLoop.match, sceneContext.camera);
    if (netLoop.world.tick !== lastHandSyncTick) {
      lastHandSyncTick = netLoop.world.tick;
      handPanel.syncFromDeck();
    }
    handPanel.update(deltaMs);
    battleHud.update(netLoop.match);
    battleDamagePanel.update(netLoop.match);
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
    battleDamagePanel.hide();
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
  battleDamagePanel.setContext(record.context);
  battleResult.setContext(record.context);
  battleHud.setCastleBarsVisible(true);
  spectatorHands.setNames(replayHandNames(record.context));
  spectatorHands.show();
  battleHud.show();
  battleDamagePanel.show();

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
    battleDamagePanel.update(replayLoop.match);
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
    battleDamagePanel.hide();
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
  battleDamagePanel.setContext(spectateContext);
  battleResult.setContext(spectateContext);
  battleHud.setCastleBarsVisible(true);
  spectatorHands.setNames({
    blue: spectateContext.localName,
    blueMate: spectateContext.teammateName,
    red: spectateContext.opponentName,
    redMate: spectateContext.extraOpponentName,
  });
  spectatorHands.show();
  battleHud.setCatchingUp(netLoop.pendingTicks > 0);
  battleHud.show();
  battleDamagePanel.show();

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
    battleDamagePanel.update(netLoop.match);
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
    battleDamagePanel.hide();
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
  // 从匹配等待切到房间列表时，等待弹窗必须先收掉，否则会盖住大厅
  quickMatchDialog.hide();
  onlineLobbyPage.show();
  // 进大厅顺手查一次：若还有未结束的局，弹窗让玩家自己决定回不回去
  checkPendingRejoin();
  return () => {
    onlineLobbyPage.hide();
    // 离开大厅必须收起弹窗，避免盖在其他页面上
    rejoinDialog?.hide();
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
    // 回到主菜单是主要入口：刷新后重启也能凭本地凭据接回对局
    checkPendingRejoin();
    return () => {
      mainMenu.hide();
      rejoinDialog?.hide();
      // 离开主菜单即作废等待中的匹配，避免它在别的页面里突然开局
      cancelQuickMatch();
    };
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
  campaign: () => {
    syncLobbyPresenceForScreen('campaign');
    campaignPage.show();
    return () => campaignPage.hide();
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
  'endless-config': () => {
    syncLobbyPresenceForScreen('endless-config');
    endlessConfigPage.show();
    return () => endlessConfigPage.hide();
  },
  'scene-config': () => {
    syncLobbyPresenceForScreen('scene-config');
    sceneConfigPage.show();
    return () => sceneConfigPage.hide();
  },
  'sfx-config': () => {
    syncLobbyPresenceForScreen('sfx-config');
    sfxConfigPage.show();
    return () => sfxConfigPage.hide();
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
  // 先置位：后续所有清理（含对局屏 leave）都按"刷新"处理，不能作废凭据也不记放弃
  appUnloading = true;
  screens.dispose();
  stopAppLobbyPresence();
  rejoinDialog?.dispose();
  rejoinDialog = null;
  sharedBattleView?.reset();
  sharedBattleView = null;
  sharedScene?.dispose();
  sharedScene = null;
  disposeFormationThumbnailRenderer();
  // 卸载保留凭据：刷新页面后仍能凭它接回未结束的对局
  disposeRoomSession(false);
  disposeSpectateSession();
  spectatorHands.dispose();
  onlineLobbyPage.dispose();
  quickMatchDialog.dispose();
  leaderboardPage.dispose();
  campaignPage.dispose();
  replayListPage.dispose();
  onlineRoomPage.dispose();
  mainMenu.dispose();
  deckConfigPage.dispose();
  specialTierPage.dispose();
  handOddsPage.dispose();
  unitStatsPage.dispose();
  endlessConfigPage.dispose();
  sceneConfigPage.dispose();
  sfxConfigPage.dispose();
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

/**
 * 战役关卡结算：通关写本地进度，成败都记一条关卡挑战摘要，再展示结算面板。
 * 「下一关」切换选中关卡后重挂 solo 页；「重试」重挂当前关卡。
 */
function showStageResult(def: StageDef, outcome: StageOutcome): void {
  const cleared = outcome.status === 'success';
  // 每关一颗星，只在首次通关时给，写进度前先判断以前是否通关过
  const firstClear = cleared && campaignProgress.load().stages[def.id] === undefined;
  if (cleared) {
    campaignProgress.recordClear({
      stageId: def.id,
      seconds: outcome.seconds,
    });
  }
  try {
    playerProfile.recordStageChallenge({
      stageId: def.id,
      outcome: cleared ? 'cleared' : 'failed',
    });
    mainMenu.refreshProfile();
  } catch (error) {
    console.error('[account] 关卡挑战记录写入失败', error);
  }

  const next = getNextStage(def.id);
  // 结算按钮回到战役选关页，而不是主界面
  battleResult.setReturnLabel('返回战役');
  battleResult.showStage({
    cleared,
    seconds: outcome.seconds,
    // 残局关输法很多（超手数、用了禁用牌型、超时），直接告诉玩家输在哪
    failText: outcome.reason ? STAGE_FAIL_REASON_TEXT[outcome.reason] : undefined,
    badge: firstClear ? '+1 ★' : undefined,
    hasNext: Boolean(next),
    onNext: () => {
      if (!next) return;
      selectedStage = next;
      screens.show('solo', { remount: true });
    },
    onRetry: () => {
      selectedStage = def;
      screens.show('solo', { remount: true });
    },
  });
}

/** 是否无限防守生成的波次关卡（id 以 endless_ 开头）。 */
function isEndlessStage(def: StageDef): boolean {
  return def.id.startsWith('endless_');
}

/** 按挑战状态生成当前波次并进入单机对局。 */
function startEndlessWave(run: EndlessRunState): void {
  endlessRun = run;
  selectedStage = buildWaveStage(run);
  selectedSoloDifficulty = 'hard';
  selectedSoloDebugSpawn = false;
  screens.show('solo', { remount: true });
}

/** 新开一次挑战：随机种子建档并立即存盘，中途退出也能续玩第 1 波。 */
function startNewEndlessRun(): void {
  const run = createRun(createBattleSeed());
  endlessProgress.saveRun(run);
  startEndlessWave(run);
}

/** 战役页点无限防守：有进行中的挑战先问继续还是重来。 */
function openEndlessEntry(): void {
  const saved = endlessProgress.load().run;
  if (!saved) {
    startNewEndlessRun();
    return;
  }
  boonPickPanel.showEntry(
    saved,
    () => startEndlessWave(saved),
    () => startNewEndlessRun(),
    () => {},
  );
}

/**
 * 一波结束：守住则推进波次并弹三选一，选完存档开下一波；
 * 主堡陷落则结束挑战、刷新最佳并展示结算。
 * survivors 为本波结束时玩家场上存活单位，会原位置、原血量带入下一波。
 */
function showEndlessWaveResult(
  run: EndlessRunState,
  outcome: StageOutcome,
  hpRatio: number,
  survivors: readonly StagePresetUnit[],
): void {
  battleResult.setReturnLabel('返回战役');
  if (outcome.status === 'success') {
    sfx.play('result_win');
    // 清场流没有固定波长，累计时长记本波实际用时
    const advanced = advanceWave(run, hpRatio, outcome.seconds, survivors);
    // Boss 波之后只给稀有强化
    const choices = rollBoonChoices(advanced, isBossWave(run.wave));
    const proceed = (next: EndlessRunState): void => {
      endlessProgress.saveRun(next);
      startEndlessWave(next);
    };
    if (choices.length === 0) {
      proceed(advanced);
      return;
    }
    // 三选一期间保留叠加 HUD 并抬到弹层遮罩之上，让玩家边选边看当前叠加
    endlessStats.show(advanced, true);
    boonPickPanel.showChoices(run.wave, choices, (boonId) => proceed(applyBoon(advanced, boonId)));
    return;
  }
  // 失守结算铺满屏幕，先收起叠加面板，避免和结算卡叠在一起
  endlessStats.hide();
  const { improved, clearedWaves } = finishEndlessAsFailed(run);
  battleResult.showStage({
    cleared: false,
    seconds: outcome.seconds,
    hasNext: false,
    onNext: () => {},
    onRetry: () => startNewEndlessRun(),
    titleText: '防线失守',
    highlight: { label: '守住波数', value: String(clearedWaves) },
    badge: improved ? '新纪录' : undefined,
    retryLabel: '重新挑战',
  });
}

/**
 * 结束无限防守挑战并按失败记账。
 *
 * clearedWaves 取「当前波次 - 1」：主堡陷落与主动退出都只算完整守住的波数。
 * run 里存的是本波开局的残血，正好作为同波数的比较依据。
 * 返回刷新后的最佳纪录状态，供结算文案与调用方判断。
 */
function finishEndlessAsFailed(run: EndlessRunState): { improved: boolean; clearedWaves: number } {
  const clearedWaves = Math.max(0, run.wave - 1);
  const improved = endlessProgress.finishRun(run, clearedWaves);
  try {
    playerProfile.recordStageChallenge({ stageId: 'endless', outcome: clearedWaves > 0 ? 'cleared' : 'failed' });
    mainMenu.refreshProfile();
  } catch (error) {
    console.error('[account] 无限防守记录写入失败', error);
  }
  return { improved, clearedWaves };
}

/** 引信炸弹拖拽预览半径：读取兵种 aoeRadius，缺省回落 8。 */
function fuseBombTypePreviewRadius(typeId: 'giant_bomb' | 'small_bomb'): number {
  const attack = getUnitConfig(typeId).attack;
  return attack.kind === 'projectile_aoe' ? toFloat(attack.aoeRadius) : 8;
}

/** 出牌拖拽预览半径：阵型 aoeRadius 优先，缺省回落兵种配置。 */
function fuseBombPreviewRadius(formation: CardFormation): number {
  if (formation.aoeRadius !== undefined) return formation.aoeRadius;
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
