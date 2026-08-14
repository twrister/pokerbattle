import { describe, expect, it } from 'vitest';
import { WsPlayerRegistry } from '../src/wsPlayerRegistry.js';

class FakeWebSocket {}

describe('WsPlayerRegistry', () => {
  it('按设备 ID 去重，同设备多连接只占一行', () => {
    const registry = new WsPlayerRegistry();
    const lobby = new FakeWebSocket() as never;
    const room = new FakeWebSocket() as never;

    registry.bind(lobby, 'device-aaa', '旧名');
    registry.bind(room, 'device-aaa', '新名');
    expect(registry.list()).toEqual([{ playerId: 'device-aaa', name: '新名' }]);

    registry.unbind(lobby);
    expect(registry.list()).toEqual([{ playerId: 'device-aaa', name: '新名' }]);

    registry.unbind(room);
    expect(registry.list()).toEqual([]);
  });

  it('忽略空设备 ID', () => {
    const registry = new WsPlayerRegistry();
    registry.bind(new FakeWebSocket() as never, '', '匿名');
    expect(registry.list()).toEqual([]);
  });
});
