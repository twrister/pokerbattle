import { type Fx, ONE } from './fixed.js';

/**
 * xorshift32 确定性随机源。
 *
 * 刻意做成实例而不是全局单例：随机数状态属于 World 的一部分，
 * 存档 / 回放 / 服务端重算都必须能把它一起带走，用 Math.random 会直接破坏确定性。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // 0 是 xorshift 的不动点，必须避开
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }

  /** 返回 [0, 2^32) 的无符号整数 */
  nextUint(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return x >>> 0;
  }

  /** 返回 [0, maxExclusive) 的整数 */
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return this.nextUint() % maxExclusive;
  }

  /** 返回 [0, 1) 的定点数 */
  nextFx(): Fx {
    return (this.nextUint() & 0xffff) as Fx;
  }

  /** 返回 [lo, hi] 的定点数 */
  nextRangeFx(lo: Fx, hi: Fx): Fx {
    if (hi <= lo) return lo;
    const span = hi - lo;
    return lo + Math.trunc((span * this.nextFx()) / ONE);
  }

  /** 存档 / 快照用 */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = (state | 0) === 0 ? 0x9e3779b9 : state | 0;
  }
}
