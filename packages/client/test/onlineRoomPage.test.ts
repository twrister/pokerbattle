// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Faction } from '@pb/sim';
import { createOnlineRoomPage } from '../src/ui/onlineRoomPage.js';

function mountRoomDom(): void {
  document.body.innerHTML = `
    <main id="online-room" class="is-hidden">
      <button id="btn-online-room-leave"></button>
      <button id="btn-online-room-start"></button>
      <button id="btn-online-room-ready"></button>
      <span id="online-room-id"></span>
      <span id="online-room-name"></span>
      <div id="online-room-members"></div>
      <div id="online-room-status"></div>
      <div id="online-room-mode">
        <button id="btn-online-room-mode-1v1" type="button">1v1</button>
        <button id="btn-online-room-mode-2v2" type="button">2v2</button>
      </div>
    </main>
  `;
}

describe('联机房间页', () => {
  beforeEach(() => {
    mountRoomDom();
  });

  it('2v2 按两队渲染席位，点空席换座，房主可切模式', () => {
    const onPickSeat = vi.fn();
    const onSetMatchMode = vi.fn();
    const page = createOnlineRoomPage({
      onLeave: vi.fn(),
      onStartMatch: vi.fn(),
      onSetReady: vi.fn(),
      onSetMatchMode,
      onPickSeat,
    });
    page.applyRoomState(
      {
        type: 'roomState',
        roomId: '101',
        roomName: '双人房',
        hostSeat: 0,
        phase: 'waiting',
        matchMode: '2v2',
        maxPlayers: 4,
        members: [
          { seat: 0, name: 'A', ready: true, isHost: true, faction: Faction.Blue },
          { seat: 2, name: 'C', ready: true, isHost: false, faction: Faction.Red },
        ],
      },
      0,
    );

    expect(document.querySelectorAll('.online-room-team')).toHaveLength(2);
    expect(document.querySelectorAll('.online-room-member')).toHaveLength(4);
    expect(document.querySelectorAll('.online-room-member.is-empty')).toHaveLength(2);
    expect(document.querySelector('.online-room-member.is-host')?.classList.contains('is-ready')).toBe(true);
    expect(document.querySelector('.online-room-member.is-self .online-room-tag.is-host')?.textContent).toBe('房主');
    expect(document.querySelector('.online-room-member.is-empty')?.getAttribute('role')).toBe('button');
    expect(document.querySelector('#btn-online-room-mode-2v2')?.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('#btn-online-room-mode-2v2')?.getAttribute('aria-pressed')).toBe('true');

    document.querySelectorAll<HTMLElement>('.online-room-member.is-empty')[0]?.click();
    expect(onPickSeat).toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('#btn-online-room-mode-1v1')!.click();
    expect(onSetMatchMode).toHaveBeenCalledWith('1v1');
    page.dispose();
  });

  it('房主换到新席后仍显示开始游戏按钮', () => {
    const page = createOnlineRoomPage({
      onLeave: vi.fn(),
      onStartMatch: vi.fn(),
      onSetReady: vi.fn(),
      onSetMatchMode: vi.fn(),
      onPickSeat: vi.fn(),
    });
    page.applyRoomState(
      {
        type: 'roomState',
        roomId: '101',
        roomName: '双人房',
        hostSeat: 0,
        phase: 'waiting',
        matchMode: '2v2',
        maxPlayers: 4,
        members: [{ seat: 0, name: 'A', ready: true, isHost: true, faction: Faction.Blue }],
      },
      0,
    );
    expect(document.querySelector('#btn-online-room-start')?.classList.contains('is-hidden')).toBe(false);

    page.applyRoomState(
      {
        type: 'roomState',
        roomId: '101',
        roomName: '双人房',
        hostSeat: 2,
        phase: 'waiting',
        matchMode: '2v2',
        maxPlayers: 4,
        members: [{ seat: 2, name: 'A', ready: true, isHost: true, faction: Faction.Red }],
      },
      2,
    );
    expect(document.querySelector('#btn-online-room-start')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#btn-online-room-ready')?.classList.contains('is-hidden')).toBe(true);
    page.dispose();
  });

  it('非房主未准备时显示准备按钮，席位带未准备标记', () => {
    const onSetReady = vi.fn();
    const page = createOnlineRoomPage({
      onLeave: vi.fn(),
      onStartMatch: vi.fn(),
      onSetReady,
      onSetMatchMode: vi.fn(),
      onPickSeat: vi.fn(),
    });
    page.applyRoomState(
      {
        type: 'roomState',
        roomId: '202',
        roomName: '对战房',
        hostSeat: 0,
        phase: 'waiting',
        matchMode: '1v1',
        maxPlayers: 2,
        members: [
          { seat: 0, name: '房主', ready: true, isHost: true, faction: Faction.Blue },
          { seat: 1, name: '客人', ready: false, isHost: false, faction: Faction.Red },
        ],
      },
      1,
    );

    const self = document.querySelector('.online-room-member.is-self');
    expect(self?.classList.contains('is-unready')).toBe(true);
    expect(self?.querySelector('.online-room-tag.is-unready')?.textContent).toBe('未准备');
    const readyButton = document.querySelector<HTMLButtonElement>('#btn-online-room-ready')!;
    expect(readyButton.classList.contains('is-hidden')).toBe(false);
    expect(readyButton.classList.contains('is-ready')).toBe(false);
    expect(readyButton.textContent).toBe('准备');
    readyButton.click();
    expect(onSetReady).toHaveBeenCalledWith(true);
    page.dispose();
  });
});
