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

/**
 * 真人对战进行中点返回才二次确认；观战、单机、已结算直接离开。
 */
export function shouldConfirmVersusLeave(flags: {
  versus: boolean;
  spectating: boolean;
  matchEnded: boolean;
}): boolean {
  return flags.versus && !flags.spectating && !flags.matchEnded;
}
