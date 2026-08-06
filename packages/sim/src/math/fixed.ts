/**
 * Q16.16 定点数。
 *
 * 战斗模拟必须在任何 CPU / 浏览器 / Node 上逐位一致（帧同步的前提），
 * 所以 sim 包内一律用 Fx 代替 number 做数值运算，禁止裸浮点和 Math.sin/cos/atan2。
 * 底层就是 int32：高 16 位整数部分，低 16 位小数部分。
 */
export type Fx = number;

/** 小数位数 */
export const FRAC_BITS = 16;
/** 定点 1.0 */
export const ONE: Fx = 1 << FRAC_BITS;
/** 定点 0.5 */
export const HALF: Fx = ONE >> 1;
/** 能表示的最小正数，用于避免除零 */
export const EPSILON: Fx = 1;

export function fromInt(n: number): Fx {
  return (n << FRAC_BITS) | 0;
}

/**
 * 浮点转定点。只允许在「配置表 / 初始化 / 从外部输入取值」时调用，
 * tick 循环内部不得出现浮点，否则确定性无从保证。
 */
export function fromFloat(f: number): Fx {
  return Math.round(f * ONE) | 0;
}

/** 定点转浮点。只给渲染层和调试输出用。 */
export function toFloat(a: Fx): number {
  return a / ONE;
}

/** 向下取整到整数（负数也向下，保持与位移语义一致） */
export function floorToInt(a: Fx): number {
  return a >> FRAC_BITS;
}

export function roundToInt(a: Fx): number {
  return (a + HALF) >> FRAC_BITS;
}

/**
 * 定点乘法。
 *
 * 直接写 a * b 会得到最大 2^62 的中间结果，超出 double 能精确表示的 2^53，
 * 于是把两个操作数拆成高低 16 位分别相乘再拼回来，全过程每一项都 < 2^47，精确无误差。
 * 结果等价于 floor(a * b / 2^16)。
 */
export function mul(a: Fx, b: Fx): Fx {
  const ah = a >> FRAC_BITS;
  const al = a & 0xffff;
  const bh = b >> FRAC_BITS;
  const bl = b & 0xffff;
  return (((ah * bh) << FRAC_BITS) + ah * bl + al * bh + ((al * bl) >>> FRAC_BITS)) | 0;
}

/**
 * 定点除法。a 是 int32，a * ONE 最大 2^47，double 可精确表示，
 * 而 IEEE-754 的除法结果是标准强制规定的，跨平台一致。
 */
export function div(a: Fx, b: Fx): Fx {
  if (b === 0) return a >= 0 ? 0x7fffffff : -0x7fffffff;
  return Math.trunc((a * ONE) / b) | 0;
}

/**
 * 定点开方，返回 floor(sqrt(a))。
 *
 * Math.sqrt 在规范里只承诺「近似值」，所以仅用它取初值，
 * 再用整数比较把结果修正到精确的下取整，这样不依赖任何平台的浮点实现细节。
 */
export function sqrt(a: Fx): Fx {
  if (a <= 0) return 0;
  const n = a * ONE; // < 2^47，精确
  let x = Math.floor(Math.sqrt(n));
  while (x > 0 && x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x | 0;
}

export function abs(a: Fx): Fx {
  return a < 0 ? -a : a;
}

export function min(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

export function max(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

export function clamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

export function sign(a: Fx): number {
  return a > 0 ? 1 : a < 0 ? -1 : 0;
}
