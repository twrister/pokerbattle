import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DAILY_RETENTION_DAYS,
  HOURLY_RETENTION_HOURS,
  MetricsStore,
  type OnlineSample,
} from '../src/metricsStore.js';

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

const TZ = 'Asia/Shanghai';
/** 2024-10-28 12:00 上海时间（UTC+8）。 */
const NOON_SH = Date.UTC(2024, 9, 28, 4, 0, 0);

function tempStore(options: { now?: () => number; timeZone?: string; dailyIdCap?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-metrics-'));
  dirs.push(dir);
  const filePath = path.join(dir, 'metrics.json');
  return {
    filePath,
    store: new MetricsStore({
      filePath,
      now: options.now ?? (() => NOON_SH),
      timeZone: options.timeZone ?? TZ,
      dailyIdCap: options.dailyIdCap,
    }),
  };
}

function sample(overrides: Partial<OnlineSample> = {}): OnlineSample {
  return {
    devices: 3,
    anonymous: 1,
    connections: 4,
    lobby: 2,
    solo: 1,
    room: 1,
    ...overrides,
  };
}

const EMPTY_INPUT = { newPlayersByDay: new Map<string, number>(), totalPlayers: 0 };

describe('MetricsStore DAU', () => {
  it('同一设备当天多次活跃只计 1 次，非法 ID 不计入', () => {
    const { store } = tempStore();
    store.notePlayerActive('device-a');
    store.notePlayerActive('device-a');
    store.notePlayerActive('device-b');
    store.notePlayerActive('');
    store.notePlayerActive('bad id');

    expect(store.buildPayload(EMPTY_INPUT).today.dau).toBe(2);
  });

  it('匿名连接只计入在线人数，不计入 DAU', () => {
    const { store } = tempStore();
    store.recordSample(sample({ devices: 0, anonymous: 5 }));

    const payload = store.buildPayload(EMPTY_INPUT);
    expect(payload.today.dau).toBe(0);
    expect(payload.current.onlineDevices).toBe(0);
    expect(payload.current.anonymousConnections).toBe(5);
  });

  it('达到去重上限后不再扩充 DAU，但在线人数照常统计', () => {
    const { store } = tempStore({ dailyIdCap: 2 });
    store.notePlayerActive('device-a');
    store.notePlayerActive('device-b');
    store.notePlayerActive('device-c');
    store.recordSample(sample({ devices: 3 }));

    const payload = store.buildPayload(EMPTY_INPUT);
    expect(payload.today.dau).toBe(2);
    expect(payload.current.onlineDevices).toBe(3);
  });

  it('按 Asia/Shanghai 切日：15:59Z 与 16:01Z 分属两天', () => {
    let now = Date.UTC(2024, 9, 28, 15, 59, 0);
    const { store } = tempStore({ now: () => now });
    store.notePlayerActive('device-a');
    expect(store.buildPayload(EMPTY_INPUT).today.day).toBe('2024-10-28');

    now = Date.UTC(2024, 9, 28, 16, 1, 0);
    store.notePlayerActive('device-a');
    const payload = store.buildPayload(EMPTY_INPUT);
    // 跨天后是新的一天，同一设备重新计入
    expect(payload.today.day).toBe('2024-10-29');
    expect(payload.today.dau).toBe(1);
    expect(payload.daily.find((row) => row.day === '2024-10-28')?.dau).toBe(1);
  });
});

describe('MetricsStore 小时桶', () => {
  it('多次采样聚合成均值与峰值', () => {
    let now = Date.UTC(2024, 9, 28, 4, 0, 0);
    const { store } = tempStore({ now: () => now });
    store.recordSample(sample({ devices: 2, anonymous: 0 }));
    now += 60_000;
    store.recordSample(sample({ devices: 6, anonymous: 0 }));
    now += 60_000;
    store.recordSample(sample({ devices: 4, anonymous: 0 }));

    const hourly = store.buildPayload(EMPTY_INPUT).hourly;
    expect(hourly).toHaveLength(1);
    expect(hourly[0]?.avgOnline).toBe(4);
    expect(hourly[0]?.peakOnline).toBe(6);
    expect(hourly[0]?.label).toBe('10-28 12:00');
  });

  it('跨小时落不同桶并按时间升序返回', () => {
    let now = Date.UTC(2024, 9, 28, 4, 30, 0);
    const { store } = tempStore({ now: () => now });
    store.recordSample(sample());
    now = Date.UTC(2024, 9, 28, 5, 30, 0);
    store.recordSample(sample({ devices: 9 }));

    const hourly = store.buildPayload(EMPTY_INPUT).hourly;
    expect(hourly.map((point) => point.label)).toEqual(['10-28 12:00', '10-28 13:00']);
    expect(hourly[1]?.peakOnline).toBe(10);
  });

  it('小时桶裁剪到 168 个并保留当前桶', () => {
    let now = Date.UTC(2024, 9, 28, 4, 0, 0);
    const { store } = tempStore({ now: () => now });
    for (let i = 0; i < HOURLY_RETENTION_HOURS + 10; i += 1) {
      now = Date.UTC(2024, 9, 28, 4, 0, 0) + i * 3_600_000;
      store.recordSample(sample());
    }

    const hourly = store.buildPayload(EMPTY_INPUT).hourly;
    expect(hourly).toHaveLength(HOURLY_RETENTION_HOURS + 1);
    // 最新桶一定还在：起点 10-28 12:00 + 177 小时
    expect(hourly.at(-1)?.label).toBe('11-04 21:00');
  });
});

describe('MetricsStore 对局统计', () => {
  it('累加局数与时长，平局同样计入', () => {
    const { store } = tempStore();
    store.recordMatchEnd(60_000);
    store.recordMatchEnd(120_000);

    const payload = store.buildPayload(EMPTY_INPUT);
    expect(payload.today.matches).toBe(2);
    expect(payload.today.avgMatchDurationMs).toBe(90_000);
    expect(payload.totals.totalMatches).toBe(2);
  });

  it('无对局时平均时长为 null', () => {
    const { store } = tempStore();
    expect(store.buildPayload(EMPTY_INPUT).today.avgMatchDurationMs).toBeNull();
  });
});

describe('MetricsStore 载荷与保留', () => {
  it('daily 固定 30 天且升序，无数据补 0', () => {
    const { store } = tempStore();
    store.notePlayerActive('device-a');

    const payload = store.buildPayload({ newPlayersByDay: new Map([['2024-10-28', 2]]), totalPlayers: 7 });
    expect(payload.daily).toHaveLength(DAILY_RETENTION_DAYS);
    expect(payload.daily.at(-1)?.day).toBe('2024-10-28');
    expect(payload.daily.at(-1)?.dau).toBe(1);
    expect(payload.daily.at(-1)?.newPlayers).toBe(2);
    expect(payload.daily[0]?.dau).toBe(0);
    expect(payload.totals.totalPlayers).toBe(7);
    expect(payload.timeZone).toBe(TZ);
    expect(payload.hourlyRetentionHours).toBe(HOURLY_RETENTION_HOURS);
    expect(payload.dailyRetentionDays).toBe(DAILY_RETENTION_DAYS);
  });

  it('超过 30 天的日桶被裁掉', () => {
    let now = Date.UTC(2024, 9, 28, 4, 0, 0);
    const { store } = tempStore({ now: () => now });
    // 先写 40 天前的数据
    now = Date.UTC(2024, 9, 28, 4, 0, 0) - 40 * 86_400_000;
    store.notePlayerActive('device-old');
    store.recordMatchEnd(1_000);
    // 再回到今天采样触发裁剪
    now = Date.UTC(2024, 9, 28, 4, 0, 0);
    store.recordSample(sample());

    const payload = store.buildPayload(EMPTY_INPUT);
    expect(payload.daily.map((row) => row.day)).not.toContain('2024-09-18');
    expect(payload.totals.totalMatches).toBe(0);
  });

  it('current 记录最近一次采样，未采样时 sampledAt 为 null', () => {
    const { store } = tempStore();
    expect(store.buildPayload(EMPTY_INPUT).current.sampledAt).toBeNull();

    store.recordSample(sample({ lobby: 5, solo: 2, room: 3 }));
    const current = store.buildPayload(EMPTY_INPUT).current;
    expect(current.lobby).toBe(5);
    expect(current.solo).toBe(2);
    expect(current.room).toBe(3);
    expect(current.sampledAt).toBe(NOON_SH);
  });
});

describe('MetricsStore 持久化', () => {
  it('落盘后新实例能读回 DAU、对局与小时桶', () => {
    const { store, filePath } = tempStore();
    store.notePlayerActive('device-a');
    store.recordSample(sample());
    store.recordMatchEnd(30_000);
    store.dispose();

    const reloaded = new MetricsStore({ filePath, now: () => NOON_SH, timeZone: TZ });
    const payload = reloaded.buildPayload(EMPTY_INPUT);
    expect(payload.today.dau).toBe(1);
    expect(payload.today.matches).toBe(1);
    expect(payload.hourly).toHaveLength(1);
  });

  it('坏 JSON / 缺字段 / 负数被清洗且不抛错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-metrics-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'metrics.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        daily: [
          { day: '2024-10-28', dau: -5, peakOnline: 'x', matches: 1, durationMsSum: 1_000, ids: ['a', 'a', 'bad id'] },
          { day: 'not-a-day' },
          null,
          'oops',
        ],
        hourly: [
          { hourStart: 0, samples: 1 },
          { hourStart: Date.UTC(2024, 9, 28, 4), samples: 0 },
          { hourStart: Date.UTC(2024, 9, 28, 5), samples: 2, onlineSum: 8, onlinePeak: 5 },
        ],
      }),
      'utf8',
    );

    const store = new MetricsStore({ filePath, now: () => NOON_SH, timeZone: TZ });
    const payload = store.buildPayload(EMPTY_INPUT);
    expect(payload.today.dau).toBe(1);
    expect(payload.today.peakOnline).toBe(0);
    expect(payload.hourly).toHaveLength(1);
    expect(payload.hourly[0]?.avgOnline).toBe(4);
  });

  it('完全损坏的 JSON 直接忽略，不影响新建', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-metrics-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'metrics.json');
    fs.writeFileSync(filePath, '{ not json', 'utf8');

    const store = new MetricsStore({ filePath, now: () => NOON_SH, timeZone: TZ });
    expect(store.buildPayload(EMPTY_INPUT).today.dau).toBe(0);
  });

  it('写盘失败只告警一次且不影响内存统计', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 指向一个目录路径，mkdir/rename 必然失败
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-metrics-'));
    dirs.push(dir);
    const store = new MetricsStore({ filePath: dir, now: () => NOON_SH, timeZone: TZ });

    store.notePlayerActive('device-a');
    store.notePlayerActive('device-b');

    expect(store.buildPayload(EMPTY_INPUT).today.dau).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('MetricsStore 时区', () => {
  it('非法时区回落到 Asia/Shanghai 并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store } = tempStore({ timeZone: 'Nowhere/Nope' });

    expect(store.effectiveTimeZone).toBe(TZ);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('UTC 时区下日界按 UTC 切分', () => {
    const now = Date.UTC(2024, 9, 28, 15, 59, 0);
    const { store } = tempStore({ now: () => now, timeZone: 'UTC' });
    store.notePlayerActive('device-a');
    expect(store.buildPayload(EMPTY_INPUT).today.day).toBe('2024-10-28');
  });
});
