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
  /** 观战人数；0 人时隐藏。 */
  setSpectatorCount(count: number): void;
  /** 观战追帧提示。 */
  setCatchingUp(catchingUp: boolean): void;
  update(match: MatchState): void;
}

interface CastleHudCache {
  text: string;
  width: string;
  markLeft: string;
  markTitle: string;
  protect: boolean;
}

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
  let lastSelfName = '';
  let lastOppName = '';
  let lastPhaseText = '';
  let lastTimerLabel = '';
  let lastTimerText = '';
  let lastOppHandText = '';
  const selfCastle: CastleHudCache = emptyCastleCache();
  const oppCastle: CastleHudCache = emptyCastleCache();
  const selfTeamCache: TeamTotalCache = emptyTeamCache();
  const oppTeamCache: TeamTotalCache = emptyTeamCache();

  return {
    show: () => root.classList.remove('is-hidden'),
    hide() {
      root.classList.add('is-hidden');
      lastTick = -1;
      spectators.classList.add('is-hidden');
      catchup.classList.add('is-hidden');
    },
    setSpectatorCount(count) {
      const n = Math.max(0, count | 0);
      spectators.textContent = `观战 ${n}`;
      spectators.classList.toggle('is-hidden', n === 0);
    },
    setCatchingUp(catchingUp) {
      catchup.classList.toggle('is-hidden', !catchingUp);
    },
    setContext(next) {
      context = next;
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
      if (tick === lastTick) return;
      lastTick = tick;

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

      const phaseText = matchPhaseLabel(match.phase) || matchPhaseLabel('normal');
      writeText(phaseLabel, phaseText, (value) => {
        lastPhaseText = value;
      }, lastPhaseText);

      const remainingTicks = Math.max(0, match.getPhaseDeadlineTick() - match.world.tick);
      const nextTimerLabel = match.phase === 'final' ? '决胜剩余：' : '剩余时间：';
      writeText(timerLabel, nextTimerLabel, (value) => {
        lastTimerLabel = value;
      }, lastTimerLabel);
      writeText(timer, formatTicks(remainingTicks), (value) => {
        lastTimerText = value;
      }, lastTimerText);

      const oppHandSlot = context.opponentSlot ?? opp;
      const nextOppHand = formatHandCount(match.decks[oppHandSlot]?.hand.length ?? 0, match.getMaxHandSize());
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
