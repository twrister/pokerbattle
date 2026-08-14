import { describe, expect, it } from 'vitest';
import { LobbyPresence } from '../src/lobbyPresence.js';

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly OPEN = FakeWebSocket.OPEN;
  readyState = FakeWebSocket.OPEN;
}

describe('LobbyPresence', () => {
  it('登记与注销连接，size 反映当前大厅人数', () => {
    const lobby = new LobbyPresence();
    const a = new FakeWebSocket() as never;
    const b = new FakeWebSocket() as never;

    lobby.add(a);
    lobby.add(b);
    expect(lobby.size).toBe(2);

    lobby.add(a);
    expect(lobby.size).toBe(2);

    lobby.remove(a);
    expect(lobby.size).toBe(1);

    lobby.remove(a);
    expect(lobby.size).toBe(1);

    lobby.remove(b);
    expect(lobby.size).toBe(0);
  });

  it('登记名字与设备 ID，供在线名单导出', () => {
    const lobby = new LobbyPresence();
    const a = new FakeWebSocket() as never;
    lobby.add(a, { name: '甲', playerId: 'device-aaa' });
    expect(lobby.listOnline()).toEqual([{ name: '甲', playerId: 'device-aaa' }]);
  });
});
