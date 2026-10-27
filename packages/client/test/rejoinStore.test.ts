// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRejoinTicketStore,
  REJOIN_TICKET_KEY,
  type RejoinTicket,
} from '../src/net/rejoinStore.js';

/** 内存 Storage 替身，避免污染 jsdom 全局 localStorage。 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  } as Storage;
}

describe('rejoinStore 局外重连凭据', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('保存后可按同一设备读回', () => {
    const store = createRejoinTicketStore(storage, () => 1000);
    store.save({ playerId: 'dev-1', roomId: '042', token: 'tok-a' });

    expect(store.load('dev-1')).toEqual({
      playerId: 'dev-1',
      roomId: '042',
      token: 'tok-a',
      savedAt: 1000,
    });
  });

  it('换账号读取会作废旧凭据，避免串局', () => {
    const store = createRejoinTicketStore(storage);
    store.save({ playerId: 'dev-1', roomId: '042', token: 'tok-a' });

    expect(store.load('dev-2')).toBeNull();
    expect(storage.getItem(REJOIN_TICKET_KEY)).toBeNull();
  });

  it('损坏或字段缺失时清理，不给后续探测留脏数据', () => {
    const store = createRejoinTicketStore(storage);
    storage.setItem(REJOIN_TICKET_KEY, '{not json');
    expect(store.load('dev-1')).toBeNull();
    expect(storage.getItem(REJOIN_TICKET_KEY)).toBeNull();

    storage.setItem(REJOIN_TICKET_KEY, JSON.stringify({ playerId: 'dev-1', roomId: '042' }));
    expect(store.load('dev-1')).toBeNull();
    expect(storage.getItem(REJOIN_TICKET_KEY)).toBeNull();
  });

  it('clear 后不再有可接回的对局', () => {
    const store = createRejoinTicketStore(storage);
    store.save({ playerId: 'dev-1', roomId: '042', token: 'tok-a' });
    store.clear();
    expect(store.load('dev-1')).toBeNull();
  });

  it('新对局覆盖旧凭据，只保留最近一局', () => {
    const store = createRejoinTicketStore(storage);
    store.save({ playerId: 'dev-1', roomId: '042', token: 'tok-a' });
    store.save({ playerId: 'dev-1', roomId: '043', token: 'tok-b' });

    const ticket: RejoinTicket | null = store.load('dev-1');
    expect(ticket?.roomId).toBe('043');
    expect(ticket?.token).toBe('tok-b');
  });

  it('两个标签页各自一份凭据，互不覆盖', () => {
    // sessionStorage 按标签页隔离：同浏览器双开时不能让对方读到本页令牌
    const tabA = createRejoinTicketStore(createMemoryStorage());
    const tabB = createRejoinTicketStore(createMemoryStorage());
    tabA.save({ playerId: 'dev-1', roomId: '042', token: 'tok-a' });
    tabB.save({ playerId: 'dev-1', roomId: '042', token: 'tok-b' });

    expect(tabA.load('dev-1')?.token).toBe('tok-a');
    expect(tabB.load('dev-1')?.token).toBe('tok-b');
    tabA.clear();
    expect(tabB.load('dev-1')?.token).toBe('tok-b');
  });

  it('默认落在 sessionStorage，刷新仍在但不跨标签页', () => {
    const session = createMemoryStorage();
    const localStorageStub = createMemoryStorage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', localStorageStub);
    try {
      const store = createRejoinTicketStore();
      store.save({ playerId: 'dev-1', roomId: '042', token: 'tok-a' });
      expect(session.getItem(REJOIN_TICKET_KEY)).not.toBeNull();
      expect(localStorageStub.getItem(REJOIN_TICKET_KEY)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
