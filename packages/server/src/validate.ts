import type { Command } from '@pb/sim';
import { CommandKind, Faction, type MatchState } from '@pb/sim';

/**
 * 强制指令阵营与座位一致，其余规则转调 MatchState.validate。
 * 非法指令返回 false，由房间静默丢弃并打日志。
 */
export function validateSeatCommand(
  match: MatchState,
  seatFaction: Faction,
  command: Command,
): boolean {
  if (command.faction !== seatFaction) return false;
  // 联机只接受出牌意图，禁止客户端直发裸 Spawn 绕过手牌校验
  if (command.kind === CommandKind.Spawn || command.kind === CommandKind.PlaceBuilding) {
    return false;
  }
  if (command.kind === CommandKind.PlayFormation || command.kind === CommandKind.ClaimCastlePack) {
    return match.validate(command);
  }
  return false;
}

/** seat 0 = Blue，seat 1 = Red。 */
export function factionForSeat(seat: number): Faction {
  return seat === 0 ? Faction.Blue : Faction.Red;
}
