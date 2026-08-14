import type { MatchPhase } from '@pb/sim';

/** 阶段展示文案；ended 由结算弹窗承接，此处返回空。 */
export function matchPhaseLabel(phase: MatchPhase): string {
  switch (phase) {
    case 'normal':
      return '常规阶段';
    case 'double_speed':
      return '倍速阶段';
    case 'final':
      return '决胜阶段';
    case 'ended':
      return '';
    default:
      return '';
  }
}
