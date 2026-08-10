import {
  Faction,
  NORMAL_PHASE_TICKS,
  OVERTIME_END_TICKS,
  TICK_RATE,
  toFloat,
  type MatchState,
} from '@pb/sim';

export interface BattleHudHandle {
  show(): void;
  hide(): void;
  update(match: MatchState): void;
}

/** 将共享仿真状态投射到顶部信息条，不在 UI 重复任何胜负规则。 */
export function createBattleHud(): BattleHudHandle {
  const root = requiredElement<HTMLElement>('#battle-hud');
  const blueHp = requiredElement<HTMLElement>('#battle-blue-hp');
  const redHp = requiredElement<HTMLElement>('#battle-red-hp');
  const blueBar = requiredElement<HTMLElement>('#battle-blue-bar');
  const redBar = requiredElement<HTMLElement>('#battle-red-bar');
  const timerLabel = requiredElement<HTMLElement>('#battle-timer-label');
  const timer = requiredElement<HTMLElement>('#battle-timer');

  return {
    show: () => root.classList.remove('is-hidden'),
    hide: () => root.classList.add('is-hidden'),
    update(match) {
      updateCastle(Faction.Blue, blueHp, blueBar, match);
      updateCastle(Faction.Red, redHp, redBar, match);
      // 加时前后分别倒计到 3:00 / 4:00；提前结算仍按常规剩余时间展示
      const overtime =
        match.phase === 'overtime' || (match.result?.endTick ?? 0) > NORMAL_PHASE_TICKS;
      const deadline = overtime ? OVERTIME_END_TICKS : NORMAL_PHASE_TICKS;
      const remainingTicks = Math.max(0, deadline - match.world.tick);
      timerLabel.textContent = overtime ? '加时阶段：' : '剩余时间：';
      timer.textContent = formatTicks(remainingTicks);
    },
  };
}

function updateCastle(
  faction: Faction,
  label: HTMLElement,
  bar: HTMLElement,
  match: MatchState,
): void {
  const hp = toFloat(match.getCastleHp(faction));
  const maxHp = toFloat(match.getCastleMaxHp(faction));
  label.textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
  bar.style.width = `${maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0}%`;
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
