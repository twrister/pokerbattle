// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_PLAY_RENAME_PROMPTED_KEY } from '../src/account/firstPlayRename.js';
import { defaultDisplayName } from '../src/account/id.js';
import type { PlayerProfile } from '../src/account/types.js';
import { createMainMenu } from '../src/ui/mainMenu.js';

const envState = vi.hoisted(() => ({ isDev: true }));

vi.mock('../src/env.js', () => ({
  get IS_DEV_SERVER() {
    return envState.isDev;
  },
  APP_VERSION: '0.1.0',
  formatLobbyVersion: (version: string) => `v${version.trim().replace(/^v/i, '') || '0.0.0'}`,
}));

vi.mock('../src/net/session.js', () => ({
  createLobbyPresence: vi.fn(),
}));

function buildProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    schemaVersion: 2,
    deviceAccountId: 'device-ui',
    displayName: '测试玩家',
    createdAt: 1,
    updatedAt: 1,
    battleScore: 12,
    exp: 88,
    currentStageId: null,
    stats: { wins: 0, losses: 0, draws: 0, stageAttempts: 0, stageClears: 0 },
    recentBattles: [],
    recentStageChallenges: [],
    ...overrides,
  };
}

/** 测试用默认大厅回调；房间列表由注入的 listRooms 提供。 */
function menuOptions(overrides: Partial<Parameters<typeof createMainMenu>[0]> = {}) {
  return {
    onStartSandbox: vi.fn(),
    onStartSolo: vi.fn(),
    onStartSoloDebug: vi.fn(),
    onOpenOnline: vi.fn(),
    onOpenDeckConfig: vi.fn(),
    onOpenCodex: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    onOpenReplays: vi.fn(),
    getProfile: () => buildProfile(),
    onRename: vi.fn(),
    ...overrides,
  };
}

/** jsdom 不会播 CSS 动画，手动派发 animationend 以走完收起。 */
function finishRenameCloseAnim(): void {
  document
    .querySelector('#rename-dialog .mode-dialog-panel')!
    .dispatchEvent(new Event('animationend'));
}

/** 大厅 DOM fixture，含联机房间面板与大厅取消按钮。 */
function mountMainMenuDom(): void {
  document.body.innerHTML = `
    <main id="main-menu">
      <button id="btn-player-profile" type="button">
        <div id="player-avatar"></div>
        <div id="player-name"></div>
        <div id="player-level"></div>
      </button>
      <button id="btn-patch-notes" type="button">更新公告</button>
      <button id="btn-solo"></button>
      <button id="btn-match"></button>
      <button id="btn-sandbox"></button>
      <button id="btn-deck"></button>
      <button id="btn-codex"></button>
      <button id="btn-leaderboard"></button>
      <button id="btn-replays"></button>
      <button id="btn-solo-ai"></button>
      <button id="btn-solo-debug"></button>
      <div class="lobby-status-row">
        <div id="lobby-status"></div>
      </div>
      <div id="lobby-version"></div>
      <div id="mode-solo-dialog" class="is-hidden" aria-hidden="true">
        <button data-mode-close></button>
      </div>
      <div id="rename-dialog" class="is-hidden" aria-hidden="true">
        <button data-rename-close></button>
        <div class="mode-dialog-panel">
          <h2 id="rename-title">玩家名称</h2>
          <form id="rename-form">
            <input id="rename-input" />
            <div id="rename-error"></div>
            <button id="btn-rename-cancel" type="button" data-rename-close>取消</button>
            <button id="btn-rename-confirm" type="submit">保存</button>
          </form>
        </div>
      </div>
      <div id="patch-notes-dialog" class="is-hidden" aria-hidden="true">
        <button data-patch-notes-close></button>
        <div id="patch-notes-list"></div>
        <p id="patch-notes-status"></p>
        <button id="btn-patch-notes-add" type="button">新增版本</button>
        <button id="btn-patch-notes-save" type="button">保存</button>
      </div>
    </main>
  `;
}

describe('大厅玩家档案展示', () => {
  beforeEach(() => {
    envState.isDev = true;
    sessionStorage.removeItem(FIRST_PLAY_RENAME_PROMPTED_KEY);
    localStorage.removeItem(FIRST_PLAY_RENAME_PROMPTED_KEY);
    mountMainMenuDom();
  });

  it('初始化时展示档案名字与胜点', () => {
    let profile = buildProfile();
    createMainMenu(
      menuOptions({
        getProfile: () => profile,
      }),
    );

    expect(document.querySelector('#player-name')?.textContent).toBe('测试玩家');
    expect(document.querySelector('#player-level')?.textContent).toBe('胜点 12');
    expect(document.querySelector('#player-avatar')?.textContent).toBe('测试');
    expect(document.querySelector('#lobby-version')?.textContent).toBe('v0.1.0');
  });

  it('改名成功后刷新展示，失败时显示错误', () => {
    let profile = buildProfile();
    const onRename = vi.fn((name: string) => {
      if (name.trim() === '') throw new Error('名字不能为空');
      profile = buildProfile({ displayName: name.trim(), battleScore: 5, exp: 1 });
    });
    const menu = createMainMenu(
      menuOptions({
        getProfile: () => profile,
        onRename,
      }),
    );

    document.querySelector<HTMLButtonElement>('#btn-player-profile')!.click();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(false);

    const input = document.querySelector<HTMLInputElement>('#rename-input')!;
    input.value = '   ';
    document.querySelector<HTMLFormElement>('#rename-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(document.querySelector('#rename-error')?.textContent).toBe('名字不能为空');
    expect(document.querySelector('#rename-error')?.classList.contains('is-visible')).toBe(true);

    input.value = '新玩家';
    document.querySelector<HTMLFormElement>('#rename-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(onRename).toHaveBeenCalledWith('新玩家');
    expect(document.querySelector('#player-name')?.textContent).toBe('新玩家');
    finishRenameCloseAnim();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);

    profile = buildProfile({ displayName: '外部刷新', battleScore: 9, exp: 3 });
    menu.refreshProfile();
    expect(document.querySelector('#player-name')?.textContent).toBe('外部刷新');
    expect(document.querySelector('#player-level')?.textContent).toBe('胜点 9');
  });

  it('人机对战以 hard 难度启动单机', () => {
    const onStartSolo = vi.fn();
    const onStartSoloDebug = vi.fn();
    createMainMenu(menuOptions({ onStartSolo, onStartSoloDebug }));

    document.querySelector<HTMLButtonElement>('#btn-solo-ai')!.click();

    expect(onStartSolo).toHaveBeenCalledTimes(1);
    expect(onStartSolo).toHaveBeenCalledWith('hard');
    expect(onStartSoloDebug).not.toHaveBeenCalled();
  });

  it('开发服点击调试模式进入，且不走正常人机入口', () => {
    const onStartSolo = vi.fn();
    const onStartSoloDebug = vi.fn();
    createMainMenu(menuOptions({ onStartSolo, onStartSoloDebug }));

    document.querySelector<HTMLButtonElement>('#btn-solo-debug')!.click();

    expect(onStartSoloDebug).toHaveBeenCalledTimes(1);
    expect(onStartSolo).not.toHaveBeenCalled();
  });

  it('正式服点击调试模式仅提示不可进入', () => {
    envState.isDev = false;
    const onStartSoloDebug = vi.fn();
    createMainMenu(menuOptions({ onStartSoloDebug }));

    document.querySelector<HTMLButtonElement>('#btn-solo-debug')!.click();

    expect(onStartSoloDebug).not.toHaveBeenCalled();
    const status = document.querySelector('#lobby-status')!;
    expect(status.classList.contains('is-visible')).toBe(true);
    expect(status.textContent).toContain('正式服不可进入调试模式');
  });

  it('开发服与正式服点击模拟沙盒都会进入', () => {
    const onStartSandbox = vi.fn();
    createMainMenu(menuOptions({ onStartSandbox }));

    document.querySelector<HTMLButtonElement>('#btn-sandbox')!.click();
    expect(onStartSandbox).toHaveBeenCalledTimes(1);

    envState.isDev = false;
    onStartSandbox.mockClear();
    document.querySelector<HTMLButtonElement>('#btn-sandbox')!.click();
    expect(onStartSandbox).toHaveBeenCalledTimes(1);
  });

  it('点击多人联机进入独立大厅页', () => {
    const onOpenOnline = vi.fn();
    createMainMenu(menuOptions({ onOpenOnline }));

    document.querySelector<HTMLButtonElement>('#btn-match')!.click();
    expect(onOpenOnline).toHaveBeenCalledTimes(1);
  });

  it('正式服点击卡组进入阵型页', () => {
    envState.isDev = false;
    const onOpenDeckConfig = vi.fn();
    createMainMenu(menuOptions({ onOpenDeckConfig }));

    document.querySelector<HTMLButtonElement>('#btn-deck')!.click();
    expect(onOpenDeckConfig).toHaveBeenCalledTimes(1);
  });

  it('点击排行榜进入胜点榜页', () => {
    const onOpenLeaderboard = vi.fn();
    createMainMenu(menuOptions({ onOpenLeaderboard }));

    document.querySelector<HTMLButtonElement>('#btn-leaderboard')!.click();
    expect(onOpenLeaderboard).toHaveBeenCalledTimes(1);
  });

  it('点击战绩回放进入列表页', () => {
    const onOpenReplays = vi.fn();
    createMainMenu(menuOptions({ onOpenReplays }));

    document.querySelector<HTMLButtonElement>('#btn-replays')!.click();
    expect(onOpenReplays).toHaveBeenCalledTimes(1);
  });

  it('回大厅时同步服务端积分并刷新卡片', async () => {
    let profile = buildProfile({ battleScore: 0 });
    const onSyncBattleScore = vi.fn(async () => {
      profile = buildProfile({ battleScore: 15 });
    });
    const menu = createMainMenu(menuOptions({
      getProfile: () => profile,
      onSyncBattleScore,
    }));
    menu.show();
    await vi.waitFor(() => {
      expect(onSyncBattleScore).toHaveBeenCalledTimes(1);
      expect(document.querySelector('#player-level')?.textContent).toBe('胜点 15');
    });
  });

  it('默认名首次点单机只出改名弹窗，不出模式弹窗', () => {
    const profile = buildProfile({
      displayName: defaultDisplayName('device-ui'),
    });
    createMainMenu(menuOptions({ getProfile: () => profile }));

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#rename-title')?.textContent).toBe('请先设置玩家名称');
  });

  it('默认名取消改名后再点开局不再主动弹，直接进联机页', () => {
    const profile = buildProfile({
      displayName: defaultDisplayName('device-ui'),
    });
    const onOpenOnline = vi.fn();
    createMainMenu(menuOptions({ getProfile: () => profile, onOpenOnline }));

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    document.querySelector<HTMLButtonElement>('#btn-rename-cancel')!.click();
    finishRenameCloseAnim();

    document.querySelector<HTMLButtonElement>('#btn-match')!.click();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(onOpenOnline).toHaveBeenCalledTimes(1);
  });

  it('本会话已主动提示过则默认名点单机直接打开模式弹窗', () => {
    sessionStorage.setItem(FIRST_PLAY_RENAME_PROMPTED_KEY, '1');
    const profile = buildProfile({
      displayName: defaultDisplayName('device-ui'),
    });
    createMainMenu(menuOptions({ getProfile: () => profile }));

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(false);
  });

  it('仅有旧本地旗标时新会话仍会提示改名', () => {
    localStorage.setItem(FIRST_PLAY_RENAME_PROMPTED_KEY, '1');
    const profile = buildProfile({
      displayName: defaultDisplayName('device-ui'),
    });
    createMainMenu(menuOptions({ getProfile: () => profile }));

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#rename-title')?.textContent).toBe('请先设置玩家名称');
  });

  it('默认名点单机后改名成功，收起后再打开单机模式', () => {
    let profile = buildProfile({
      displayName: defaultDisplayName('device-ui'),
    });
    const onRename = vi.fn((name: string) => {
      profile = { ...profile, displayName: name.trim() };
    });
    createMainMenu(
      menuOptions({
        getProfile: () => profile,
        onRename,
      }),
    );

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    const input = document.querySelector<HTMLInputElement>('#rename-input')!;
    input.value = '新玩家';
    document.querySelector<HTMLFormElement>('#rename-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(onRename).toHaveBeenCalledWith('新玩家');
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-closing')).toBe(true);
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(true);

    finishRenameCloseAnim();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(false);
  });

  it('默认名点单机后取消改名则留在大厅', () => {
    const profile = buildProfile({
      displayName: defaultDisplayName('device-ui'),
    });
    createMainMenu(menuOptions({ getProfile: () => profile }));

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    document.querySelector<HTMLButtonElement>('#btn-rename-cancel')!.click();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-closing')).toBe(true);
    expect(document.querySelector('#btn-player-profile')?.classList.contains('is-rename-anchor')).toBe(
      true,
    );

    finishRenameCloseAnim();
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#btn-player-profile')?.classList.contains('is-rename-anchor')).toBe(
      false,
    );
  });

  it('已自定义名点单机直接打开单机弹窗', () => {
    createMainMenu(menuOptions());

    document.querySelector<HTMLButtonElement>('#btn-solo')!.click();
    expect(document.querySelector('#mode-solo-dialog')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);
  });

  it('改名弹窗从玩家卡片展开，关闭时先收起再隐藏', () => {
    const profileButton = document.querySelector<HTMLButtonElement>('#btn-player-profile')!;
    const renamePanel = document.querySelector<HTMLElement>('#rename-dialog .mode-dialog-panel')!;
    profileButton.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        width: 80,
        height: 40,
        right: 90,
        bottom: 60,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    renamePanel.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 200,
        left: 100,
        top: 200,
        width: 200,
        height: 160,
        right: 300,
        bottom: 360,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    createMainMenu(menuOptions());
    profileButton.click();

    const dialog = document.querySelector('#rename-dialog')!;
    expect(dialog.classList.contains('is-hidden')).toBe(false);
    expect(dialog.classList.contains('is-opening')).toBe(true);
    expect(renamePanel.style.getPropertyValue('--rename-from-x')).toBe('-150px');
    expect(renamePanel.style.getPropertyValue('--rename-from-y')).toBe('-240px');
    expect(document.querySelector('#rename-title')?.textContent).toBe('玩家名称');

    document.querySelector<HTMLButtonElement>('#btn-rename-cancel')!.click();
    expect(dialog.classList.contains('is-closing')).toBe(true);
    expect(dialog.classList.contains('is-hidden')).toBe(false);
    expect(profileButton.classList.contains('is-rename-anchor')).toBe(true);

    finishRenameCloseAnim();
    expect(dialog.classList.contains('is-hidden')).toBe(true);
    expect(dialog.classList.contains('is-closing')).toBe(false);
    expect(profileButton.classList.contains('is-rename-anchor')).toBe(false);
  });

  it('点击更新公告入口打开面板，关闭后回到大厅', () => {
    createMainMenu(menuOptions());
    const dialog = document.querySelector('#patch-notes-dialog')!;

    document.querySelector<HTMLButtonElement>('#btn-patch-notes')!.click();
    expect(dialog.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector<HTMLInputElement>('.patch-note-version-input')?.value).toBe(
      '0.1.5',
    );

    document.querySelector<HTMLButtonElement>('[data-patch-notes-close]')!.click();
    expect(dialog.classList.contains('is-hidden')).toBe(true);
  });
});
