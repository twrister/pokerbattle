import type { Command, MatchMode } from '@pb/sim';
import { CommandKind, type MatchState, slotFaction } from '@pb/sim';

/**
 * 强制指令阵营/席位与座位一致，其余规则转调 MatchState.validate。
 * 非法指令返回 false，由房间静默丢弃并打日志。
 */
export function validateSeatCommand(
  match: MatchState,
  seat: number,
  command: Command,
): boolean {
  const seatFaction = slotFaction(seat, match.mode);
  if (command.faction !== seatFaction) return false;
  if (command.slot !== undefined && command.slot !== seat) return false;
  // 联机只接受出牌意图，禁止客户端直发裸 Spawn 绕过手牌校验
  if (command.kind === CommandKind.Spawn || command.kind === CommandKind.PlaceBuilding) {
    return false;
  }
  if (command.kind === CommandKind.PlayFormation || command.kind === CommandKind.ClaimCastlePack) {
    return match.validate({ ...command, slot: command.slot ?? seat });
  }
  return false;
}

/** 席位所属队伍：1v1 下 seat === faction；2v2 下 0/1 蓝、2/3 红。 */
export function factionForSeat(seat: number, mode: MatchMode = '1v1') {
  return slotFaction(seat, mode);
}
