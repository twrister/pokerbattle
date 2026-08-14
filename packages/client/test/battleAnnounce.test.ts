// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOUBLE_SPEED_START_TICKS,
  FINAL_START_TICKS,
  MATCH_END_TICKS,
  MatchState,
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

  it('开局首次 tick 弹出摧毁对方城堡', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();

    announce.tick(match);

    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('摧毁对方城堡');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-hidden')).toBe(false);
  });

  it('阶段文案停留超过原先 1.2 秒', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();

    announce.tick(match);
    vi.advanceTimersByTime(2000);
    expect(document.querySelector('#battle-announce')?.classList.contains('is-hidden')).toBe(false);

    vi.advanceTimersByTime(800);
    expect(document.querySelector('#battle-announce')?.classList.contains('is-hidden')).toBe(true);
  });

  it('阶段边沿只弹一次对应文案', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < DOUBLE_SPEED_START_TICKS) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('倍速阶段');

    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('倍速阶段');
  });

  it('进入决胜弹出决胜阶段', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < FINAL_START_TICKS) match.step();
    announce.tick(match);

    expect(match.phase).toBe('final');
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('决胜阶段');
  });

  it('常规与倍速最后 10 秒不弹数字倒计时', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    const targetTick = DOUBLE_SPEED_START_TICKS - TICK_RATE * 10;
    while (match.world.tick < targetTick) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('摧毁对方城堡');
  });

  it('决胜最后 10 秒逐秒弹出数字', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < FINAL_START_TICKS) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('决胜阶段');

    const targetTick = MATCH_END_TICKS - TICK_RATE * 10;
    while (match.world.tick < targetTick) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('10');

    while (match.world.tick < MATCH_END_TICKS - TICK_RATE * 9) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('9');
  });
});
