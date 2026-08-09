import { type Fx, HALF, div, floorToInt, fromInt, mul, sqrt } from '../math/fixed.js';

/**
 * 静态导航网格。只描述地形能不能走，不关心动态单位——
 * 单位之间的相互阻挡交给软碰撞（systems/separation.ts）处理。
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: Fx;
  private readonly blocked: Uint8Array;
  private blockedCount = 0;

  constructor(width: Fx, height: Fx, cellSize: Fx) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, floorToInt(div(width, cellSize)));
    this.rows = Math.max(1, floorToInt(div(height, cellSize)));
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  /** 全场是否存在障碍。没有障碍时视线检测可以直接短路，MVP 空场地几乎零开销。 */
  get hasObstacles(): boolean {
    return this.blockedCount > 0;
  }

  cellX(x: Fx): number {
    return Math.min(this.cols - 1, Math.max(0, floorToInt(div(x, this.cellSize))));
  }

  cellY(y: Fx): number {
    return Math.min(this.rows - 1, Math.max(0, floorToInt(div(y, this.cellSize))));
  }

  index(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cx < this.cols && cy >= 0 && cy < this.rows;
  }

  isBlockedCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true;
    return this.blocked[this.index(cx, cy)] !== 0;
  }

  isBlockedAt(x: Fx, y: Fx): boolean {
    return this.isBlockedCell(this.cellX(x), this.cellY(y));
  }

  setBlockedCell(cx: number, cy: number, value: boolean): void {
    if (!this.inBounds(cx, cy)) return;
    const i = this.index(cx, cy);
    const next = value ? 1 : 0;
    if (this.blocked[i] === next) return;
    this.blocked[i] = next;
    this.blockedCount += value ? 1 : -1;
  }

  /** 把一块矩形区域标记为障碍，坐标是世界坐标（闭区间，含 max 所在 cell） */
  setBlockedRect(minX: Fx, minY: Fx, maxX: Fx, maxY: Fx, value = true): void {
    for (let cy = this.cellY(minY); cy <= this.cellY(maxY); cy++) {
      for (let cx = this.cellX(minX); cx <= this.cellX(maxX); cx++) {
        this.setBlockedCell(cx, cy, value);
      }
    }
  }

  /**
   * 按半开世界矩形 [min, max) 标记障碍。
   * 建筑占地用半开区间，避免 max 恰好落在格线上时多挡一格。
   */
  setBlockedWorldRectExclusive(minX: Fx, minY: Fx, maxX: Fx, maxY: Fx, value = true): void {
    const maxCx = this.cellX(maxX - 1);
    const maxCy = this.cellY(maxY - 1);
    for (let cy = this.cellY(minY); cy <= maxCy; cy++) {
      for (let cx = this.cellX(minX); cx <= maxCx; cx++) {
        this.setBlockedCell(cx, cy, value);
      }
    }
  }

  /** 清空全部静态障碍（建筑拆除 / 清空战场时用） */
  clearBlocked(): void {
    this.blocked.fill(0);
    this.blockedCount = 0;
  }

  centerX(cx: number): Fx {
    return mul(fromInt(cx) + HALF, this.cellSize);
  }

  centerY(cy: number): Fx {
    return mul(fromInt(cy) + HALF, this.cellSize);
  }

  /**
   * 两点之间是否通视。按半个格子的步长采样，步长小于格子就不会漏掉薄墙。
   * 用采样而不是 Bresenham，是因为定点采样的取整规则更好推理，也更容易保证确定性。
   */
  lineOfSight(ax: Fx, ay: Fx, bx: Fx, by: Fx): boolean {
    if (!this.hasObstacles) return true;

    const dx = bx - ax;
    const dy = by - ay;
    const distance = sqrt(mul(dx, dx) + mul(dy, dy));
    const step = this.cellSize >> 1;
    const samples = Math.max(1, floorToInt(div(distance, step)) + 1);

    for (let i = 0; i <= samples; i++) {
      const t = div(fromInt(i), fromInt(samples));
      if (this.isBlockedAt(ax + mul(dx, t), ay + mul(dy, t))) return false;
    }
    return true;
  }
}
