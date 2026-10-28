/** 一个待绘制的数据点；value 为 null 表示该点缺失，图上应断线。 */
export interface RawPoint {
  label: string;
  value: number | null;
}

/** 坐标化后的点：x/y 已落在 viewBox 内。 */
export interface PlottedPoint {
  x: number;
  y: number;
  label: string;
  value: number;
  index: number;
}

export interface LineSeries {
  /** 主折线路径；缺失点处断开成多段 M 指令。 */
  linePath: string;
  /** 折线下方面积路径；每段独立闭合到基线。 */
  areaPath: string;
  points: PlottedPoint[];
  /** Y 轴刻度，自下而上。 */
  yTicks: Array<{ y: number; value: number }>;
  maxY: number;
}

export interface BuildLineSeriesOptions {
  width: number;
  height: number;
  padLeft?: number;
  padRight?: number;
  padTop?: number;
  padBottom?: number;
  /** 期望的 Y 轴刻度段数，实际会被夹到 1..7。 */
  ticks?: number;
}

/** 取整的坐标轴上限（1/2/5×10ⁿ）；非正数回落到 1。 */
export function niceMax(value: number): number;

/** 数量展示：过千用 k 后缀。 */
export function formatCount(value: number): string;

/** 毫秒转「x 分 y 秒」；null / 负数回 '—'。 */
export function formatDurationMs(ms: number | null): string;

/** 百分比展示；分母为 0 时回 '—'。 */
export function formatPercent(value: number, total: number): string;

/** 轴标签抽稀，返回要显示的下标，始终含首尾。 */
export function pickTicks(count: number, maxTicks: number): number[];

/** 把点列映射到 viewBox；全为缺失点时返回 null。 */
export function buildLineSeries(
  points: readonly RawPoint[],
  options: BuildLineSeriesOptions,
): LineSeries | null;
