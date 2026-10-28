/**
 * 运维页极简折线图工具：只做坐标计算，不碰 DOM。
 * 浏览器（app.js）与 vitest 共用同一份实现，避免画图逻辑无法回归。
 */

const DEFAULT_PAD_LEFT = 34;
const DEFAULT_PAD_RIGHT = 10;
const DEFAULT_PAD_TOP = 12;
const DEFAULT_PAD_BOTTOM = 22;

/**
 * 取「好看」的坐标轴上限：1/2/5×10^n。
 * 0 或负数回落到 1，避免除零把点压到 y=NaN。
 */
function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

/** 数量展示：过千用 k 后缀，避免轴标签撑爆。 */
function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return `${Math.round((value / 1000) * 10) / 10}k`;
  return String(Math.round(value));
}

/** 毫秒转「x 分 y 秒」，供平均对局时长展示。 */
function formatDurationMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

/** 百分比展示；分母为 0 时回 '—'。 */
function formatPercent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '—';
  return `${Math.round((value / total) * 100)}%`;
}

/**
 * 轴标签抽稀：按可用宽度算出最多能放几个，返回要显示的下标。
 * 始终保留首尾，便于看出区间范围。
 */
function pickTicks(count, maxTicks) {
  if (!Number.isFinite(count) || count <= 0) return [];
  const limit = Math.max(2, Math.floor(maxTicks));
  if (count <= limit) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil((count - 1) / (limit - 1));
  const ticks = [];
  for (let index = 0; index < count; index += step) ticks.push(index);
  const last = count - 1;
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

/**
 * 把点列映射到 viewBox 坐标并生成 SVG 路径。
 * 缺失点（null / 非有限数）会把折线断开成多段，且不参与面积填充；
 * 全为缺失点时返回 null，由调用方渲染空态。
 */
function buildLineSeries(points, options) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const width = Number(options.width);
  const height = Number(options.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const padLeft = options.padLeft ?? DEFAULT_PAD_LEFT;
  const padRight = options.padRight ?? DEFAULT_PAD_RIGHT;
  const padTop = options.padTop ?? DEFAULT_PAD_TOP;
  const padBottom = options.padBottom ?? DEFAULT_PAD_BOTTOM;
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const baseline = height - padBottom;

  const validValues = [];
  for (const point of points) {
    if (typeof point.value === 'number' && Number.isFinite(point.value)) {
      validValues.push(point.value);
    }
  }
  if (validValues.length === 0) return null;

  const maxY = niceMax(Math.max(...validValues));
  const lastIndex = Math.max(1, points.length - 1);
  const xOf = (index) => padLeft + (plotWidth * index) / lastIndex;
  const yOf = (value) => padTop + plotHeight * (1 - value / maxY);

  const plotted = [];
  /** 当前连续段；遇到缺失点就 flush 成一段 path。 */
  let segment = [];
  const lineParts = [];
  const areaParts = [];

  const flush = () => {
    if (segment.length === 0) return;
    lineParts.push(
      segment
        .map((point, i) => `${i === 0 ? 'M' : 'L'}${round2(point.x)} ${round2(point.y)}`)
        .join(' '),
    );
    // 面积：沿折线走到末端，再落到基线并回到起点
    const first = segment[0];
    const last = segment[segment.length - 1];
    const area = [
      `M${round2(first.x)} ${round2(baseline)}`,
      ...segment.map((point) => `L${round2(point.x)} ${round2(point.y)}`),
      `L${round2(last.x)} ${round2(baseline)}`,
      'Z',
    ].join(' ');
    areaParts.push(area);
    segment = [];
  };

  points.forEach((point, index) => {
    const value = point.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      flush();
      return;
    }
    const plottedPoint = { x: xOf(index), y: yOf(value), label: point.label, value, index };
    segment.push(plottedPoint);
    plotted.push(plottedPoint);
  });
  flush();

  const yTicks = [];
  for (const value of buildYTicks(maxY, options.ticks ?? 4)) {
    yTicks.push({ y: yOf(value), value });
  }

  return {
    linePath: lineParts.join(' '),
    areaPath: areaParts.join(' '),
    points: plotted,
    yTicks,
    maxY,
  };
}

/**
 * 生成 0..max 的刻度值。
 * 人数是整数，`max` 又已经是 1/2/5×10^n，所以按「能整除 max 的步长」打点，
 * 否则等分取整会跳号（如 5 分 4 段得到 0/1/3/4/5，丢掉 2）。
 */
function buildYTicks(max, segments) {
  const limit = Number.isFinite(segments) ? Math.max(1, Math.min(7, Math.floor(segments))) : 4;
  const safeMax = Math.max(1, Math.round(max));
  const step = pickStep(safeMax, limit);
  const values = [];
  for (let value = 0; value <= safeMax; value += step) values.push(value);
  return values;
}

/** 挑一个接近 max/limit、且能整除 max 的整数步长。 */
function pickStep(max, limit) {
  const target = Math.max(1, max / limit);
  let best = max;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= max; step += 1) {
    if (max % step !== 0) continue;
    const distance = Math.abs(step - target);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export { buildLineSeries, formatCount, formatDurationMs, formatPercent, niceMax, pickTicks };
