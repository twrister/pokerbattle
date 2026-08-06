import { type Fx, floorToInt, div } from '../math/fixed.js';

/**
 * 均匀网格空间哈希，用来把「找附近的单位」从 O(n²) 降到接近 O(n)。
 *
 * 前提约束：cellSize 必须 >= 任意两个单位半径之和，
 * 这样只查 3x3 邻域就不会漏掉任何真实重叠的配对。
 */
export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  private readonly cellSize: Fx;
  private readonly cells: number[][];

  constructor(width: Fx, height: Fx, cellSize: Fx) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, floorToInt(div(width, cellSize)) + 1);
    this.rows = Math.max(1, floorToInt(div(height, cellSize)) + 1);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear(): void {
    for (const cell of this.cells) cell.length = 0;
  }

  private cellIndex(x: Fx, y: Fx): number {
    const cx = Math.min(this.cols - 1, Math.max(0, floorToInt(div(x, this.cellSize))));
    const cy = Math.min(this.rows - 1, Math.max(0, floorToInt(div(y, this.cellSize))));
    return cy * this.cols + cx;
  }

  /** value 一般是单位在 world.units 里的下标，调用方按升序插入即可保证遍历顺序确定 */
  insert(value: number, x: Fx, y: Fx): void {
    this.cells[this.cellIndex(x, y)]!.push(value);
  }

  /**
   * 收集以 (x, y) 为中心、边长 2r 的方形范围内的所有候选值。
   * 结果是粗筛，可能包含实际不在圆内的项，调用方需要再做精确距离判断。
   */
  query(x: Fx, y: Fx, r: Fx, out: number[]): void {
    out.length = 0;
    const minCx = Math.max(0, floorToInt(div(x - r, this.cellSize)));
    const maxCx = Math.min(this.cols - 1, floorToInt(div(x + r, this.cellSize)));
    const minCy = Math.max(0, floorToInt(div(y - r, this.cellSize)));
    const maxCy = Math.min(this.rows - 1, floorToInt(div(y + r, this.cellSize)));
    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowBase = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.cells[rowBase + cx]!;
        for (let i = 0; i < cell.length; i++) out.push(cell[i]!);
      }
    }
  }
}
