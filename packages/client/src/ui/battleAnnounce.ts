import {
  NORMAL_PHASE_TICKS,
  OVERTIME_END_TICKS,
  TICK_RATE,
  type MatchPhase,
  type MatchState,
} from '@pb/sim';
import { matchPhaseLabel } from './matchPhaseLabel.js';

export interface BattleAnnounceHandle {
  /** 每帧根据阶段边沿与剩余秒数弹出提示。 */
  tick(match: MatchState): void;
  /** 手动弹出；同文案且仍在展示中时不重播，避免闪烁。 */
  show(text: string, opts?: { holdMs?: number }): void;
  hide(): void;
  /** 离开对局时清空边沿状态。 */
  reset(): void;
}

const PHASE_HOLD_MS = 1200;
const COUNTDOWN_HOLD_MS = 900;

/** 局内居中文字提示：阶段切换与最后 10 秒倒计时共用。 */
export function createBattleAnnounce(): BattleAnnounceHandle {
  const root = requiredElement<HTMLElement>('#battle-announce');
  const textEl = requiredElement<HTMLElement>('#battle-announce-text');

  let lastPhase: MatchPhase | null = null;
  let lastCountdownSec: number | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let showingText = '';

  const clearHideTimer = (): void => {
    if (!hideTimer) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const hide = (): void => {
    clearHideTimer();
    root.classList.add('is-hidden');
    root.classList.remove('is-visible');
    showingText = '';
  };

  const show = (text: string, opts?: { holdMs?: number }): void => {
    if (!text) return;
    // 同一文案仍在展示时不打断动画，避免每帧重播
    if (showingText === text && !root.classList.contains('is-hidden')) return;
    clearHideTimer();
    showingText = text;
    textEl.textContent = text;
    root.classList.remove('is-hidden');
    // 强制重触发 CSS 动画
    root.classList.remove('is-visible');
    void root.offsetWidth;
    root.classList.add('is-visible');
    const holdMs = opts?.holdMs ?? PHASE_HOLD_MS;
    hideTimer = setTimeout(hide, holdMs);
  };

  return {
    show,
    hide,
    reset() {
      lastPhase = null;
      lastCountdownSec = null;
      hide();
    },
    tick(match) {
      if (match.phase !== lastPhase) {
        const label = matchPhaseLabel(match.phase);
        if (label) show(label, { holdMs: PHASE_HOLD_MS });
        lastPhase = match.phase;
        // 阶段刚切换时不叠倒数，避免与「加时阶段」等同 tick 抢显
        if (match.phase === 'overtime' || match.phase === 'double_speed') {
          lastCountdownSec = null;
        }
        return;
      }

      if (match.phase === 'ended' || match.result) return;

      const deadline = match.phase === 'overtime' ? OVERTIME_END_TICKS : NORMAL_PHASE_TICKS;
      const remainingTicks = Math.max(0, deadline - match.world.tick);
      const seconds = Math.ceil(remainingTicks / TICK_RATE);
      if (seconds >= 1 && seconds <= 10) {
        if (seconds !== lastCountdownSec) {
          lastCountdownSec = seconds;
          show(String(seconds), { holdMs: COUNTDOWN_HOLD_MS });
        }
        return;
      }
      lastCountdownSec = null;
    },
  };
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
