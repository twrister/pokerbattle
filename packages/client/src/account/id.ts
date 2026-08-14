/** 默认名后缀字母表；36 进制比十六进制观感更散。 */
const NAME_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NAME_SUFFIX_LENGTH = 8;
const LEGACY_SUFFIX_LENGTH = 4;

/** 生成稳定设备/记录 ID；优先使用浏览器 UUID。 */
export function createAccountId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 默认展示名：完整设备 ID 哈希成 8 位后缀，避免只截前缀导致撞车。 */
export function defaultDisplayName(deviceAccountId: string): string {
  const h1 = fnv1a(deviceAccountId);
  const h2 = fnv1a(`${deviceAccountId}#`);
  const half = NAME_SUFFIX_LENGTH / 2;
  return `玩家-${toBase36Fixed(h1, half)}${toBase36Fixed(h2, half)}`;
}

/** 仍是建档默认名则视为未自定义，用于首次开局改名引导。 */
export function isDefaultDisplayName(profile: {
  deviceAccountId: string;
  displayName: string;
}): boolean {
  return (
    profile.displayName === defaultDisplayName(profile.deviceAccountId) ||
    profile.displayName === legacyDefaultDisplayName(profile.deviceAccountId)
  );
}

/** 旧版默认名：玩家 + 设备 ID 前 4 位十六进制，供已落盘档案继续识别。 */
function legacyDefaultDisplayName(deviceAccountId: string): string {
  const short = deviceAccountId.replace(/-/g, '').slice(0, LEGACY_SUFFIX_LENGTH).toUpperCase();
  return `玩家-${short || '0000'}`;
}

/** FNV-1a 32 位；双种子哈希时换输入再调一次即可。 */
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 把 32 位哈希编成固定长度的 36 进制大写串。 */
function toBase36Fixed(value: number, length: number): string {
  let n = value >>> 0;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out = NAME_ALPHABET[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return out;
}
