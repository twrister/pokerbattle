import { Faction } from '../entity/unit.js';

/** 对局人数模式：1v1 两席，2v2 四席。 */
export type MatchMode = '1v1' | '2v2';

const SLOTS_1V1 = [0, 1] as const;
const SLOTS_2V2 = [0, 1, 2, 3] as const;
const BLUE_SLOTS_2V2 = [0, 1] as const;
const RED_SLOTS_2V2 = [2, 3] as const;

/** 该模式下的席位数。 */
export function slotCount(mode: MatchMode): number {
  return mode === '2v2' ? 4 : 2;
}

/** 席位所属队伍：1v1 下 slot === faction；2v2 下 0/1 蓝、2/3 红。 */
export function slotFaction(slot: number, mode: MatchMode): Faction {
  if (mode === '2v2') return slot <= 1 ? Faction.Blue : Faction.Red;
  return slot === 0 ? Faction.Blue : Faction.Red;
}

/** 指定队伍在该模式下的全部席位。 */
export function teamSlots(faction: Faction, mode: MatchMode): readonly number[] {
  if (mode === '2v2') return faction === Faction.Blue ? BLUE_SLOTS_2V2 : RED_SLOTS_2V2;
  return faction === Faction.Blue ? [SLOTS_1V1[0]] : [SLOTS_1V1[1]];
}

/** 同队另一席；1v1 无队友。 */
export function teammateSlot(slot: number, mode: MatchMode): number | null {
  if (mode !== '2v2') return null;
  if (slot === 0) return 1;
  if (slot === 1) return 0;
  if (slot === 2) return 3;
  if (slot === 3) return 2;
  return null;
}

/** 合法席位范围校验。 */
export function isValidSlot(slot: number, mode: MatchMode): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < slotCount(mode);
}

/** 该模式下全部席位，按升序。 */
export function allSlots(mode: MatchMode): readonly number[] {
  return mode === '2v2' ? SLOTS_2V2 : SLOTS_1V1;
}
