/**
 * 判断联机会话离开时是否应记本方 abandoned 失败。
 * 匹配未开局、已有权威结算、或对手离开时都不记。
 */
export function shouldRecordVersusAbandon(flags: {
  matchStarted: boolean;
  battleRecorded: boolean;
  peerLeft: boolean;
}): boolean {
  return flags.matchStarted && !flags.battleRecorded && !flags.peerLeft;
}
