import { Faction, opposingFaction, TICK_RATE, toFloat, type MatchState } from '@pb/sim';
import { matchPhaseLabel } from './matchPhaseLabel.js';

export interface BattleHudContext {
  localFaction: Faction;
  localName: string;
  opponentName: string;
  /** 本机席位；缺省等于 localFaction，兼容 1v1。 */
  localSlot?: number;
  teammateName?: string;
  teammateSlot?: number | null;
  opponentSlot?: number;
  extraOpponentName?: string;
  extraOpponentSlot?: number | null;
}

export interface BattleHudHandle {
  show(): void;
  hide(): void;
  setContext(context: BattleHudContext): void;
  /**
   * 显示/隐藏双方主堡血条。
   * 战役里存在没有主堡的关卡，此时血条只有 0 / 0，必须整块收起。
   */
  setCastleBarsVisible(visible: boolean): void;
  /**
   * 切换无限防守模式：隐藏双方血条与对手手牌，中间只显示波次与出兵进度条。
   * wave 为空表示退出该模式，恢复常规对局显示。
   */
  setEndlessMode(wave: { wave: number; boss: boolean } | null): void;
  /** 每帧刷新出兵进度与剩余敌人数；无限模式下由调用方传入。 */
  updateEndlessProgress(progress: { ratio: number; spawnDone: boolean; remaining: number }): void;
  /** 观战人数；0 人时隐藏。 */
  setSpectatorCount(count: number): void;
  /** 观战追帧提示。 */
  setCatchingUp(catchingUp: boolean): void;
  /**
   * 战役关顶部文案（关卡序号 + 关卡名）。
   * 非空时常规阶段中栏改显它；null 退回归还阶段文案，联机/回放/观战都传 null。
   */
  setStageLabel(label: string | null): void;
  update(match: MatchState): void;
}

interface CastleHudCache {
  text: string;
  width: string;
  markLeft: string;
  markTitle: string;
  protect: boolean;
}

/** 顶部计时器进入警戒色的剩余帧数；与居中倒计时的 10 秒对齐。 */
const TIMER_WARNING_TICKS = TICK_RATE * 10;

interface TeamTotalCache {
  text: string;
  width: string;
}

/** 将共享仿真状态投射到顶部信息条；左右始终是「己方蓝 / 对阵红」。 */
export function createBattleHud(): BattleHudHandle {
  const root = requiredElement<HTMLElement>('#battle-hud');
  const selfName = requiredElement<HTMLElement>('#battle-self-name');
  const oppName = requiredElement<HTMLElement>('#battle-opp-name');
  const selfHp = requiredElement<HTMLElement>('#battle-self-hp');
  const oppHp = requiredElement<HTMLElement>('#battle-opp-hp');
  const selfBar = requiredElement<HTMLElement>('#battle-self-bar');
  const oppBar = requiredElement<HTMLElement>('#battle-opp-bar');
  const selfTrack = requiredElement<HTMLElement>('#battle-self-track');
  const oppTrack = requiredElement<HTMLElement>('#battle-opp-track');
  const selfMark = requiredElement<HTMLElement>('#battle-self-protect-mark');
  const oppMark = requiredElement<HTMLElement>('#battle-opp-protect-mark');
  const allyRoot = document.querySelector<HTMLElement>('#battle-castle-ally');
  const allyName = document.querySelector<HTMLElement>('#battle-ally-name');
  const allyHp = document.querySelector<HTMLElement>('#battle-ally-hp');
  const allyBar = document.querySelector<HTMLElement>('#battle-ally-bar');
  const allyTrack = document.querySelector<HTMLElement>('#battle-ally-track');
  const allyMark = document.querySelector<HTMLElement>('#battle-ally-protect-mark');
  const opp2Root = document.querySelector<HTMLElement>('#battle-castle-opp-b');
  const opp2Name = document.querySelector<HTMLElement>('#battle-opp-b-name');
  const opp2Hp = document.querySelector<HTMLElement>('#battle-opp-b-hp');
  const opp2Bar = document.querySelector<HTMLElement>('#battle-opp-b-bar');
  const opp2Track = document.querySelector<HTMLElement>('#battle-opp-b-track');
  const opp2Mark = document.querySelector<HTMLElement>('#battle-opp-b-protect-mark');
  const selfTeamTotal = document.querySelector<HTMLElement>('#battle-team-self-total');
  const selfTeamHp = document.querySelector<HTMLElement>('#battle-team-self-hp');
  const selfTeamBar = document.querySelector<HTMLElement>('#battle-team-self-bar');
  const oppTeamTotal = document.querySelector<HTMLElement>('#battle-team-opp-total');
  const oppTeamHp = document.querySelector<HTMLElement>('#battle-team-opp-hp');
  const oppTeamBar = document.querySelector<HTMLElement>('#battle-team-opp-bar');
  const phaseLabel = requiredElement<HTMLElement>('#battle-phase-label');
  const timerLabel = requiredElement<HTMLElement>('#battle-timer-label');
  const timer = requiredElement<HTMLElement>('#battle-timer');
  const waveBar = requiredElement<HTMLElement>('#battle-wave-bar');
  const waveTrack = requiredElement<HTMLElement>('#battle-wave-track');
  const waveFill = requiredElement<HTMLElement>('#battle-wave-fill');
  const waveEnemies = requiredElement<HTMLElement>('#battle-wave-enemies');
  const oppHand = requiredElement<HTMLElement>('#battle-opp-hand');
  const spectators = requiredElement<HTMLElement>('#battle-spectators');
  const catchup = requiredElement<HTMLElement>('#battle-catchup');

  let context: BattleHudContext = {
    localFaction: Faction.Blue,
    localName: '玩家',
    opponentName: '电脑',
    localSlot: Faction.Blue,
  };
  const allyCastle: CastleHudCache = emptyCastleCache();
  const opp2Castle: CastleHudCache = emptyCastleCache();
  let lastTick = -1;
  let lastDeadlineTick = -1;
  let lastPhase: MatchState['phase'] | '' = '';
  let lastSelfName = '';
  let lastOppName = '';
  let lastPhaseText = '';
  let lastTimerLabel = '';
  let lastTimerText = '';
  let lastTimerWarning = false;
  let lastOppHandText = '';
  const selfCastle: CastleHudCache = emptyCastleCache();
  const oppCastle: CastleHudCache = emptyCastleCache();
  const selfTeamCache: TeamTotalCache = emptyTeamCache();
  const oppTeamCache: TeamTotalCache = emptyTeamCache();
  /** 无限模式下的波次信息；null 表示常规对局。 */
  let endlessWave: { wave: number; boss: boolean } | null = null;
  /** 战役关顶部文案；null 表示非战役局，中栏回落到阶段名。 */
  let stageLabel: string | null = null;
  let lastWaveText = '';
  let lastWaveFill = '';
  let lastWaveEnemies = '';
  let lastWaveDone = false;

  return {
    show: () => root.classList.remove('is-hidden'),
    hide() {
      root.classList.add('is-hidden');
      lastTick = -1;
      lastDeadlineTick = -1;
      lastPhase = '';
      // 重新开局时先摘掉警戒色，否则上一局的红字会留到新一局
      lastTimerWarning = false;
      timer.classList.remove('is-warning');
      spectators.classList.add('is-hidden');
      catchup.classList.add('is-hidden');
      // 离开对局时清掉无限模式，避免下一场联机/回放还留着波次与进度条
      endlessWave = null;
      root.classList.remove('is-endless');
      // 关卡标题同理：下一局可能是联机或普通人机，不能残留战役文案
      stageLabel = null;
      root.classList.remove('is-stage');
      waveBar.classList.remove('is-boss');
    },
    setEndlessMode(wave) {
      endlessWave = wave;
      // 切换模式时强制下一次 update 重绘中栏，否则脏检查会留着旧文案
      lastTick = -1;
      lastDeadlineTick = -1;
      lastPhase = '';
      root.classList.toggle('is-endless', wave !== null);
      waveBar.classList.toggle('is-boss', wave?.boss === true);
      // 中栏文案在两种模式间切换，缓存必须清空，否则 writeText 会认为没变
      lastPhaseText = '';
      if (!wave) {
        lastWaveText = '';
        lastWaveFill = '';
        lastWaveEnemies = '';
        lastWaveDone = false;
        return;
      }
      writeText(
        phaseLabel,
        `第 ${wave.wave} 波${wave.boss ? '（Boss）' : ''}`,
        (value) => {
          lastWaveText = value;
        },
        lastWaveText,
      );
    },
    updateEndlessProgress(progress) {
      if (!endlessWave) return;
      const ratio = Math.min(1, Math.max(0, progress.ratio));
      const width = `${Math.round(ratio * 100)}%`;
      if (width !== lastWaveFill) {
        lastWaveFill = width;
        waveFill.style.width = width;
      }
      if (progress.spawnDone !== lastWaveDone) {
        lastWaveDone = progress.spawnDone;
        waveTrack.classList.toggle('is-done', progress.spawnDone);
      }
      const enemies = `剩余敌人 ${Math.max(0, progress.remaining | 0)}`;
      writeText(waveEnemies, enemies, (value) => {
        lastWaveEnemies = value;
      }, lastWaveEnemies);
    },
    setSpectatorCount(count) {
      const n = Math.max(0, count | 0);
      spectators.textContent = `观战 ${n}`;
      spectators.classList.toggle('is-hidden', n === 0);
    },
    setCastleBarsVisible(visible) {
      root.classList.toggle('is-no-castle', !visible);
    },
    setCatchingUp(catchingUp) {
      catchup.classList.toggle('is-hidden', !catchingUp);
    },
    setStageLabel(label) {
      stageLabel = label;
      root.classList.toggle('is-stage', label !== null);
      // 文案可能变长变短，清脏检查缓存让下一帧一定重写中栏
      lastPhaseText = '';
      lastPhase = '';
    },
    setContext(next) {
      context = next;
      // 联机/回放/观战也走这里：先摘掉战役文案，避免串到别的对局
      stageLabel = null;
      root.classList.remove('is-stage');
      lastPhaseText = '';
      root.classList.toggle('is-2v2', next.teammateSlot != null);
      writeText(selfName, next.localName || '玩家', (value) => {
        lastSelfName = value;
      }, lastSelfName);
      writeText(oppName, next.opponentName || '对手', (value) => {
        lastOppName = value;
      }, lastOppName);
    },
    update(match) {
      const tick = match.world.tick;
      const deadline = match.getHudDeadlineTick();
      // 调试改时长不推进 tick，必须把截止帧和阶段也算进脏检查，否则倒计时会停在 8:00
      if (tick === lastTick && deadline === lastDeadlineTick && match.phase === lastPhase) return;
      lastTick = tick;
      lastDeadlineTick = deadline;
      lastPhase = match.phase;

      // 无限防守不显示双方信息：波次与出兵进度由 setEndlessMode / updateEndlessProgress 维护
      if (endlessWave) return;

      const local = context.localFaction;
      const localSlot = context.localSlot ?? local;
      const opp = opposingFaction(local);
      writeText(selfName, context.localName || '玩家', (value) => {
        lastSelfName = value;
      }, lastSelfName);
      writeText(oppName, context.opponentName || '对手', (value) => {
        lastOppName = value;
      }, lastOppName);
      updateCastle(localSlot, selfHp, selfBar, selfTrack, selfMark, match, selfCastle);
      const firstOppSlot = context.opponentSlot ?? opp;
      updateCastle(firstOppSlot, oppHp, oppBar, oppTrack, oppMark, match, oppCastle);
      syncOptionalCastle(
        allyRoot,
        allyName,
        allyHp,
        allyBar,
        allyTrack,
        allyMark,
        context.teammateSlot,
        context.teammateName,
        match,
        allyCastle,
      );
      syncOptionalCastle(
        opp2Root,
        opp2Name,
        opp2Hp,
        opp2Bar,
        opp2Track,
        opp2Mark,
        context.extraOpponentSlot,
        context.extraOpponentName,
        match,
        opp2Castle,
      );
      // 2v2 在并排个人条下方再画队伍合计，1v1 只有一座不重复占行
      const showTeamTotal = context.teammateSlot != null;
      root.classList.toggle('is-2v2', showTeamTotal);
      syncTeamTotal(selfTeamTotal, selfTeamHp, selfTeamBar, local, showTeamTotal, match, selfTeamCache);
      syncTeamTotal(oppTeamTotal, oppTeamHp, oppTeamBar, opp, showTeamTotal, match, oppTeamCache);

      // 无限防守隐藏了双方血条与对手手牌：波次与出兵进度由 setEndlessMode / updateEndlessProgress 维护
      if (endlessWave) return;

      const phaseText = stageLabel && (match.phase === 'normal' || match.phase === 'ended')
        ? stageLabel
        : matchPhaseLabel(match.phase) || matchPhaseLabel('normal');
      writeText(phaseLabel, phaseText, (value) => {
        lastPhaseText = value;
      }, lastPhaseText);

      const remainingTicks = Math.max(0, match.getHudDeadlineTick() - match.world.tick);
      const nextTimerLabel = match.phase === 'settlement' ? '结算剩余：' : '剩余时间：';
      writeText(timerLabel, nextTimerLabel, (value) => {
        lastTimerLabel = value;
      }, lastTimerLabel);
      writeText(timer, formatTicks(remainingTicks), (value) => {
        lastTimerText = value;
      }, lastTimerText);
      // 最后 10 秒整条计时器变红脉动，和居中倒计时数字一起提醒
      const warning = remainingTicks > 0 && remainingTicks <= TIMER_WARNING_TICKS;
      if (warning !== lastTimerWarning) {
        lastTimerWarning = warning;
        timer.classList.toggle('is-warning', warning);
      }

      const oppHandSlot = context.opponentSlot ?? opp;
      const nextOppHand = formatHandCount(
        match.decks[oppHandSlot]?.hand.length ?? 0,
        match.getMaxHandSizeForSlot(oppHandSlot),
      );
      writeText(oppHand, nextOppHand, (value) => {
        lastOppHandText = value;
        oppHand.setAttribute('aria-label', `对手手牌 ${value}`);
      }, lastOppHandText);
    },
  };
}

function emptyCastleCache(): CastleHudCache {
  return { text: '', width: '', markLeft: '', markTitle: '', protect: false };
}

function emptyTeamCache(): TeamTotalCache {
  return { text: '', width: '' };
}

/** 2v2 队伍合计血条；1v1 隐藏，避免和单座条重复。 */
function syncTeamTotal(
  root: HTMLElement | null,
  hpEl: HTMLElement | null,
  bar: HTMLElement | null,
  faction: Faction,
  visible: boolean,
  match: MatchState,
  cache: TeamTotalCache,
): void {
  if (!root || !hpEl || !bar) return;
  root.classList.toggle('is-hidden', !visible);
  if (!visible) return;
  const hp = toFloat(match.getCastleHp(faction));
  const maxHp = toFloat(match.getCastleMaxHp(faction));
  const text = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
  const width = `${maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0}%`;
  if (cache.text !== text) {
    hpEl.textContent = text;
    cache.text = text;
  }
  if (cache.width !== width) {
    bar.style.width = width;
    cache.width = width;
  }
}

function writeText(
  element: HTMLElement,
  next: string,
  assign: (value: string) => void,
  current: string,
): void {
  if (current === next) return;
  element.textContent = next;
  assign(next);
}

function syncOptionalCastle(
  root: HTMLElement | null,
  nameEl: HTMLElement | null,
  hpEl: HTMLElement | null,
  bar: HTMLElement | null,
  track: HTMLElement | null,
  mark: HTMLElement | null,
  slot: number | null | undefined,
  name: string | undefined,
  match: MatchState,
  cache: CastleHudCache,
): void {
  if (!root || !hpEl || !bar || !track || !mark) return;
  const visible = slot != null;
  root.classList.toggle('is-hidden', !visible);
  if (!visible) return;
  if (nameEl) nameEl.textContent = name || '队友';
  updateCastle(slot, hpEl, bar, track, mark, match, cache);
}

function updateCastle(
  slot: number,
  label: HTMLElement,
  bar: HTMLElement,
  track: HTMLElement,
  mark: HTMLElement,
  match: MatchState,
  cache: CastleHudCache,
): void {
  const hp = toFloat(match.getSlotCastleHp(slot));
  const maxHp = toFloat(match.getSlotCastleMaxHp(slot));
  const protectHp = match.getCastleProtectHp(slot);
  const text = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
  const width = `${maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0}%`;
  const markLeft = `${maxHp > 0 ? Math.max(0, Math.min(100, (protectHp / maxHp) * 100)) : 0}%`;
  const markTitle = `保护线 ${protectHp}`;
  const protect = hp < protectHp;
  if (cache.text !== text) {
    label.textContent = text;
    cache.text = text;
  }
  if (cache.width !== width) {
    bar.style.width = width;
    cache.width = width;
  }
  if (cache.markLeft !== markLeft) {
    mark.style.left = markLeft;
    cache.markLeft = markLeft;
  }
  if (cache.markTitle !== markTitle) {
    mark.title = markTitle;
    cache.markTitle = markTitle;
  }
  if (cache.protect !== protect) {
    track.classList.toggle('is-protect', protect);
    cache.protect = protect;
  }
}

/** 对手手牌用「当前 / 上限」文字，不展示牌面；张数可超过阶段上限。 */
function formatHandCount(count: number, maxHandSize: number): string {
  return `${Math.max(0, count | 0)} / ${Math.max(1, maxHandSize | 0)}`;
}

function formatTicks(ticks: number): string {
  const seconds = Math.ceil(ticks / TICK_RATE);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
