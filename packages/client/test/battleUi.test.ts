// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CASTLE_PROTECT_HP,
  DOUBLE_SPEED_START_TICKS,
  Faction,
  FINAL_START_TICKS,
  MatchState,
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
      </section>
      <section id="battle-result-dialog" class="is-hidden" aria-hidden="true">
        <h2 id="battle-result-title"></h2><p id="battle-result-detail"></p>
        <article id="battle-result-self" class="battle-result-side is-self">
          <strong id="battle-result-self-name"></strong>
          <span id="battle-result-self-hp"></span>
          <div id="battle-result-self-bar"></div>
        </article>
        <article id="battle-result-opp" class="battle-result-side is-opp">
          <strong id="battle-result-opp-name"></strong>
          <span id="battle-result-opp-hp"></span>
          <div id="battle-result-opp-bar"></div>
        </article>
        <button id="btn-battle-result-return"></button>
      </section>
    `;
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
    expect(document.querySelector('#battle-self-name')?.textContent).toBe('Alice');
    expect(document.querySelector('#battle-opp-name')?.textContent).toBe('电脑');
    expect(document.querySelector('#battle-self-hp')?.textContent).toBe('5000 / 5000');
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('常规阶段');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('剩余时间：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('2:00');
    expect(document.querySelector('#battle-opp-hand')?.childElementCount).toBe(
      match.decks[Faction.Red].hand.length,
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
    expect(document.querySelector('#battle-opp-hand')?.childElementCount).toBe(
      match.decks[opposingFaction(Faction.Red)].hand.length,
    );
  });

  it('进入决胜后切换阶段与倒计时文案', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    while (match.world.tick < FINAL_START_TICKS) match.step();
    const hud = createBattleHud();
    hud.setContext({
      localFaction: Faction.Blue,
      localName: 'A',
      opponentName: 'B',
    });

    hud.update(match);

    expect(match.phase).toBe('final');
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('决胜阶段');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('决胜剩余：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('2:00');
  });

  it('倍速阶段展示对应阶段名', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    while (match.world.tick < DOUBLE_SPEED_START_TICKS) match.step();
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
  });
});
