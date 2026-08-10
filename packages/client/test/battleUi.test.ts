// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, MatchState, NORMAL_PHASE_TICKS } from '@pb/sim';
import { createBattleHud } from '../src/ui/battleHud.js';
import { createBattleResult } from '../src/ui/battleResult.js';

describe('对局 HUD 与结算弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="battle-hud" class="is-hidden">
        <strong id="battle-blue-hp"></strong><div id="battle-blue-bar"></div>
        <strong id="battle-red-hp"></strong><div id="battle-red-bar"></div>
        <span id="battle-timer-label"></span><strong id="battle-timer"></strong>
      </section>
      <section id="battle-result-dialog" class="is-hidden" aria-hidden="true">
        <h2 id="battle-result-title"></h2><p id="battle-result-detail"></p>
        <button id="btn-battle-result-return"></button>
      </section>
    `;
  });

  it('从 MatchState 渲染基地血量与常规倒计时', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const hud = createBattleHud();

    hud.show();
    hud.update(match);

    expect(document.querySelector('#battle-hud')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-blue-hp')?.textContent).toBe('4000 / 4000');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('剩余时间：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('3:00');
  });

  it('进入加时后切换倒计时文案', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    while (match.world.tick < NORMAL_PHASE_TICKS) match.step();
    const hud = createBattleHud();

    hud.update(match);

    expect(match.phase).toBe('overtime');
    expect(document.querySelector('#battle-timer-label')?.textContent).toBe('加时阶段：');
    expect(document.querySelector('#battle-timer')?.textContent).toBe('1:00');
  });

  it('按本地阵营展示胜负结果', () => {
    const result = createBattleResult(() => {});
    result.show({ winner: Faction.Blue, reason: 'base_destroyed', endTick: 10 }, Faction.Red);

    expect(document.querySelector('#battle-result-title')?.textContent).toBe('失败');
    expect(document.querySelector('#battle-result-detail')?.textContent).toContain('基地被摧毁');
  });
});
