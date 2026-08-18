import { TICK_RATE, type MatchPhase, type MatchState } from '@pb/sim';

export interface BattleAnnounceShowOpts {
  holdMs?: number;
  /** 倒计时数字用更夸张的放大动画，与阶段文案区分。 */
  countdown?: boolean;
}

export interface BattleAnnounceHandle {
  /** 每帧根据阶段边沿与剩余秒数弹出提示。 */
  tick(match: MatchState): void;
  /** 手动弹出；同文案且仍在展示中时不重播，避免闪烁。 */
  show(text: string, opts?: BattleAnnounceShowOpts): void;
  hide(): void;
  /** 离开对局时清空边沿状态。 */
  reset(): void;
}

/** 阶段切入文案与是否在本阶段末尾倒数。 */
export interface PhaseAnnounceRule {
  enterText: string;
  countdownLastSeconds: number;
}

export const PHASE_ANNOUNCE_RULES: Record<MatchPhase, PhaseAnnounceRule> = {
  normal: { enterText: '摧毁对方城堡', countdownLastSeconds: 0 },
  // 播报文案比 HUD 阶段名更口语，点出发牌/战斗节奏变化
  double_speed: { enterText: '加速发牌阶段', countdownLastSeconds: 0 },
  final: { enterText: '决胜阶段 战斗加速', countdownLastSeconds: 10 },
  settlement: { enterText: '结算阶段 停止发牌', countdownLastSeconds: 10 },
  ended: { enterText: '', countdownLastSeconds: 0 },
};

/** 阶段文案停留；需与 CSS `battle-announce-pop` 时长对齐。 */
const PHASE_HOLD_MS = 2800;
/** 倒计时数字约 1 秒一换，略长于间隔以免提前淡出。 */
const COUNTDOWN_HOLD_MS = 1400;
export const TEAMMATE_DOWN_ANNOUNCE = '队友阵亡 · 发牌加速';
export const BASE_DOWN_ANNOUNCE = '基地陷落 · 无法出牌';

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
    root.classList.remove('is-visible', 'is-countdown');
    showingText = '';
  };

  const show = (text: string, opts?: BattleAnnounceShowOpts): void => {
    if (!text) return;
    // 同一文案仍在展示时不打断动画，避免每帧重播
    if (showingText === text && !root.classList.contains('is-hidden')) return;
    clearHideTimer();
    showingText = text;
    textEl.textContent = text;
    root.classList.toggle('is-countdown', Boolean(opts?.countdown));
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
      const rule = PHASE_ANNOUNCE_RULES[match.phase];
      if (match.phase !== lastPhase) {
        if (rule.enterText) show(rule.enterText, { holdMs: PHASE_HOLD_MS });
        lastPhase = match.phase;
        // 切入时清空倒数，避免与阶段名同帧抢显
        lastCountdownSec = null;
        return;
      }

      if (match.phase === 'ended' || match.result) return;
      if (rule.countdownLastSeconds <= 0) {
        lastCountdownSec = null;
        return;
      }

      const remainingTicks = Math.max(0, match.getPhaseDeadlineTick() - match.world.tick);
      const seconds = Math.ceil(remainingTicks / TICK_RATE);
      if (seconds >= 1 && seconds <= rule.countdownLastSeconds) {
        if (seconds !== lastCountdownSec) {
          lastCountdownSec = seconds;
          show(String(seconds), { holdMs: COUNTDOWN_HOLD_MS, countdown: true });
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
