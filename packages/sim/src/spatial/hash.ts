import { type Fx, floorToInt, div } from '../math/fixed.js';

/**
 * 半邻域偏移：右、下、左下、右下。
 * 每个非空格只朝这些方向看邻居，8 邻接的格子对会出现且只出现一次。
 */
const PAIR_NEIGHBOR_OFFSETS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [1, 1],
] as const;

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
  /** 本轮 insert 过的非空格，clear 时只扫这些格，避免每次走完全场空格子 */
  private readonly occupied: number[] = [];

  constructor(width: Fx, height: Fx, cellSize: Fx) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, floorToInt(div(width, cellSize)) + 1);
    this.rows = Math.max(1, floorToInt(div(height, cellSize)) + 1);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear(): void {
    for (let i = 0; i < this.occupied.length; i++) {
      this.cells[this.occupied[i]!]!.length = 0;
    }
    this.occupied.length = 0;
  }

  private cellIndex(x: Fx, y: Fx): number {
    const cx = Math.min(this.cols - 1, Math.max(0, floorToInt(div(x, this.cellSize))));
    const cy = Math.min(this.rows - 1, Math.max(0, floorToInt(div(y, this.cellSize))));
    return cy * this.cols + cx;
  }

  /** value 一般是单位在 world.units 里的下标，调用方按升序插入即可保证遍历顺序确定 */
  insert(value: number, x: Fx, y: Fx): void {
    const idx = this.cellIndex(x, y);
    const cell = this.cells[idx]!;
    if (cell.length === 0) this.occupied.push(idx);
    cell.push(value);
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

  /**
   * 遍历所有可能发生圆重叠的唯一配对（本格 + 半邻域）。
   * 比「每单位 query 再丢一半」少一次邻域拷贝；cellSize 约束保证不会漏对。
   */
  forEachCandidatePair(visit: (a: number, b: number) => void): void {
    const cols = this.cols;
    const rows = this.rows;
    const cells = this.cells;
    const occupied = this.occupied;

    for (let o = 0; o < occupied.length; o++) {
      const idx = occupied[o]!;
      const cy = (idx / cols) | 0;
      const cx = idx - cy * cols;
      const cell = cells[idx]!;

      for (let i = 0; i < cell.length; i++) {
        const ia = cell[i]!;
        for (let j = i + 1; j < cell.length; j++) {
          visit(ia, cell[j]!);
        }
      }

      for (let d = 0; d < PAIR_NEIGHBOR_OFFSETS.length; d++) {
        const nx = cx + PAIR_NEIGHBOR_OFFSETS[d]![0];
        const ny = cy + PAIR_NEIGHBOR_OFFSETS[d]![1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const other = cells[ny * cols + nx]!;
        if (other.length === 0) continue;
        for (let i = 0; i < cell.length; i++) {
          const ia = cell[i]!;
          for (let j = 0; j < other.length; j++) {
            visit(ia, other[j]!);
          }
        }
      }
    }
  }
}
