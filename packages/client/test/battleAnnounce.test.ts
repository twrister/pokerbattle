// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchState, TICK_RATE } from '@pb/sim';
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
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 20 });
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < 2) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('加速发牌阶段');

    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('加速发牌阶段');
  });

  it('进入决胜弹出决胜阶段', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 2 });
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < 4) match.step();
    announce.tick(match);

    expect(match.phase).toBe('final');
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('决胜阶段 战斗加速');
  });

  it('常规与倍速最后 10 秒不弹数字倒计时', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    shortenDealPhases(match, { normalTicks: TICK_RATE * 15 });
    const announce = createBattleAnnounce();
    announce.tick(match);

    const targetTick = TICK_RATE * 5;
    while (match.world.tick < targetTick) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('摧毁对方城堡');
  });

  it('决胜最后 10 秒逐秒弹出数字', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const finalTicks = TICK_RATE * 12;
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 2, finalTicks });
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < 4) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('决胜阶段 战斗加速');

    const settlementStart = 4 + finalTicks;
    while (match.world.tick < settlementStart - TICK_RATE * 10) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('10');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-countdown')).toBe(true);

    while (match.world.tick < settlementStart - TICK_RATE * 9) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('9');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-countdown')).toBe(true);
  });

  it('进入结算弹出结算阶段', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 2, finalTicks: 2 });
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < 6) match.step();
    announce.tick(match);

    expect(match.phase).toBe('settlement');
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('结算阶段 停止发牌');
  });

  it('结算最后 10 秒逐秒弹出数字', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const settlementTicks = TICK_RATE * 12;
    shortenDealPhases(match, {
      normalTicks: 2,
      doubleSpeedTicks: 2,
      finalTicks: 2,
      settlementTicks,
    });
    const announce = createBattleAnnounce();
    announce.tick(match);

    while (match.world.tick < 6) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('结算阶段 停止发牌');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-countdown')).toBe(false);

    const matchEnd = 6 + settlementTicks;
    while (match.world.tick < matchEnd - TICK_RATE * 10) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('10');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-countdown')).toBe(true);

    while (match.world.tick < matchEnd - TICK_RATE * 9) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('9');
  });
});

/** 压缩阶段时长，避免测试空转默认 9 分钟。 */
function shortenDealPhases(
  match: MatchState,
  durations: {
    normalTicks?: number;
    doubleSpeedTicks?: number;
    finalTicks?: number;
    settlementTicks?: number;
  },
): void {
  match.setPhaseDurations({
    normalTicks: durations.normalTicks ?? 2,
    doubleSpeedTicks: durations.doubleSpeedTicks ?? 20,
    finalTicks: durations.finalTicks ?? 20,
    settlementTicks: durations.settlementTicks ?? 20,
  });
}
