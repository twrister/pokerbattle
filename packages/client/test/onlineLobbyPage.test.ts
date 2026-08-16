// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnlineLobbyPage } from '../src/ui/onlineLobbyPage.js';

function mountLobbyDom(): void {
  document.body.innerHTML = `
    <main id="online-lobby" class="is-hidden">
      <button id="btn-online-lobby-back"></button>
      <button id="btn-online-lobby-refresh"></button>
      <div id="online-lobby-list"></div>
      <button id="btn-online-lobby-create"></button>
      <button id="btn-online-lobby-join"></button>
      <div id="online-lobby-status"></div>
      <div id="online-create-dialog" class="is-hidden">
        <button data-online-create-close></button>
        <input id="online-create-name-input" />
        <div id="online-create-error"></div>
        <button id="btn-online-create-confirm"></button>
      </div>
      <div id="online-join-dialog" class="is-hidden">
        <button data-online-join-close></button>
        <input id="online-join-id-input" />
        <div id="online-join-error"></div>
        <button id="btn-online-join-confirm"></button>
      </div>
    </main>
  `;
}

describe('联机大厅页', () => {
  beforeEach(() => {
    mountLobbyDom();
  });

  it('展示房间卡片，点击后按房号加入', async () => {
    const onJoinRoom = vi.fn();
    const page = createOnlineLobbyPage({
      onBack: vi.fn(),
      onJoinRoom,
      onSpectateRoom: vi.fn(),
      getDefaultRoomName: () => '测试的房间',
      listRooms: vi.fn(async () => [
        {
          roomId: '042',
          roomName: '可加入房',
          playerCount: 1,
          maxPlayers: 2,
          phase: 'waiting' as const,
          spectatorCount: 0,
        },
      ]),
    });
    page.show();
    await vi.waitFor(() => {
      expect(document.querySelector('.online-room-card')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('.online-room-card-action')!.click();
    expect(onJoinRoom).toHaveBeenCalledWith({ mode: 'room', roomId: '042' });
    page.dispose();
  });

  it('对局中房间显示观战按钮', async () => {
    const onSpectateRoom = vi.fn();
    const page = createOnlineLobbyPage({
      onBack: vi.fn(),
      onJoinRoom: vi.fn(),
      onSpectateRoom,
      getDefaultRoomName: () => '测试的房间',
      listRooms: vi.fn(async () => [
        {
          roomId: '088',
          roomName: '对局房',
          playerCount: 2,
          maxPlayers: 2,
          phase: 'playing' as const,
          spectatorCount: 3,
        },
      ]),
    });
    page.show();
    await vi.waitFor(() => {
      expect(document.querySelector('.online-room-card-action')?.textContent).toBe('观战');
    });
    expect(document.querySelector('.online-room-card-state')?.textContent).toBe('对局中 · 观战 3');
    document.querySelector<HTMLButtonElement>('.online-room-card-action')!.click();
    expect(onSpectateRoom).toHaveBeenCalledWith('088');
    page.dispose();
  });

  it('创建与加入弹窗分别提交房间名和房号', () => {
    const onJoinRoom = vi.fn();
    const page = createOnlineLobbyPage({
      onBack: vi.fn(),
      onJoinRoom,
      onSpectateRoom: vi.fn(),
      getDefaultRoomName: () => '测试的房间',
      listRooms: vi.fn(async () => []),
    });
    page.show();

    document.querySelector<HTMLButtonElement>('#btn-online-lobby-create')!.click();
    const nameInput = document.querySelector<HTMLInputElement>('#online-create-name-input')!;
    expect(nameInput.value).toBe('测试的房间');
    nameInput.value = '自定义房';
    document.querySelector<HTMLButtonElement>('#btn-online-create-confirm')!.click();
    expect(onJoinRoom).toHaveBeenCalledWith({ mode: 'create', roomName: '自定义房' });

    document.querySelector<HTMLButtonElement>('#btn-online-lobby-join')!.click();
    const idInput = document.querySelector<HTMLInputElement>('#online-join-id-input')!;
    idInput.value = 'bad';
    document.querySelector<HTMLButtonElement>('#btn-online-join-confirm')!.click();
    expect(document.querySelector('#online-join-error')?.classList.contains('is-visible')).toBe(true);

    idInput.value = '088';
    document.querySelector<HTMLButtonElement>('#btn-online-join-confirm')!.click();
    expect(onJoinRoom).toHaveBeenLastCalledWith({ mode: 'room', roomId: '088' });
    page.dispose();
  });
});
