import type { Faction, MatchResult } from '@pb/sim';
import type { BattleEndReason, BattleOutcome, RecordBattleInput } from './types.js';

/**
 * 将权威 MatchResult 转为本地玩家视角的对战写入参数。
 * 不含 abandoned；中途退出由调用方单独构造。
 */
export function battleInputFromMatchResult(
  result: MatchResult,
  playerFaction: Faction,
  mode: 'solo' | 'versus',
): RecordBattleInput {
  const outcome: BattleOutcome =
    result.winner === null ? 'draw' : result.winner === playerFaction ? 'win' : 'loss';
  const reason = result.reason as Exclude<BattleEndReason, 'abandoned'>;
  return { mode, outcome, reason };
}
