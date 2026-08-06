import { type Fx, ONE, div, mul, sqrt } from './fixed.js';

/** 定点二维向量。战场是俯视平面，y 就是平面的纵轴，高度方向不参与模拟。 */
export interface Vec2 {
  x: Fx;
  y: Fx;
}

export function vec(x: Fx = 0, y: Fx = 0): Vec2 {
  return { x, y };
}

export function set(out: Vec2, x: Fx, y: Fx): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

/**
 * 距离的平方。
 * 场地最长边 32 单位，dx 最大约 2^21，mul 后约 2^26，远没到 int32 上限，可放心比大小。
 */
export function distSq(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  const dx = ax - bx;
  const dy = ay - by;
  return mul(dx, dx) + mul(dy, dy);
}

export function dist(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  return sqrt(distSq(ax, ay, bx, by));
}

export function lengthOf(x: Fx, y: Fx): Fx {
  return sqrt(mul(x, x) + mul(y, y));
}

/**
 * 归一化到单位向量。零向量返回 (0, 0)，调用方需要自己判断这种退化情况。
 * 朝向全程用单位向量表示，这样整个 sim 不需要任何三角函数。
 */
export function normalize(out: Vec2, x: Fx, y: Fx): Vec2 {
  const len = lengthOf(x, y);
  if (len <= 0) return set(out, 0, 0);
  return set(out, div(x, len), div(y, len));
}

/**
 * 朝目标方向转向，rate 是本 tick 允许的插值比例（0..ONE）。
 * 用插值而不是直接赋值，避免单位在目标切换时朝向瞬移导致画面抖动。
 */
export function turnToward(out: Vec2, cur: Vec2, tx: Fx, ty: Fx, rate: Fx): Vec2 {
  const nx = cur.x + mul(tx - cur.x, rate);
  const ny = cur.y + mul(ty - cur.y, rate);
  normalize(out, nx, ny);
  // 目标恰好是当前朝向的反向时插值结果为零向量，这一帧保持原朝向
  if (out.x === 0 && out.y === 0) copy(out, cur);
  return out;
}

export const ZERO: Readonly<Vec2> = { x: 0, y: 0 };
export const UNIT_Y: Readonly<Vec2> = { x: 0, y: ONE };
