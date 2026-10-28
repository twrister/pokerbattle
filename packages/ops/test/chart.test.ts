import { describe, expect, it } from 'vitest';
import {
  buildLineSeries,
  formatCount,
  formatDurationMs,
  formatPercent,
  niceMax,
  pickTicks,
  type RawPoint,
} from '../public/chart.js';

const SIZE = { width: 600, height: 200 };

function series(values: Array<number | null>): RawPoint[] {
  return values.map((value, index) => ({ label: `p${index}`, value }));
}

describe('niceMax', () => {
  it('取 1/2/5×10ⁿ 的整刻度', () => {
    expect(niceMax(0.4)).toBe(0.5);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.5)).toBe(2);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(43)).toBe(50);
    expect(niceMax(120)).toBe(200);
  });

  it('非正数与非法值回落到 1，避免除零', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
    expect(niceMax(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('buildLineSeries', () => {
  it('空序列与全 null 序列返回 null', () => {
    expect(buildLineSeries([], SIZE)).toBeNull();
    expect(buildLineSeries(series([null, null]), SIZE)).toBeNull();
  });

  it('尺寸非法时返回 null', () => {
    expect(buildLineSeries(series([1]), { width: 0, height: 200 })).toBeNull();
    expect(buildLineSeries(series([1]), { width: 600, height: -1 })).toBeNull();
  });

  it('坐标点全部落在 viewBox 内，首点贴左、末点贴右', () => {
    const result = buildLineSeries(series([0, 5, 10]), SIZE);
    expect(result).not.toBeNull();
    const points = result!.points;
    expect(points).toHaveLength(3);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(SIZE.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(SIZE.height);
    }
    expect(points[0]!.x).toBe(34);
    expect(points[2]!.x).toBe(SIZE.width - 10);
    // 值越大 y 越小
    expect(points[0]!.y).toBeGreaterThan(points[2]!.y);
  });

  it('折线路径以 M 开头，后续点用 L', () => {
    const result = buildLineSeries(series([1, 2, 3]), SIZE)!;
    expect(result.linePath.startsWith('M')).toBe(true);
    expect(result.linePath.split('L')).toHaveLength(3);
  });

  it('缺失点让折线断开成多段，且不参与面积填充', () => {
    const result = buildLineSeries(series([1, 2, null, 4, 5]), SIZE)!;
    // 两段连续数据 → 两个 M
    expect(result.linePath.match(/M/g)).toHaveLength(2);
    expect(result.areaPath.match(/Z/g)).toHaveLength(2);
    expect(result.points.map((point) => point.index)).toEqual([0, 1, 3, 4]);
  });

  it('单点序列也能画出面积与路径', () => {
    const result = buildLineSeries(series([7]), SIZE)!;
    expect(result.points).toHaveLength(1);
    expect(result.linePath.startsWith('M')).toBe(true);
    expect(result.areaPath.endsWith('Z')).toBe(true);
  });

  it('Y 轴刻度自下而上递增且不超过 maxY', () => {
    const result = buildLineSeries(series([0, 23]), SIZE)!;
    const values = result.yTicks.map((tick) => tick.value);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(result.maxY);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    // 刻度 y 值应自上而下递增（0 在底部）
    expect(result.yTicks[0]!.y).toBeGreaterThan(result.yTicks.at(-1)!.y);
  });

  it('长序列不做抽稀也能完整保留所有点', () => {
    const values = Array.from({ length: 168 }, (_, index) => index % 12);
    const result = buildLineSeries(series(values), SIZE)!;
    expect(result.points).toHaveLength(168);
  });

  it('小量级数据用整数刻度，不出现重复或跳号', () => {
    // 峰值只有 2：等分会得到 0/0.5/1/1.5/2，取整后出现重复的「1」
    const tiny = buildLineSeries(series([0, 1, 2]), SIZE)!;
    expect(tiny.yTicks.map((tick) => tick.value)).toEqual([0, 1, 2]);

    // 峰值 5：4 段等分会跳号（0/1/3/4/5），应退到能整除的段数
    const five = buildLineSeries(series([0, 5]), SIZE)!;
    const values = five.yTicks.map((tick) => tick.value);
    expect(values).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('峰值恰好为 1 时给出 0 与 1 两个刻度', () => {
    const result = buildLineSeries(series([1]), SIZE)!;
    expect(result.yTicks.map((tick) => tick.value)).toEqual([0, 1]);
  });
});

describe('pickTicks', () => {
  it('点数不超过上限时全部显示', () => {
    expect(pickTicks(5, 8)).toEqual([0, 1, 2, 3, 4]);
  });

  it('点数过多时抽稀但保留首尾', () => {
    const ticks = pickTicks(168, 6);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(167);
  });

  it('0 或负数回空数组', () => {
    expect(pickTicks(0, 5)).toEqual([]);
    expect(pickTicks(-3, 5)).toEqual([]);
  });
});

describe('formatCount', () => {
  it('过千用 k 后缀，其余取整', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7.6)).toBe('8');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(12_345)).toBe('12.3k');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('formatDurationMs', () => {
  it('按分秒展示，null 与非有限值回 —', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(45_000)).toBe('45 秒');
    expect(formatDurationMs(90_000)).toBe('1 分 30 秒');
    expect(formatDurationMs(600_000)).toBe('10 分 00 秒');
  });
});

describe('formatPercent', () => {
  it('分母为 0 时回 —，否则取整百分比', () => {
    expect(formatPercent(1, 0)).toBe('—');
    expect(formatPercent(1, 4)).toBe('25%');
    expect(formatPercent(2, 3)).toBe('67%');
  });
});
