/** 生成稳定设备/记录 ID；优先使用浏览器 UUID。 */
export function createAccountId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 默认展示名：玩家 + 设备 ID 短前缀，降低首次感知。 */
export function defaultDisplayName(deviceAccountId: string): string {
  const short = deviceAccountId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `玩家-${short || '0000'}`;
}
