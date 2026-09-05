import type { Fx } from '../math/fixed.js';

/** 单席累计输出：对基地 / 对其余敌军（含箭塔）。 */
export interface SlotDamageStats {
  toCastle: Fx;
  toUnits: Fx;
}

/** 2v2 最多四席；1v1 只用 0/1。 */
export const SLOT_DAMAGE_COUNT = 4;

const EMPTY_SLOT_DAMAGE: Readonly<SlotDamageStats> = { toCastle: 0, toUnits: 0 };

/** 空账本，供越界席位查询，避免调用方再做空判断。 */
export function emptySlotDamageStats(): Readonly<SlotDamageStats> {
  return EMPTY_SLOT_DAMAGE;
}

/** 开战或清场时用的可变四席账本。 */
export function createSlotDamageLedger(count = SLOT_DAMAGE_COUNT): SlotDamageStats[] {
  const ledger: SlotDamageStats[] = [];
  for (let i = 0; i < count; i += 1) {
    ledger.push({ toCastle: 0, toUnits: 0 });
  }
  return ledger;
}

/** 就地清零，避免重开时换数组引用。 */
export function resetSlotDamageLedger(ledger: SlotDamageStats[]): void {
  for (const stats of ledger) {
    stats.toCastle = 0;
    stats.toUnits = 0;
  }
}
