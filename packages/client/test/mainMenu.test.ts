// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerProfile } from '../src/account/types.js';
import { createMainMenu } from '../src/ui/mainMenu.js';

function buildProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    schemaVersion: 1,
    deviceAccountId: 'device-ui',
    displayName: '测试玩家',
    createdAt: 1,
    updatedAt: 1,
    level: 4,
    exp: 88,
    currentStageId: null,
    stats: { wins: 0, losses: 0, draws: 0, stageAttempts: 0, stageClears: 0 },
    recentBattles: [],
    recentStageChallenges: [],
    ...overrides,
  };
}

describe('大厅玩家档案展示', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="main-menu">
        <button id="btn-player-profile" type="button">
          <div id="player-avatar"></div>
          <div id="player-name"></div>
          <div id="player-level"></div>
        </button>
        <button id="btn-solo"></button>
        <button id="btn-match"></button>
        <button id="btn-sandbox"></button>
        <button id="btn-deck"></button>
        <button id="btn-codex"></button>
        <button id="btn-solo-easy"></button>
        <button id="btn-online-quick"></button>
        <div id="lobby-status"></div>
        <div id="mode-solo-dialog" class="is-hidden" aria-hidden="true">
          <button data-mode-close></button>
        </div>
        <div id="mode-online-dialog" class="is-hidden" aria-hidden="true">
          <button data-mode-close></button>
        </div>
        <div id="rename-dialog" class="is-hidden" aria-hidden="true">
          <button data-rename-close></button>
          <form id="rename-form">
            <input id="rename-input" />
            <div id="rename-error"></div>
            <button id="btn-rename-cancel" type="button" data-rename-close>取消</button>
            <button id="btn-rename-confirm" type="submit">保存</button>
          </form>
        </div>
      </main>
    `;
  });

  it('初始化时展示档案名字与等级', () => {
    let profile = buildProfile();
    createMainMenu({
      onStartSandbox: vi.fn(),
      onStartSolo: vi.fn(),
      onStartVersus: vi.fn(),
      onOpenDeckConfig: vi.fn(),
      onOpenCodex: vi.fn(),
      getProfile: () => profile,
      onRename: vi.fn(),
    });

    expect(document.querySelector('#player-name')?.textContent).toBe('测试玩家');
    expect(document.querySelector('#player-level')?.textContent).toBe('等级 04');
    expect(document.querySelector('#player-avatar')?.textContent).toBe('测试');
  });

  it('改名成功后刷新展示，失败时显示错误', () => {
    let profile = buildProfile();
    const onRename = vi.fn((name: string) => {
      if (name.trim() === '') throw new Error('名字不能为空');
      profile = buildProfile({ displayName: name.trim(), level: 5, exp: 1 });
    });
    const menu = createMainMenu({
      onStartSandbox: vi.fn(),
      onStartSolo: vi.fn(),
      onStartVersus: vi.fn(),
      onOpenDeckConfig: vi.fn(),
      onOpenCodex: vi.fn(),
      getProfile: () => profile,
      onRename,
    });

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
    expect(document.querySelector('#rename-dialog')?.classList.contains('is-hidden')).toBe(true);

    profile = buildProfile({ displayName: '外部刷新', level: 9, exp: 3 });
    menu.refreshProfile();
    expect(document.querySelector('#player-name')?.textContent).toBe('外部刷新');
    expect(document.querySelector('#player-level')?.textContent).toBe('等级 09');
  });
});
