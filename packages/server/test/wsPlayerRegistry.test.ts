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

    expect(registry.unbind(lobby)).toBeNull();
    expect(registry.list()).toEqual([{ playerId: 'device-aaa', name: '新名' }]);

    expect(registry.unbind(room)).toBe('device-aaa');
    expect(registry.list()).toEqual([]);
  });

  it('最后一条连接断开时 unbind 返回设备 ID', () => {
    const registry = new WsPlayerRegistry();
    const ws = new FakeWebSocket() as never;
    registry.bind(ws, 'device-bbb', '乙');
    expect(registry.unbind(ws)).toBe('device-bbb');
    expect(registry.unbind(ws)).toBeNull();
  });

  it('忽略空设备 ID', () => {
    const registry = new WsPlayerRegistry();
    registry.bind(new FakeWebSocket() as never, '', '匿名');
    expect(registry.list()).toEqual([]);
    expect(registry.snapshot()).toEqual({ devices: 0, boundConnections: 0 });
  });

  it('snapshot 统计设备数与已绑定连接数，匿名连接不进快照', () => {
    const registry = new WsPlayerRegistry();
    const lobby = new FakeWebSocket() as never;
    const room = new FakeWebSocket() as never;
    const anonymous = new FakeWebSocket() as never;

    expect(registry.snapshot()).toEqual({ devices: 0, boundConnections: 0 });

    registry.bind(lobby, 'device-aaa', '甲');
    registry.bind(room, 'device-aaa', '甲');
    registry.bind(anonymous, '', '匿名');
    // 两个连接同一设备 → 1 台设备、2 条绑定连接
    expect(registry.snapshot()).toEqual({ devices: 1, boundConnections: 2 });

    registry.unbind(room);
    expect(registry.snapshot()).toEqual({ devices: 1, boundConnections: 1 });

    registry.unbind(lobby);
    expect(registry.snapshot()).toEqual({ devices: 0, boundConnections: 0 });
  });
});
