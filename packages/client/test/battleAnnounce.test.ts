// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchState, TICK_RATE } from '@pb/sim';
import { createBattleAnnounce } from '../src/ui/battleAnnounce.js';
import { sfx } from '../src/audio/sfx.js';

/** 只替换合成音，避免 jsdom 里没有 Web Audio 导致断言拿不到调用。 */
const toneSpy = vi.spyOn(sfx, 'playTone').mockReturnValue(true);
const announceSfxSpy = vi.spyOn(sfx, 'play');

describe('对局文字提示', () => {
  beforeEach(() => {
    toneSpy.mockClear();
    announceSfxSpy.mockClear();
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

  it('战役可开启常规阶段读秒，reset 后恢复默认不读秒', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    shortenDealPhases(match, { normalTicks: TICK_RATE * 15 });
    const announce = createBattleAnnounce();
    announce.setCountdownSeconds('normal', 10);
    announce.tick(match);

    while (match.world.tick < TICK_RATE * 5) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('10');
    expect(document.querySelector('#battle-announce')?.classList.contains('is-countdown')).toBe(true);

    announce.reset();
    announce.tick(match);
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).not.toBe('10');
  });

  it('战役可覆盖常规阶段开场文案，reset 后恢复默认', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const announce = createBattleAnnounce();
    announce.setEnterText('normal', '');
    announce.tick(match);
    // 空串表示该阶段不播报，避免无基地关卡喊着「摧毁对方城堡」
    expect(document.querySelector('#battle-announce')?.classList.contains('is-hidden')).toBe(true);

    announce.reset();
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

  it('倒计时每秒响一声合成音，阶段文案不走合成音', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const finalTicks = TICK_RATE * 12;
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 2, finalTicks });
    const announce = createBattleAnnounce();

    // 开局阶段文案：只响素材播报音，不该有倒计时滴答
    announce.tick(match);
    expect(announceSfxSpy).toHaveBeenCalledWith('ui_announce');
    expect(toneSpy).not.toHaveBeenCalled();

    toneSpy.mockClear();
    announceSfxSpy.mockClear();
    // 先走到决胜阶段并让倒计时初始化，否则首次 tick 会被当成阶段边沿
    while (match.world.tick < 4) match.step();
    announce.tick(match);
    // 阶段切入的那一声播报已响过，之后倒计时期间不该再响素材音
    announceSfxSpy.mockClear();
    const settlementStart = 4 + finalTicks;
    while (match.world.tick < settlementStart - TICK_RATE * 10) match.step();
    announce.tick(match);
    expect(toneSpy).toHaveBeenCalledTimes(1);

    // 同一秒内重复 tick 不能重复发声
    announce.tick(match);
    expect(toneSpy).toHaveBeenCalledTimes(1);

    while (match.world.tick < settlementStart - TICK_RATE * 9) match.step();
    announce.tick(match);
    expect(toneSpy).toHaveBeenCalledTimes(2);
    // 数字倒计时只用合成音，不再叠素材播报音
    expect(announceSfxSpy).not.toHaveBeenCalled();
  });

  it('最后 3 秒数字变红并换成更高更长的提示音', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const finalTicks = TICK_RATE * 12;
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 2, finalTicks });
    const announce = createBattleAnnounce();
    announce.tick(match);

    // 决胜阶段边沿：只弹阶段名，倒计时从这里开始接管
    while (match.world.tick < 4) match.step();
    announce.tick(match);
    expect(match.phase).toBe('final');
    const settlementStart = 4 + finalTicks;
    const root = document.querySelector<HTMLElement>('#battle-announce')!;

    // 第 5 秒还不该发红
    while (match.world.tick < settlementStart - TICK_RATE * 5) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('5');
    expect(root.classList.contains('is-urgent')).toBe(false);

    toneSpy.mockClear();
    while (match.world.tick < settlementStart - TICK_RATE * 3) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('3');
    expect(root.classList.contains('is-urgent')).toBe(true);
    expect(toneSpy).toHaveBeenCalledWith(expect.objectContaining({ frequency: 1320 }));

    // 切到较小数字后紧迫态要跟着更新，不能残留
    while (match.world.tick < settlementStart - TICK_RATE * 2) match.step();
    announce.tick(match);
    expect(root.classList.contains('is-urgent')).toBe(true);
  });

  it('阶段切换清掉紧迫态，避免红字带到下一段', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    shortenDealPhases(match, { normalTicks: 2, doubleSpeedTicks: 2, finalTicks: 2, settlementTicks: 20 });
    const announce = createBattleAnnounce();
    announce.tick(match);
    const root = document.querySelector<HTMLElement>('#battle-announce')!;

    while (match.world.tick < 6) match.step();
    announce.tick(match);
    expect(document.querySelector('#battle-announce-text')?.textContent).toBe('结算阶段 停止发牌');
    expect(root.classList.contains('is-urgent')).toBe(false);
    expect(root.classList.contains('is-countdown')).toBe(false);
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
