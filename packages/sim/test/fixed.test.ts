import { describe, expect, it } from 'vitest';
import { ONE, div, fromFloat, mul, sqrt, toFloat } from '../src/math/fixed.js';
import { Rng } from '../src/math/rng.js';

describe('定点数学', () => {
  it('乘法在大数量级下依然精确（这正是要拆高低位的原因）', () => {
    const a = fromFloat(20000);
    const b = fromFloat(1.5);
    expect(toFloat(mul(a, b))).toBeCloseTo(30000, 3);
  });

  it('乘法结果等于 floor(a * b / 2^16)', () => {
    const cases: Array<[number, number]> = [
      [1.5, 2.25],
      [-3.75, 8.5],
      [-1.25, -6.5],
      [0.001, 0.002],
      [12345.5, -0.25],
    ];
    for (const [x, y] of cases) {
      const a = fromFloat(x);
      const b = fromFloat(y);
      expect(mul(a, b)).toBe(Math.floor((a * b) / ONE));
    }
  });

  it('除法与乘法互逆', () => {
    const a = fromFloat(123.456);
    const b = fromFloat(7.5);
    expect(toFloat(mul(div(a, b), b))).toBeCloseTo(123.456, 2);
  });

  it('开方返回精确的下取整结果，不依赖 Math.sqrt 的实现细节', () => {
    for (const value of [0, 1, 2, 9, 16.5, 1000, 1500]) {
      const a = fromFloat(value);
      const r = sqrt(a);
      // r 是满足 r^2 <= a 的最大定点数
      expect(mul(r, r)).toBeLessThanOrEqual(a);
      expect(toFloat(r)).toBeCloseTo(Math.sqrt(value), 3);
    }
  });

  it('负数和零的开方安全返回 0', () => {
    expect(sqrt(0)).toBe(0);
    expect(sqrt(fromFloat(-5))).toBe(0);
  });
});

describe('确定性随机', () => {
  it('同种子产生同序列', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextUint()).toBe(b.nextUint());
  });

  it('状态可存取，用于快照与回放', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10; i++) rng.nextUint();
    const saved = rng.getState();
    const expected = [rng.nextUint(), rng.nextUint(), rng.nextUint()];

    rng.setState(saved);
    expect([rng.nextUint(), rng.nextUint(), rng.nextUint()]).toEqual(expected);
  });

  it('种子为 0 时自动换成非零种子，避免 xorshift 退化', () => {
    const rng = new Rng(0);
    expect(rng.nextUint()).not.toBe(0);
  });
});
