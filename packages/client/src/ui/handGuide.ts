import type { StageDef } from '@pb/sim';
import type { PlayerProfileStats } from '../account/types.js';

/** 弱引导的两种手势：点选一张手牌、把阵型卡拖到战场。 */
export type HandGuideGesture = 'tap' | 'drag';

/** 空闲多久后播一轮提示；统一 6 秒，两种手势共用同一节奏。 */
const IDLE_HINT_MS = 6000;
/** 手指淡入/淡出时长，毫秒。 */
const FADE_IN_MS = 180;
const FADE_OUT_MS = 240;
/** 按下（指尖贴屏）的过渡时长。 */
const PRESS_MS = 200;
/** 点选手势按下后原地停顿时长，让玩家看清该点哪张牌。 */
const TAP_HOLD_MS = 520;
/** 拖拽手势的移动时长。 */
const DRAG_MOVE_MS = 900;
/** 移动结束到抬起之间的停顿，让玩家看清落点。 */
const HOLD_MS = 220;
/** 按下时的缩放，模拟指尖压屏。 */
const PRESS_SCALE = 0.86;
/** 手指元素量不到尺寸时的兜底半宽，保证动画仍能居中。 */
const FALLBACK_HALF = 36;

interface Point {
  x: number;
  y: number;
}

/** 每帧喂给引导器的面板状态，决定这轮播哪种手势。 */
export interface HandGuideContext {
  /** 当前是否允许提示：对局进行中、未锁定出牌且该局适用弱引导时为 true。 */
  canGuide: boolean;
  /** 是否已有正式选中的牌。 */
  hasSelection: boolean;
  /** 是否已列出可用阵型按钮（即选出了有效牌型，只差拖出去）。 */
  formationVisible: boolean;
}

export interface HandGuideOptions {
  /**
   * 是否启用；false 时返回空壳，用于联机对局与非教学关卡。
   * 缺省 true（直接使用引导器时），handPanel 会显式按该局是否需要传入。
   */
  enabled?: boolean;
  /** 空闲多久开始提示（毫秒）；缺省 6 秒，测试可缩短。 */
  idleMs?: number;
  /** 虚拟手指节点；缺省查 #hand-guide-finger，找不到则整个引导降级为空操作。 */
  fingerElement?: HTMLElement | null;
  /** 手牌容器，用于量第一张牌的位置。 */
  cardsElement?: HTMLElement | null;
  /** 阵型按钮容器，用于量拖拽起点。 */
  formationsElement?: HTMLElement | null;
  /** 战场参考区，用于量拖拽落点。 */
  battlefieldElement?: HTMLElement | null;
}

export interface HandGuideHandle {
  /** 每帧推进空闲计时，达到阈值且条件合适就播一轮。 */
  tick: (deltaMs: number, context: HandGuideContext) => void;
  /** 玩家一动手就立刻收回手指并重新计时。 */
  notifyInteraction: () => void;
  /** 立即收起当前手势（收起不改计时，交给调用方决定是否重计）。 */
  hide: () => void;
  dispose: () => void;
}

/**
 * 虚拟手指弱引导：长时间没操作时，用一段手指动效演示下一步该做什么，不放任何文字。
 *
 * 设计约束：
 * - 只做「提示」不代替操作，节点全 pointer-events:none，播动画期间玩家随时可以正常操作；
 * - 面板状态由调用方每帧传入，引导器不反向依赖 handPanel 内部字段，便于单测；
 * - 一轮播完重新计满 6 秒再考虑下一轮，避免连续晃动干扰操作。
 */
export function createHandGuide(options: HandGuideOptions = {}): HandGuideHandle {
  const idleHintMs = Math.max(options.idleMs ?? IDLE_HINT_MS, 0);
  const foundFinger =
    options.fingerElement ?? document.querySelector<HTMLElement>('#hand-guide-finger');
  const cards = options.cardsElement ?? document.querySelector<HTMLElement>('#hand-cards');
  const formations =
    options.formationsElement ?? document.querySelector<HTMLElement>('#hand-formations');
  const battlefield = options.battlefieldElement ?? document.querySelector<HTMLElement>('#app');

  // 未启用或没有手指节点（例如别的页面复用面板）时直接降级，调用方无需判空
  if (options.enabled === false || !foundFinger) {
    return { tick() {}, notifyInteraction() {}, hide() {}, dispose() {} };
  }
  // 收窄成非空常量，闭包里就不必反复判空
  const finger: HTMLElement = foundFinger;

  let idleMs = 0;
  let visible = false;
  let disposed = false;
  let roundTimer: number | null = null;
  let pressTimer: number | null = null;
  let releaseTimer: number | null = null;
  let roundAnimation: Animation | null = null;

  /** 收起手指并清掉本轮动画/定时器，不影响空闲计时。 */
  function clearRound(): void {
    if (roundTimer !== null) {
      window.clearTimeout(roundTimer);
      roundTimer = null;
    }
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (releaseTimer !== null) {
      window.clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    roundAnimation?.cancel();
    roundAnimation = null;
    visible = false;
    finger.classList.remove('is-visible', 'is-pressed', 'is-tap', 'is-drag');
  }

  /** 元素中心点；量不到真实布局时退回 0，交由调用方做退化处理。 */
  function centerOf(element: HTMLElement): Point {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /**
   * 点选手势的落点：第一张手牌的中心。
   * 手上没有牌时返回 null（提示无从下手）；布局还没量出来（首帧或测试环境）时退回手牌栏左侧 30% 处。
   */
  function tapTarget(): Point | null {
    if (!cards) return null;
    const first = cards.querySelector<HTMLElement>('.playing-card');
    if (!first) return null;
    const center = centerOf(first);
    if (center.x !== 0 || center.y !== 0) return center;
    const rect = cards.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const y = rect.height > 0 ? rect.top + rect.height * 0.72 : window.innerHeight * 0.8;
    return { x: rect.left + width * 0.3, y };
  }

  /** 拖拽手势：从第一个阵型按钮拖到战场中部（落在手牌栏上方，不会被 HUD 挡住）。 */
  function dragPath(): { from: Point; to: Point } | null {
    if (!formations) return null;
    const button = formations.querySelector<HTMLElement>('.formation-option');
    if (!button) return null;
    const rect = battlefield?.getBoundingClientRect() ?? null;
    const usable = rect && rect.width > 0 && rect.height > 0;
    // 0.58 高度落在己方半场且在 HUD 之上：既有真实可放置点，手指也不会被手牌挡住
    const to = usable
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.58 }
      : { x: window.innerWidth / 2, y: window.innerHeight * 0.58 };
    return { from: centerOf(button), to };
  }

  /** 当前该播哪种手势；已选牌但拼不出牌型时不提示，避免教错动作。 */
  function pickGesture(context: HandGuideContext): HandGuideGesture | null {
    if (context.formationVisible) return 'drag';
    if (!context.hasSelection && tapTarget()) return 'tap';
    return null;
  }

  /** 把点换算成「质心对准该点」的 transform，半宽保证缩放时按压点不漂移。 */
  function frameAt(point: Point, half: number, scale: number): string {
    return `translate(${point.x - half}px, ${point.y - half}px) scale(${scale})`;
  }

  /**
   * 播一轮手势并返回整轮时长。
   * 视觉交给 Web Animations API，计时始终走 setTimeout，这样测试可用假时钟精确推进。
   */
  function playRound(gesture: HandGuideGesture, from: Point, to: Point): number {
    // 点选原地按下不做位移，拖拽才需要移动一段距离；两者靠不同的停顿表达「该做这一步」
    const moveMs = gesture === 'tap' ? 0 : DRAG_MOVE_MS;
    const holdMs = gesture === 'tap' ? TAP_HOLD_MS : HOLD_MS;
    const total = FADE_IN_MS + PRESS_MS + moveMs + holdMs + FADE_OUT_MS;
    const half = finger.offsetWidth > 0 ? finger.offsetWidth / 2 : FALLBACK_HALF;
    const at = (ms: number): number => Math.min(1, ms / total);
    const pressAt = FADE_IN_MS + PRESS_MS;
    const arrivedAt = pressAt + moveMs;

    if (typeof finger.animate === 'function') {
      const keyframes: Keyframe[] = [
        { offset: 0, opacity: 0, transform: frameAt(from, half, 1) },
        { offset: at(FADE_IN_MS), opacity: 1, transform: frameAt(from, half, 1) },
        { offset: at(pressAt), opacity: 1, transform: frameAt(from, half, PRESS_SCALE) },
      ];
      // 点选时起点即终点，不插位移关键帧，避免同 offset 出现两段 transform
      if (moveMs > 0) {
        keyframes.push({ offset: at(arrivedAt), opacity: 1, transform: frameAt(to, half, PRESS_SCALE) });
      }
      keyframes.push(
        // 抬手前停一下：点选要看清楚点的是哪张牌，拖拽要看清楚落点
        { offset: at(arrivedAt + holdMs), opacity: 1, transform: frameAt(to, half, PRESS_SCALE) },
        { offset: at(total - FADE_OUT_MS), opacity: 1, transform: frameAt(to, half, 1) },
        { offset: 1, opacity: 0, transform: frameAt(to, half, 1) },
      );
      roundAnimation = finger.animate(keyframes, { duration: total, easing: 'ease-in-out' });
    }
    // 按下反馈跟着指尖走：按下时收紧贴图，抬手时回弹
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      finger.classList.add('is-pressed');
    }, pressAt);
    releaseTimer = window.setTimeout(() => {
      releaseTimer = null;
      finger.classList.remove('is-pressed');
    }, arrivedAt + holdMs);
    return total;
  }

  /** 取当前手势的起止点：点选是同一张牌，拖拽是从阵型按钮到战场。 */
  function gesturePath(gesture: HandGuideGesture): { from: Point; to: Point } | null {
    if (gesture === 'tap') {
      const target = tapTarget();
      return target ? { from: target, to: target } : null;
    }
    return dragPath();
  }

  /** 开始一轮提示：亮出手指、播动画，并按整轮时长安排收尾。 */
  function startRound(gesture: HandGuideGesture): void {
    const path = gesturePath(gesture);
    if (!path) return;
    clearRound();
    visible = true;
    finger.classList.add('is-visible', gesture === 'tap' ? 'is-tap' : 'is-drag');
    const total = playRound(gesture, path.from, path.to);
    roundTimer = window.setTimeout(() => {
      roundTimer = null;
      clearRound();
      // 一轮结束重新计满空闲，仍在发呆就隔 6 秒再播一次
      idleMs = 0;
    }, total);
  }

  return {
    tick(deltaMs, context) {
      if (disposed) return;
      if (!context.canGuide) {
        clearRound();
        idleMs = 0;
        return;
      }
      // 播放期间不计时，避免一轮未结束又叠下一轮
      if (visible) return;
      idleMs += Math.max(deltaMs, 0);
      if (idleMs < idleHintMs) return;
      const gesture = pickGesture(context);
      if (!gesture) {
        // 条件暂不满足时停在门槛上，一旦条件成立立刻播，不必再等一轮
        idleMs = idleHintMs;
        return;
      }
      startRound(gesture);
    },
    notifyInteraction() {
      if (disposed) return;
      clearRound();
      idleMs = 0;
    },
    hide() {
      if (disposed) return;
      clearRound();
    },
    dispose() {
      disposed = true;
      clearRound();
    },
  };
}

/**
 * 需要手牌弱引导的教学关序号：第 1 关首次出兵、第 2 关凑炸弹、第 3 关万能牌。
 * 第 4 关起是残局解谜，演示手指会直接泄露解法，所以不再提示。
 */
const GUIDE_STAGE_INDEXES: readonly number[] = [1, 2, 3];

/**
 * 该局是否需要手牌弱引导。
 *
 * - 战役局只在前三关教学关提示，残局关不提示；
 * - 普通人机则看档案：还没有任何对战与关卡记录时视为首次上手，整个账号只在这一局提示。
 */
export function shouldShowHandGuide(
  stage: Pick<StageDef, 'index'> | null,
  stats: PlayerProfileStats,
): boolean {
  if (stage) return GUIDE_STAGE_INDEXES.includes(stage.index);
  const battles = stats.wins + stats.losses + stats.draws;
  return battles === 0 && stats.stageAttempts === 0;
}
