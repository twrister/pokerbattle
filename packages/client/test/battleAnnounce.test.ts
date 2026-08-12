// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOUBLE_SPEED_START_TICKS,
  MatchState,
  NORMAL_PHASE_TICKS,
  TICK_RATE,
} from '@pb/sim';
import { createBattleAnnounce } from '../src/ui/battleAnnounce.js';

describe('对局文字提示', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="battle-announce" class="is-hidden">
        <span id="battle-announce-text"></span>
      </div>
    `;
    vi.useFakeTimers();
  });

  it('开局首次 tick 弹出常规阶段', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();

    announce.tick(match);

    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('常规阶段');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-hidden')).toBe(false);
  });

  it('阶段边沿只弹一次对应文案', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < DOUBLE_SPEED_START_TICKS) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('倍速发牌');

    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('倍速发牌');
  });

  it('进入加时弹出加时阶段', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < NORMAL_PHASE_TICKS) match.step();
    announce.tick(match);

    expect(match.phase).toBe('overtime');
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('加时阶段');
  });

  it('最后 10 秒逐秒弹出数字', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    // 先越过倍速边沿并消化阶段文案，再测截止前倒计时
    while (match.world.tick < DOUBLE_SPEED_START_TICKS) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('倍速发牌');

    const targetTick = NORMAL_PHASE_TICKS - TICK_RATE * 10;
    while (match.world.tick < targetTick) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('10');

    while (match.world.tick < NORMAL_PHASE_TICKS - TICK_RATE * 9) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('9');
  });
});
