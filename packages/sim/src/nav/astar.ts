import type { Fx } from '../math/fixed.js';
import { type Vec2, vec } from '../math/vec2.js';
import { ASTAR_NODE_BUDGET } from '../config/tuning.js';
import type { NavGrid } from './grid.js';

/** 八方向邻居。前四个是直走，后四个是斜走。 */
const NEIGHBOR_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGHBOR_DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** 直走 10、斜走 14，用整数近似 1 : √2，避免代价里出现浮点 */
const STEP_COST = [10, 10, 10, 10, 14, 14, 14, 14];

/**
 * 网格 A*。
 *
 * 做成一个持有复用缓冲的类而不是纯函数，是为了避免每次寻路都新建
 * 几千个元素的 TypedArray——一局里所有单位共用同一个实例。
 */
export class PathFinder {
  private readonly grid: NavGrid;
  private readonly gScore: Int32Array;
  private readonly fScore: Int32Array;
  private readonly cameFrom: Int32Array;
  /** 访问标记用「时间戳」而不是每次清零，省掉整数组的清空开销 */
  private readonly visitStamp: Int32Array;
  private readonly closed: Uint8Array;
  private stamp = 0;

  private readonly heap: number[] = [];
  private readonly cellPath: number[] = [];
  private readonly rawPoints: Vec2[] = [];

  constructor(grid: NavGrid) {
    this.grid = grid;
    const size = grid.cols * grid.rows;
    this.gScore = new Int32Array(size);
    this.fScore = new Int32Array(size);
    this.cameFrom = new Int32Array(size);
    this.visitStamp = new Int32Array(size);
    this.closed = new Uint8Array(size);
  }

  /**
   * 求从 (sx, sy) 到 (gx, gy) 的路点序列，写入 out（不含起点，最后一项是精确目标点）。
   * 返回 false 表示不可达，调用方应保留原路径或改为原地待命。
   */
  findPath(sx: Fx, sy: Fx, gx: Fx, gy: Fx, out: Vec2[]): boolean {
    const grid = this.grid;
    out.length = 0;

    // 空旷场地的绝大多数请求都走这条捷径，直连即可，不必进搜索
    if (grid.lineOfSight(sx, sy, gx, gy)) {
      out.push(vec(gx, gy));
      return true;
    }

    const startCell = grid.index(grid.cellX(sx), grid.cellY(sy));
    let goalCx = grid.cellX(gx);
    let goalCy = grid.cellY(gy);
    if (grid.isBlockedCell(goalCx, goalCy)) {
      const relocated = this.findNearestFreeCell(goalCx, goalCy);
      if (relocated < 0) return false;
      goalCx = relocated % grid.cols;
      goalCy = (relocated / grid.cols) | 0;
    }
    const goalCell = grid.index(goalCx, goalCy);
    if (startCell === goalCell) {
      out.push(vec(gx, gy));
      return true;
    }

    if (!this.search(startCell, goalCell, goalCx, goalCy)) return false;

    this.buildRawPoints(goalCell, gx, gy);
    this.smooth(sx, sy, out);
    return out.length > 0;
  }

  /** 目标格被占时，向外一圈圈找最近的可走格，遍历顺序固定所以结果确定 */
  private findNearestFreeCell(cx: number, cy: number): number {
    const grid = this.grid;
    const maxRing = Math.max(grid.cols, grid.rows);
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // 只看这一圈的边框，内部在更小的 ring 里已经检查过
          if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!grid.inBounds(nx, ny) || grid.isBlockedCell(nx, ny)) continue;
          return grid.index(nx, ny);
        }
      }
    }
    return -1;
  }

  private search(startCell: number, goalCell: number, goalCx: number, goalCy: number): boolean {
    const grid = this.grid;
    this.stamp++;
    this.heap.length = 0;

    this.touch(startCell);
    this.gScore[startCell] = 0;
    this.fScore[startCell] = heuristic(startCell % grid.cols, (startCell / grid.cols) | 0, goalCx, goalCy);
    this.cameFrom[startCell] = -1;
    this.heapPush(startCell);

    let expanded = 0;
    while (this.heap.length > 0) {
      const current = this.heapPop();
      if (current === goalCell) return true;
      if (this.closed[current] !== 0) continue;
      this.closed[current] = 1;

      if (++expanded > ASTAR_NODE_BUDGET) return false;

      const cx = current % grid.cols;
      const cy = (current / grid.cols) | 0;
      for (let n = 0; n < 8; n++) {
        const nx = cx + NEIGHBOR_DX[n]!;
        const ny = cy + NEIGHBOR_DY[n]!;
        if (!grid.inBounds(nx, ny) || grid.isBlockedCell(nx, ny)) continue;
        // 斜穿两个障碍的夹角在视觉上会「贴墙切角」，禁掉
        if (n >= 4 && (grid.isBlockedCell(nx, cy) || grid.isBlockedCell(cx, ny))) continue;

        const next = grid.index(nx, ny);
        this.touch(next);
        if (this.closed[next] !== 0) continue;

        const tentative = this.gScore[current]! + STEP_COST[n]!;
        if (tentative >= this.gScore[next]!) continue;
        this.gScore[next] = tentative;
        this.fScore[next] = tentative + heuristic(nx, ny, goalCx, goalCy);
        this.cameFrom[next] = current;
        this.heapPush(next);
      }
    }
    return false;
  }

  /** 惰性初始化：格子在本次搜索里第一次被碰到时才重置它的分数 */
  private touch(cell: number): void {
    if (this.visitStamp[cell] === this.stamp) return;
    this.visitStamp[cell] = this.stamp;
    this.gScore[cell] = 0x7fffffff;
    this.fScore[cell] = 0x7fffffff;
    this.cameFrom[cell] = -1;
    this.closed[cell] = 0;
  }

  private buildRawPoints(goalCell: number, gx: Fx, gy: Fx): void {
    const grid = this.grid;
    this.cellPath.length = 0;
    for (let cell = goalCell; cell >= 0; cell = this.cameFrom[cell]!) {
      this.cellPath.push(cell);
    }

    this.rawPoints.length = 0;
    // cellPath 是从终点回溯到起点的，倒着读；
    // 起点格（末项）不必作为路点，终点格（首项）由下面的精确目标点代替
    for (let i = this.cellPath.length - 2; i >= 1; i--) {
      const cell = this.cellPath[i]!;
      this.rawPoints.push(vec(grid.centerX(cell % grid.cols), grid.centerY((cell / grid.cols) | 0)));
    }
    // 最后一步走到真实目标点，而不是停在格子中心
    this.rawPoints.push(vec(gx, gy));
  }

  /**
   * 视线拉直（string pulling）：把栅格路径上能一眼看到的中间点全部删掉，
   * 只保留真正的拐点，否则单位会沿着格子中心走出锯齿。
   */
  private smooth(sx: Fx, sy: Fx, out: Vec2[]): void {
    const grid = this.grid;
    const points = this.rawPoints;
    let anchorX = sx;
    let anchorY = sy;
    let lastVisible = -1;

    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (grid.lineOfSight(anchorX, anchorY, p.x, p.y)) {
        lastVisible = i;
        continue;
      }
      // 从锚点看不到 points[i] 了，上一个可见点就是拐点
      if (lastVisible < 0) lastVisible = i;
      const corner = points[lastVisible]!;
      out.push(vec(corner.x, corner.y));
      anchorX = corner.x;
      anchorY = corner.y;
      i = lastVisible;
      lastVisible = -1;
    }

    if (lastVisible >= 0) {
      const tail = points[lastVisible]!;
      out.push(vec(tail.x, tail.y));
    }
  }

  private heapLess(a: number, b: number): boolean {
    const fa = this.fScore[a]!;
    const fb = this.fScore[b]!;
    // f 相同时用格子下标兜底，保证同一输入永远得到同一条路径
    return fa !== fb ? fa < fb : a < b;
  }

  private heapPush(cell: number): void {
    const heap = this.heap;
    heap.push(cell);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.heapLess(heap[i]!, heap[parent]!)) break;
      const tmp = heap[i]!;
      heap[i] = heap[parent]!;
      heap[parent] = tmp;
      i = parent;
    }
  }

  private heapPop(): number {
    const heap = this.heap;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < heap.length && this.heapLess(heap[left]!, heap[best]!)) best = left;
        if (right < heap.length && this.heapLess(heap[right]!, heap[best]!)) best = right;
        if (best === i) break;
        const tmp = heap[i]!;
        heap[i] = heap[best]!;
        heap[best] = tmp;
        i = best;
      }
    }
    return top;
  }
}

/** 八方向网格的标准 octile 距离，与 STEP_COST 的 10 / 14 保持同一量纲 */
function heuristic(cx: number, cy: number, gx: number, gy: number): number {
  const dx = Math.abs(cx - gx);
  const dy = Math.abs(cy - gy);
  return 10 * (dx + dy) - 6 * Math.min(dx, dy);
}
