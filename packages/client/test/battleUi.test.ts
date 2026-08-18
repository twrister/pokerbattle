// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CASTLE_PROTECT_HP,
  Faction,
  MatchState,
  TICK_RATE,
  applyArenaPreset,
  fromFloat,
  opposingFaction,
} from '@pb/sim';
import { createBattleHud } from '../src/ui/battleHud.js';
import { createBattleResult } from '../src/ui/battleResult.js';

describe('对局 HUD 与结算弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="battle-hud" class="is-hidden">
        <div id="battle-opp-hand"></div>
        <span id="battle-self-name"></span>
        <strong id="battle-self-hp"></strong>
        <div id="battle-self-track" class="battle-hp-track">
          <div id="battle-self-protect-mark" class="battle-hp-protect-mark"></div>
          <div id="battle-self-bar"></div>
        </div>
        <span id="battle-opp-name"></span>
        <strong id="battle-opp-hp"></strong>
        <div id="battle-opp-track" class="battle-hp-track">
          <div id="battle-opp-protect-mark" class="battle-hp-protect-mark"></div>
          <div id="battle-opp-bar"></div>
        </div>
        <span id="battle-phase-label"></span>
        <span id="battle-timer-label"></span><strong id="battle-timer"></strong>
        <span id="battle-spectators" class="is-hidden">观战 0</span>
        <span id="battle-catchup" class="is-hidden">正在追帧…</span>
        <div id="battle-castle-ally" class="is-hidden">
          <span id="battle-ally-name"></span>
          <strong id="battle-ally-hp"></strong>
          <div id="battle-ally-track">
            <div id="battle-ally-protect-mark"></div>
            <div id="battle-ally-bar"></div>
          </div>
        </div>
        <div id="battle-castle-opp-b" class="is-hidden">
          <span id="battle-opp-b-name"></span>
          <strong id="battle-opp-b-hp"></strong>
          <div id="battle-opp-b-track">
            <div id="battle-opp-b-protect-mark"></div>
            <div id="battle-opp-b-bar"></div>
          </div>
        </div>
        <div id="battle-team-self-total" class="is-hidden">
          <strong id="battle-team-self-hp"></strong>
          <div id="battle-team-self-bar"></div>
        </div>
        <div id="battle-team-opp-total" class="is-hidden">
          <strong id="battle-team-opp-hp"></strong>
          <div id="battle-team-opp-bar"></div>
        </div>
      </section>
      <section id="battle-result-dialog" class="is-hidden" aria-hidden="true">
        <h2 id="battle-result-title"></h2><p id="battle-result-detail"></p>
        <article id="battle-result-self" class="battle-result-side is-self">
          <strong id="battle-result-self-name"></strong>
          <span id="battle-result-self-hp"></span>
          <div id="battle-result-self-bar"></div>
          <ul id="battle-result-self-members" class="battle-result-members is-hidden"></ul>
        </article>
        <article id="battle-result-opp" class="battle-result-side is-opp">
          <strong id="battle-result-opp-name"></strong>
          <span id="battle-result-opp-hp"></span>
          <div id="battle-result-opp-bar"></div>
          <ul id="battle-result-opp-members" class="battle-result-members is-hidden"></ul>
        </article>
        <div id="battle-result-compare" class="battle-result-compare is-hidden">
          <span id="battle-result-compare-self"></span>
          <div id="battle-result-compare-bar"></div>
          <span id="battle-result-compare-opp"></span>
        </div>
        <button id="btn-battle-result-return"></button>
      </section>
    `;
  });

  afterEach(() => {
    applyArenaPreset('1v1');
  });

  it('从 MatchState 渲染基地血量、阶段与常规倒计时', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'Alice',
      opponentName: '电脑',
    });

    hud.show();
    hud.update(match);

    expect(document.querySelector('#battle-hud')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-hud')?.classList.contains('is-2v2')).toBe(false);
    expect(document.querySelector('#battle-team-self-total')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#battle-self-name')?.textContent).toBe('Alice');
    expect(document.querySelector('#battle-opp-name')?.textContent).toBe('电脑');
    expect(document.querySelector('#battle-self-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('常规阶段');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('剩余时间：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('8:00');
    expect(document.querySelector('#battle-opp-hand')?.textContent).toBe(
      `${match.decks[Faction.Red].hand.length} / ${match.getMaxHandSize()}`,
    );
    expect(document.querySelector('#battle-self-protect-mark')?.getAttribute('style')).toContain('50%');
    expect(document.querySelector('#battle-self-track')?.classList.contains('is-protect')).toBe(false);
  });

  it('主堡低于保护线时血条显示刻度并高亮', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const castle = match.world.units.find(
      (unit) => unit.faction === Faction.Blue && unit.typeId === 'building_base',
    );
    if (!castle) throw new Error('主堡未生成');
    castle.hp = fromFloat(CASTLE_PROTECT_HP - 1);
    match.step();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'Alice',
      opponentName: '电脑',
    });
    hud.update(match);

    expect(document.querySelector('#battle-self-track')?.classList.contains('is-protect')).toBe(true);
    expect(document.querySelector('#battle-self-protect-mark')?.getAttribute('title')).toBe(
      `保护线 ${CASTLE_PROTECT_HP}`,
    );
  });

  it('本地为红方时左侧仍读己方 HP，右侧读对阵方', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Red,
      localName: '本地红',
      opponentName: '对阵蓝',
    });
    hud.update(match);

    expect(document.querySelector('#battle-self-name')?.textContent).toBe('本地红');
    expect(document.querySelector('#battle-opp-name')?.textContent).toBe('对阵蓝');
    expect(document.querySelector('#battle-self-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-opp-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-opp-hand')?.textContent).toBe(
      `${match.decks[opposingFaction(Faction.Red)].hand.length} / ${match.getMaxHandSize()}`,
    );
  });

  it('同一 tick 修改阶段时长时立即刷新倒计时', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'A',
      opponentName: 'B',
    });
    hud.update(match);
    expect(document.querySelector('#battle-timer')?.textContent).toBe('8:00');

    match.setPhaseDurations({
      normalTicks: TICK_RATE * 30,
      doubleSpeedTicks: TICK_RATE * 30,
      finalTicks: TICK_RATE * 30,
      settlementTicks: TICK_RATE * 30,
    });
    hud.update(match);

    expect(document.querySelector('#battle-timer')?.textContent).toBe('1:30');
  });

  it('进入决胜后切换阶段与倒计时文案', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    match.setPhaseDurations({
      normalTicks: 2,
      doubleSpeedTicks: 2,
      finalTicks: TICK_RATE * 180,
      settlementTicks: TICK_RATE * 60,
    });
    while (match.world.tick < 4) match.step();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'A',
      opponentName: 'B',
    });

    hud.update(match);

    expect(match.phase).toBe('final');
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('决胜阶段');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('剩余时间：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('3:00');
  });

  it('结算阶段显示结算剩余', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    match.setPhaseDurations({
      normalTicks: 2,
      doubleSpeedTicks: 2,
      finalTicks: 2,
      settlementTicks: TICK_RATE * 60,
    });
    while (match.world.tick < 6) match.step();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'A',
      opponentName: 'B',
    });

    hud.update(match);

    expect(match.phase).toBe('settlement');
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('结算阶段');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('结算剩余：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('1:00');
  });

  it('倍速阶段展示对应阶段名', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    match.setPhaseDurations({
      normalTicks: 2,
      doubleSpeedTicks: 20,
      finalTicks: 20,
      settlementTicks: 20,
    });
    while (match.world.tick < 2) match.step();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'A',
      opponentName: 'B',
    });
    hud.update(match);

    expect(match.phase).toBe('double_speed');
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('倍速阶段');
  });

  it('按本地阵营展示胜负结果', () => {
    const result = createBattleResult(() => {});
    result.show({ winner: Faction.Blue, reason: 'base_destroyed', endTick: 10 }, Faction.Red);

    expect(document.querySelector('#battle-result-title')?.textContent).toBe('失败');
    expect(document.querySelector('#battle-result-detail')?.textContent).toContain('基地被摧毁');
  });

  it('结算弹窗展示双方名字与城堡残血', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const result = createBattleResult(() => {});
    result.setContext({ localName: 'Alice', opponentName: '电脑' });
    result.show({ winner: Faction.Blue, reason: 'time_limit', endTick: 10 }, Faction.Blue, match);

    expect(document.querySelector('#battle-result-self-name')?.textContent).toBe('Alice');
    expect(document.querySelector('#battle-result-opp-name')?.textContent).toBe('电脑');
    expect(document.querySelector('#battle-result-self-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-result-opp-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-result-self')?.classList.contains('is-winner')).toBe(true);
    expect(document.querySelector('#battle-result-opp')?.classList.contains('is-loser')).toBe(true);
    expect(document.querySelector('#battle-result-self-members')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#battle-result-compare')?.classList.contains('is-hidden')).toBe(true);
  });

  it('2v2 结算展示四人残血与队伍总血量对比', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    const units = match.world.units.filter((unit) => unit.typeId === 'building_base');
    const bySlot = (slot: number) => {
      const unit = units.find((candidate) => candidate.ownerSlot === slot);
      if (!unit) throw new Error(`席位 ${slot} 主堡未生成`);
      return unit;
    };
    bySlot(0).hp = fromFloat(1000);
    bySlot(1).hp = fromFloat(2000);
    bySlot(2).hp = fromFloat(3000);
    bySlot(3).hp = fromFloat(0);
    const result = createBattleResult(() => {});
    result.setContext({
      localName: '我',
      opponentName: '敌1',
      localSlot: 0,
      teammateName: '队友',
      teammateSlot: 1,
      opponentSlot: 2,
      extraOpponentName: '敌2',
      extraOpponentSlot: 3,
    });
    result.show({ winner: Faction.Red, reason: 'time_limit', endTick: 10 }, Faction.Blue, match);

    expect(document.querySelector('#battle-result-dialog')?.classList.contains('is-2v2')).toBe(true);
    expect(document.querySelector('#battle-result-self-name')?.textContent).toBe('合计');
    expect(document.querySelector('#battle-result-self-hp')?.textContent).toBe('3000 / 10000');
    expect(document.querySelector('#battle-result-opp-hp')?.textContent).toBe('3000 / 10000');
    expect(document.querySelector('#battle-result-self-members')?.textContent).toContain('我');
    expect(document.querySelector('#battle-result-self-members')?.textContent).toContain('1000 / 5000');
    expect(document.querySelector('#battle-result-self-members')?.textContent).toContain('队友');
    expect(document.querySelector('#battle-result-self-members')?.textContent).toContain('2000 / 5000');
    expect(document.querySelector('#battle-result-opp-members')?.textContent).toContain('敌1');
    expect(document.querySelector('#battle-result-opp-members')?.textContent).toContain('3000 / 5000');
    expect(document.querySelector('#battle-result-opp-members')?.textContent).toContain('敌2');
    expect(document.querySelector('#battle-result-opp-members')?.textContent).toContain('0 / 5000');
    expect(document.querySelector('#battle-result-compare')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-result-compare-self')?.textContent).toBe('己方 3000');
    expect(document.querySelector('#battle-result-compare-opp')?.textContent).toBe('对方 3000');
    expect(document.querySelector('#battle-result-compare-bar')?.getAttribute('style')).toContain('50%');
  });

  it('2v2 渲染我/队友与两名敌人的主堡血条', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: '我',
      opponentName: '敌1',
      localSlot: 0,
      teammateName: '队友',
      teammateSlot: 1,
      opponentSlot: 2,
      extraOpponentName: '敌2',
      extraOpponentSlot: 3,
    });
    hud.update(match);

    expect(document.querySelector('#battle-self-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-ally-name')?.textContent).toBe('队友');
    expect(document.querySelector('#battle-ally-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-castle-ally')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-opp-b-name')?.textContent).toBe('敌2');
    expect(document.querySelector('#battle-castle-opp-b')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-hud')?.classList.contains('is-2v2')).toBe(true);
    expect(document.querySelector('#battle-team-self-total')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-team-self-hp')?.textContent).toBe('10000 / 10000');
    expect(document.querySelector('#battle-team-opp-hp')?.textContent).toBe('10000 / 10000');
    expect(document.querySelector('#battle-team-self-bar')?.getAttribute('style')).toContain('100%');
  });
});
