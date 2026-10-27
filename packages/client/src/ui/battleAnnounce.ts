import { TICK_RATE, type MatchPhase, type MatchState } from '@pb/sim';
import { sfx } from '../audio/sfx.js';

export interface BattleAnnounceShowOpts {
  holdMs?: number;
  /** 倒计时数字用更夸张的放大动画，与阶段文案区分。 */
  countdown?: boolean;
  /** 最后几秒：数字改红，配合更高更长的提示音。 */
  urgent?: boolean;
}

export interface BattleAnnounceHandle {
  /** 每帧根据阶段边沿与剩余秒数弹出提示。 */
  tick(match: MatchState): void;
  /** 手动弹出；同文案且仍在展示中时不重播，避免闪烁。 */
  show(text: string, opts?: BattleAnnounceShowOpts): void;
  hide(): void;
  /** 离开对局时清空边沿状态，并把各阶段读秒恢复为默认。 */
  reset(): void;
  /** 覆盖某阶段末尾的读秒秒数；0 关闭该阶段读秒。战役常规阶段借此读秒。 */
  setCountdownSeconds(phase: MatchPhase, seconds: number): void;
  /**
   * 覆盖某阶段的开场播报文案；空串表示该阶段不播报。
   * 无基地关卡不能再说「摧毁对方城堡」，改由关卡自己下一句。
   */
  setEnterText(phase: MatchPhase, text: string): void;
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
/** 进入红色紧迫态的秒数；最后 3 秒留出反应时间比只红 1 秒更有用。 */
export const COUNTDOWN_URGENT_SECONDS = 3;
/** 10~4 秒的提示音：中频短音。 */
const COUNTDOWN_TONE = { frequency: 880, durationMs: 110, volume: 0.22 };
/** 3~1 秒的提示音：更高更响，把紧迫感推上来。 */
const COUNTDOWN_TONE_URGENT = { frequency: 1320, durationMs: 160, volume: 0.28 };
export const TEAMMATE_DOWN_ANNOUNCE = '队友阵亡';
export const BASE_DOWN_ANNOUNCE = '基地陷落';

/** 局内居中文字提示：阶段切换与最后 10 秒倒计时共用。 */
export function createBattleAnnounce(): BattleAnnounceHandle {
  const root = requiredElement<HTMLElement>('#battle-announce');
  const textEl = requiredElement<HTMLElement>('#battle-announce-text');

  let lastPhase: MatchPhase | null = null;
  let lastCountdownSec: number | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let showingText = '';
  /** 各阶段读秒秒数，默认取 PHASE_ANNOUNCE_RULES，可被 setCountdownSeconds 临时覆盖。 */
  const countdownSeconds = new Map<MatchPhase, number>();
  const countdownFor = (phase: MatchPhase): number =>
    countdownSeconds.get(phase) ?? PHASE_ANNOUNCE_RULES[phase].countdownLastSeconds;
  /** 各阶段开场播报文案覆盖；未登记时用 PHASE_ANNOUNCE_RULES。 */
  const enterTexts = new Map<MatchPhase, string>();
  const enterTextFor = (phase: MatchPhase): string =>
    enterTexts.get(phase) ?? PHASE_ANNOUNCE_RULES[phase].enterText;

  const clearHideTimer = (): void => {
    if (!hideTimer) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const hide = (): void => {
    clearHideTimer();
    root.classList.add('is-hidden');
    root.classList.remove('is-visible', 'is-countdown', 'is-urgent');
    showingText = '';
  };

  const show = (text: string, opts?: BattleAnnounceShowOpts): void => {
    if (!text) return;
    // 同一文案仍在展示时不打断动画，避免每帧重播
    if (showingText === text && !root.classList.contains('is-hidden')) return;
    clearHideTimer();
    showingText = text;
    // 播报音只在阶段切换时响；倒计时数字走 playTone 的合成短音，避免素材音每秒重复
    if (!opts?.countdown) sfx.play('ui_announce');
    textEl.textContent = text;
    root.classList.toggle('is-countdown', Boolean(opts?.countdown));
    root.classList.toggle('is-urgent', Boolean(opts?.urgent));
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
      // 战役的读秒与开场文案覆盖不能泄漏到联机/观战/回放
      countdownSeconds.clear();
      enterTexts.clear();
      hide();
    },
    setCountdownSeconds(phase, seconds) {
      countdownSeconds.set(phase, Math.max(0, Math.floor(seconds)));
    },
    setEnterText(phase, text) {
      enterTexts.set(phase, text);
    },
    tick(match) {
      if (match.phase !== lastPhase) {
        const enterText = enterTextFor(match.phase);
        if (enterText) show(enterText, { holdMs: PHASE_HOLD_MS });
        lastPhase = match.phase;
        // 切入时清空倒数，避免与阶段名同帧抢显
        lastCountdownSec = null;
        return;
      }

      if (match.phase === 'ended' || match.result) return;
      const lastSeconds = countdownFor(match.phase);
      if (lastSeconds <= 0) {
        lastCountdownSec = null;
        return;
      }

      const remainingTicks = Math.max(0, match.getPhaseDeadlineTick() - match.world.tick);
      const seconds = Math.ceil(remainingTicks / TICK_RATE);
      if (seconds >= 1 && seconds <= lastSeconds) {
        if (seconds !== lastCountdownSec) {
          lastCountdownSec = seconds;
          const urgent = seconds <= COUNTDOWN_URGENT_SECONDS;
          show(String(seconds), { holdMs: COUNTDOWN_HOLD_MS, countdown: true, urgent });
          // 声音跟数字一起走：每秒一声，最后 3 秒换更高更长的音
          sfx.playTone(urgent ? COUNTDOWN_TONE_URGENT : COUNTDOWN_TONE);
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
