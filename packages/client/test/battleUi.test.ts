// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CASTLE_PROTECT_HP,
  Faction,
  MatchState,
  TICK_RATE,
  applyArenaPreset,
  applyCombatDamage,
  fromFloat,
  fromInt,
  opposingFaction,
} from '@pb/sim';
import { createBattleHud } from '../src/ui/battleHud.js';
import { createBattleDamagePanel } from '../src/ui/battleDamagePanel.js';
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
        <div id="battle-wave-bar">
          <div class="battle-wave-track" id="battle-wave-track"><div id="battle-wave-fill"></div><div id="battle-wave-flag"></div></div>
          <span id="battle-wave-enemies"></span>
        </div>
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
      <section id="battle-damage-panel" class="panel is-hidden is-collapsed">
        <div class="battle-damage-header">
          <button id="btn-battle-damage-toggle" type="button" aria-expanded="false">伤害面板</button>
          <div class="battle-damage-tabs" role="tablist">
            <button type="button" role="tab" id="btn-battle-damage-tab-castle" data-tab="castle" aria-selected="true">基地</button>
            <button type="button" role="tab" id="btn-battle-damage-tab-units" data-tab="units" aria-selected="false">兵种</button>
          </div>
        </div>
        <div id="battle-damage-body">
          <div class="battle-damage-row">
            <span id="battle-damage-self-name">我</span>
            <strong id="battle-damage-self-value">0</strong>
            <div id="battle-damage-self-bar"></div>
          </div>
          <div class="battle-damage-row">
            <span id="battle-damage-mate-name">队友</span>
            <strong id="battle-damage-mate-value">0</strong>
            <div id="battle-damage-mate-bar"></div>
          </div>
        </div>
      </section>
      <section id="battle-result-dialog" class="is-hidden" aria-hidden="true">
        <h2 id="battle-result-title"></h2><p id="battle-result-detail"></p>
        <div class="battle-result-head">
          <article id="battle-result-self" class="battle-result-side is-self">
            <strong id="battle-result-self-name"></strong>
          </article>
          <article id="battle-result-opp" class="battle-result-side is-opp">
            <strong id="battle-result-opp-name"></strong>
          </article>
        </div>
        <div class="battle-result-rows">
          <div class="battle-result-row">
            <span id="battle-result-self-hp"></span>
            <div id="battle-result-hp-split" class="battle-result-split">
              <div id="battle-result-hp-bar" class="battle-result-split-bar"></div>
            </div>
            <span id="battle-result-opp-hp"></span>
          </div>
          <div class="battle-result-row">
            <span id="battle-result-self-castle-value"></span>
            <div id="battle-result-castle-split" class="battle-result-split">
              <div id="battle-result-self-castle-bar" class="battle-result-split-bar"></div>
            </div>
            <span id="battle-result-opp-castle-value"></span>
          </div>
          <div class="battle-result-row">
            <span id="battle-result-self-units-value"></span>
            <div id="battle-result-units-split" class="battle-result-split">
              <div id="battle-result-self-units-bar" class="battle-result-split-bar"></div>
            </div>
            <span id="battle-result-opp-units-value"></span>
          </div>
        </div>
        <div id="battle-result-members" class="battle-result-table is-hidden"></div>
        <p id="battle-result-stage" class="is-hidden"></p>
        <div id="battle-result-highlight" class="is-hidden">
          <span id="battle-result-highlight-label"></span>
          <strong id="battle-result-highlight-value"></strong>
        </div>
        <span id="battle-result-badge" class="is-hidden"></span>
        <button id="btn-battle-result-next" class="is-hidden"></button>
        <button id="btn-battle-result-retry" class="is-hidden"></button>
        <button id="btn-battle-result-return"></button>
      </section>
    `;
  });

  afterEach(() => {
    applyArenaPreset('1v1');
    localStorage.removeItem('pb.battleDamagePanel.collapsed');
    localStorage.removeItem('pb.battleDamagePanel.tab');
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
    // 默认节奏 120+120+120 秒三段发牌，HUD 倒计时指向停发牌结算起点
    expect(document.querySelector('#battle-timer')?.textContent).toBe('6:00');
    expect(document.querySelector('#battle-opp-hand')?.textContent).toBe(
      `${match.decks[Faction.Red].hand.length} / ${match.getMaxHandSizeForSlot(Faction.Red)}`,
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
      `${match.decks[opposingFaction(Faction.Red)].hand.length} / ${match.getMaxHandSizeForSlot(opposingFaction(Faction.Red))}`,
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
    expect(document.querySelector('#battle-timer')?.textContent).toBe('6:00');

    match.setPhaseDurations({
      normalTicks: TICK_RATE * 30,
      doubleSpeedTicks: TICK_RATE * 30,
      finalTicks: TICK_RATE * 30,
      settlementTicks: TICK_RATE * 30,
    });
    hud.update(match);

    expect(document.querySelector('#battle-timer')?.textContent).toBe('1:30');
  });

  it('剩余 10 秒内计时器进入警戒态，结束后恢复', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    // HUD 截止 = 三阶段合计 300 帧，刚好在警戒线（TICK_RATE*10 = 200 帧）之外
    match.setPhaseDurations({
      normalTicks: 294,
      doubleSpeedTicks: 2,
      finalTicks: 2,
      settlementTicks: 2,
    });
    const hud = createBattleHud();
    hud.setContext({ localFaction: Faction.Blue, localName: 'A', opponentName: 'B' });
    const timer = document.querySelector<HTMLElement>('#battle-timer')!;

    hud.update(match);
    expect(timer.classList.contains('is-warning')).toBe(false);

    // 消耗 100 帧后只剩 200 帧，进入警戒
    while (match.world.tick < 100) match.step();
    hud.update(match);
    expect(timer.classList.contains('is-warning')).toBe(true);

    // 重新开局后警戒色必须摘掉，不能带到下一局
    hud.hide();
    expect(timer.classList.contains('is-warning')).toBe(false);
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

  it('无限防守隐藏双方信息，只留波次与出兵进度', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const hud = createBattleHud();
    hud.setContext({ localFaction: Faction.Blue, localName: 'A', opponentName: 'B' });
    hud.setEndlessMode({ wave: 6, boss: true });

    expect(document.querySelector('#battle-hud')?.classList.contains('is-endless')).toBe(true);
    expect(document.querySelector('#battle-wave-bar')?.classList.contains('is-boss')).toBe(true);
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('第 6 波（Boss）');

    hud.updateEndlessProgress({ ratio: 0.5, spawnDone: false, remaining: 7 });
    expect(document.querySelector<HTMLElement>('#battle-wave-fill')?.style.width).toBe('50%');
    expect(document.querySelector('#battle-wave-enemies')?.textContent).toBe('剩余敌人 7');
    expect(document.querySelector('#battle-wave-track')?.classList.contains('is-done')).toBe(false);

    hud.updateEndlessProgress({ ratio: 1, spawnDone: true, remaining: 2 });
    expect(document.querySelector<HTMLElement>('#battle-wave-fill')?.style.width).toBe('100%');
    expect(document.querySelector('#battle-wave-track')?.classList.contains('is-done')).toBe(true);

    // 无限模式不再刷阶段名与倒计时
    hud.update(match);
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('第 6 波（Boss）');

    hud.setEndlessMode(null);
    hud.update(match);
    expect(document.querySelector('#battle-hud')?.classList.contains('is-endless')).toBe(false);
    expect(document.querySelector('#battle-phase-label')?.textContent).toBe('常规阶段');
  });

  it('按本地阵营展示胜负结果', () => {
    const result = createBattleResult(() => {});
    result.show({ winner: Faction.Blue, reason: 'base_destroyed', endTick: 10 }, Faction.Red);

    expect(document.querySelector('#battle-result-title')?.textContent).toBe('失败');
    expect(document.querySelector('#battle-result-detail')?.textContent).toContain('基地被摧毁');
    expect(document.querySelector('#battle-result-self-castle-value')?.textContent).toBe('—');
    expect(document.querySelector('#battle-result-self-units-value')?.textContent).toBe('—');
    expect(document.querySelector('#battle-result-opp-castle-value')?.textContent).toBe('—');
    expect(document.querySelector('#battle-result-opp-units-value')?.textContent).toBe('—');
    expect(document.querySelector('#battle-result-self-hp')?.textContent).toBe('—');
    expect(document.querySelector('#battle-result-opp-hp')?.textContent).toBe('—');
    // 无对局数据时分割条走中灰，不能整条显示成己方或对方色
    expect(document.querySelector('#battle-result-hp-split')?.classList.contains('is-neutral')).toBe(true);
    expect(document.querySelector('#battle-result-castle-split')?.classList.contains('is-neutral')).toBe(true);
    expect(document.querySelector('#battle-result-members')?.classList.contains('is-hidden')).toBe(true);
  });

  it('战役结算只显示成败、用时与对应按钮，普通结算会清掉战役态', () => {
    const result = createBattleResult(() => {});
    const root = document.querySelector('#battle-result-dialog')!;
    const next = document.querySelector('#btn-battle-result-next')!;
    const retry = document.querySelector('#btn-battle-result-retry')!;
    const stageLine = document.querySelector('#battle-result-stage')!;
    const onNext = vi.fn();
    const onRetry = vi.fn();

    result.showStage({ cleared: true, seconds: 86.6, hasNext: true, onNext, onRetry });
    expect(document.querySelector('#battle-result-title')?.textContent).toBe('通关');
    expect(root.classList.contains('is-stage')).toBe(true);
    expect(stageLine.textContent).toBe('用时 87 秒');
    expect(stageLine.classList.contains('is-failed')).toBe(false);
    expect(next.classList.contains('is-hidden')).toBe(false);
    expect(retry.classList.contains('is-hidden')).toBe(true);
    (next as HTMLButtonElement).click();
    expect(onNext).toHaveBeenCalledTimes(1);

    result.showStage({ cleared: false, seconds: 120, hasNext: true, onNext, onRetry });
    expect(document.querySelector('#battle-result-title')?.textContent).toBe('失败');
    expect(stageLine.textContent).toBe('未达成目标');
    expect(stageLine.classList.contains('is-failed')).toBe(true);
    expect(next.classList.contains('is-hidden')).toBe(true);
    expect(retry.classList.contains('is-hidden')).toBe(false);
    (retry as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);

    // 最后一关通关：没有下一关按钮，也不出现重试
    result.showStage({ cleared: true, seconds: 50, hasNext: false, onNext, onRetry });
    expect(next.classList.contains('is-hidden')).toBe(true);
    expect(retry.classList.contains('is-hidden')).toBe(true);

    result.show({ winner: Faction.Blue, reason: 'time_limit', endTick: 10 }, Faction.Blue);
    expect(root.classList.contains('is-stage')).toBe(false);
    expect(stageLine.classList.contains('is-hidden')).toBe(true);
  });

  it('无限防守结算：自定义标题、大号成绩块与新纪录角标，普通战役结算会清掉', () => {
    const result = createBattleResult(() => {});
    const stageLine = document.querySelector('#battle-result-stage')!;
    const highlight = document.querySelector('#battle-result-highlight')!;
    const badge = document.querySelector('#battle-result-badge')!;
    const retry = document.querySelector('#btn-battle-result-retry')!;

    result.showStage({
      cleared: false,
      seconds: 300,
      hasNext: false,
      onNext: vi.fn(),
      onRetry: vi.fn(),
      titleText: '防线失守',
      highlight: { label: '守住波数', value: '7' },
      badge: '新纪录',
      retryLabel: '重新挑战',
    });
    expect(document.querySelector('#battle-result-title')?.textContent).toBe('防线失守');
    expect(highlight.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#battle-result-highlight-value')?.textContent).toBe('7');
    expect(badge.textContent).toBe('新纪录');
    expect(badge.classList.contains('is-hidden')).toBe(false);
    // 成绩块已说明结果，失败行收起
    expect(stageLine.classList.contains('is-hidden')).toBe(true);
    expect(retry.textContent).toBe('重新挑战');

    result.showStage({ cleared: false, seconds: 10, hasNext: false, onNext: vi.fn(), onRetry: vi.fn() });
    expect(document.querySelector('#battle-result-title')?.textContent).toBe('失败');
    expect(highlight.classList.contains('is-hidden')).toBe(true);
    expect(badge.classList.contains('is-hidden')).toBe(true);
    expect(retry.textContent).toBe('重试');
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
    expect(document.querySelector('#battle-result-hp-bar')?.getAttribute('style')).toContain('50%');
    expect(document.querySelector('#battle-result-self')?.classList.contains('is-winner')).toBe(true);
    expect(document.querySelector('#battle-result-opp')?.classList.contains('is-loser')).toBe(true);
    expect(document.querySelector('#battle-result-members')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#battle-result-self-castle-value')?.textContent).toBe('0');
    expect(document.querySelector('#battle-result-self-units-value')?.textContent).toBe('0');
    expect(document.querySelector('#battle-result-self-castle-bar')?.getAttribute('style')).toContain('0%');
    expect(document.querySelector('#battle-result-self-units-bar')?.getAttribute('style')).toContain('0%');
    // 双方伤害都是 0：分割条转中性态
    expect(document.querySelector('#battle-result-castle-split')?.classList.contains('is-neutral')).toBe(true);
  });

  it('2v2 结算展示队伍名牌与队员明细表', () => {
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
    expect(document.querySelector('#battle-result-self-name')?.textContent).toBe('己方队伍');
    expect(document.querySelector('#battle-result-opp-name')?.textContent).toBe('对方队伍');
    expect(document.querySelector('#battle-result-self-hp')?.textContent).toBe('3000 / 10000');
    expect(document.querySelector('#battle-result-opp-hp')?.textContent).toBe('3000 / 10000');
    expect(document.querySelector('#battle-result-hp-bar')?.getAttribute('style')).toContain('50%');

    const table = document.querySelector('#battle-result-members');
    expect(table?.classList.contains('is-hidden')).toBe(false);
    expect(table?.textContent).toContain('我');
    expect(table?.textContent).toContain('1000 / 5000');
    expect(table?.textContent).toContain('队友');
    expect(table?.textContent).toContain('2000 / 5000');
    expect(table?.textContent).toContain('敌1');
    expect(table?.textContent).toContain('3000 / 5000');
    expect(table?.textContent).toContain('敌2');
    expect(table?.textContent).toContain('0 / 5000');
    // 表头 + 四名队员
    expect(table?.querySelectorAll('.battle-result-table-row').length).toBe(5);
    expect(table?.querySelectorAll('.battle-result-table-row.is-self').length).toBe(2);
    expect(table?.querySelectorAll('.battle-result-table-row.is-opp').length).toBe(2);
    // 血量归零的席位降透明度
    expect(table?.querySelectorAll('.battle-result-table-row.is-down').length).toBe(1);
  });

  it('1v1 结算对比行展示双方对基地与对兵种输出', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const redCastle = match.world.units.find(
      (unit) => unit.ownerSlot === Faction.Red && unit.typeId === 'building_base',
    );
    const blueCastle = match.world.units.find(
      (unit) => unit.ownerSlot === Faction.Blue && unit.typeId === 'building_base',
    );
    if (!redCastle || !blueCastle) throw new Error('主堡未生成');
    const redGrunt = match.world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    const blueGrunt = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(3), fromFloat(4));
    applyCombatDamage(redCastle, fromInt(120), false, match.world, Faction.Blue);
    applyCombatDamage(redGrunt, fromInt(40), false, match.world, Faction.Blue);
    applyCombatDamage(blueCastle, fromInt(80), false, match.world, Faction.Red);
    applyCombatDamage(blueGrunt, fromInt(20), false, match.world, Faction.Red);

    const result = createBattleResult(() => {});
    result.setContext({ localName: 'Alice', opponentName: '电脑' });
    result.show({ winner: Faction.Blue, reason: 'time_limit', endTick: 10 }, Faction.Blue, match);

    expect(document.querySelector('#battle-result-self-castle-value')?.textContent).toBe('120');
    expect(document.querySelector('#battle-result-self-units-value')?.textContent).toBe('40');
    expect(document.querySelector('#battle-result-opp-castle-value')?.textContent).toBe('80');
    expect(document.querySelector('#battle-result-opp-units-value')?.textContent).toBe('20');
    // 分割条只有己方一根，宽度即己方占比
    expect(document.querySelector('#battle-result-self-castle-bar')?.getAttribute('style')).toContain('60%');
    expect(document.querySelector('#battle-result-self-units-bar')?.getAttribute('style')).toContain(`${(40 / 60) * 100}%`);
    expect(document.querySelector('#battle-result-castle-split')?.classList.contains('is-neutral')).toBe(false);
    expect(document.querySelector('#battle-result-members')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#battle-result-self-name')?.textContent).toBe('Alice');
  });

  it('2v2 结算对比行写队合计，明细表再拆个人输出', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    const redCastle = match.world.units.find(
      (unit) => unit.ownerSlot === 2 && unit.typeId === 'building_base',
    );
    const blueCastle = match.world.units.find(
      (unit) => unit.ownerSlot === 0 && unit.typeId === 'building_base',
    );
    if (!redCastle || !blueCastle) throw new Error('主堡未生成');
    const redGrunt = match.world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16), 2);
    const blueGrunt = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(3), fromFloat(4), 0);
    applyCombatDamage(redCastle, fromInt(120), false, match.world, 0);
    applyCombatDamage(redGrunt, fromInt(40), false, match.world, 1);
    applyCombatDamage(blueCastle, fromInt(80), false, match.world, 2);
    applyCombatDamage(blueGrunt, fromInt(20), false, match.world, 3);

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

    expect(document.querySelector('#battle-result-self-castle-value')?.textContent).toBe('120');
    expect(document.querySelector('#battle-result-self-units-value')?.textContent).toBe('40');
    expect(document.querySelector('#battle-result-opp-castle-value')?.textContent).toBe('80');
    expect(document.querySelector('#battle-result-opp-units-value')?.textContent).toBe('20');
    expect(document.querySelector('#battle-result-self-castle-bar')?.getAttribute('style')).toContain('60%');
    expect(document.querySelector('#battle-result-self-name')?.textContent).toBe('己方队伍');

    const table = document.querySelector('#battle-result-members');
    expect(table?.textContent).toContain('我');
    expect(table?.textContent).toContain('队友');
    expect(table?.textContent).toContain('敌1');
    expect(table?.textContent).toContain('敌2');
    // 己方两行在前：我打基地 120、队友打兵种 40
    const castle = table?.querySelectorAll('.battle-result-member-castle');
    const units = table?.querySelectorAll('.battle-result-member-units');
    expect(castle?.[0]?.textContent).toBe('120');
    expect(castle?.[1]?.textContent).toBe('0');
    expect(castle?.[2]?.textContent).toBe('80');
    expect(castle?.[3]?.textContent).toBe('0');
    expect(units?.[0]?.textContent).toBe('0');
    expect(units?.[1]?.textContent).toBe('40');
    expect(units?.[2]?.textContent).toBe('0');
    expect(units?.[3]?.textContent).toBe('20');
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

  it('无基地关卡收起血条，返回普通关卡后可恢复', () => {
    const hud = createBattleHud();
    const root = () => document.querySelector('#battle-hud')!;
    expect(root().classList.contains('is-no-castle')).toBe(false);
    hud.setCastleBarsVisible(false);
    expect(root().classList.contains('is-no-castle')).toBe(true);
    hud.setCastleBarsVisible(true);
    expect(root().classList.contains('is-no-castle')).toBe(false);
  });

  it('1v1 不显示实时伤害面板', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const panel = createBattleDamagePanel();
    panel.setContext({ localName: 'Alice', localSlot: 0 });
    panel.show();
    panel.update(match);

    expect(document.querySelector('#battle-damage-panel')?.classList.contains('is-hidden')).toBe(true);
  });

  it('2v2 显示实时伤害面板且默认折叠，数值随 MatchState 更新', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    const castle = match.world.units.find(
      (unit) => unit.ownerSlot === 2 && unit.typeId === 'building_base',
    );
    if (!castle) throw new Error('敌方主堡未生成');
    const grunt = match.world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    applyCombatDamage(castle, fromInt(120), false, match.world, 0);
    applyCombatDamage(grunt, fromInt(40), false, match.world, 1);

    const panel = createBattleDamagePanel();
    panel.setContext({
      localName: '我',
      localSlot: 0,
      teammateName: '队友',
      teammateSlot: 1,
    });
    panel.show();
    panel.update(match);

    const root = document.querySelector('#battle-damage-panel');
    expect(root?.classList.contains('is-hidden')).toBe(false);
    expect(root?.classList.contains('is-collapsed')).toBe(true);
    expect(document.querySelector('#btn-battle-damage-toggle')?.textContent).toBe('伤害面板');
    expect(document.querySelector('#battle-damage-self-name')?.textContent).toBe('我');
    expect(document.querySelector('#battle-damage-mate-name')?.textContent).toBe('队友');
    expect(document.querySelector('#btn-battle-damage-tab-castle')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('#battle-damage-self-value')?.textContent).toBe('120');
    expect(document.querySelector('#battle-damage-mate-value')?.textContent).toBe('0');
    expect(document.querySelector('#battle-damage-self-bar')?.getAttribute('style')).toContain('100%');
    expect(document.querySelector('#battle-damage-mate-bar')?.getAttribute('style')).toContain('0%');

    document.querySelector<HTMLButtonElement>('#btn-battle-damage-tab-units')?.click();
    expect(document.querySelector('#btn-battle-damage-tab-units')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('#battle-damage-self-value')?.textContent).toBe('0');
    expect(document.querySelector('#battle-damage-mate-value')?.textContent).toBe('40');
    expect(document.querySelector('#battle-damage-self-bar')?.getAttribute('style')).toContain('0%');
    expect(document.querySelector('#battle-damage-mate-bar')?.getAttribute('style')).toContain('100%');

    document.querySelector<HTMLButtonElement>('#btn-battle-damage-toggle')?.click();
    expect(root?.classList.contains('is-collapsed')).toBe(false);
    expect(document.querySelector('#btn-battle-damage-toggle')?.textContent).toBe('收起');
  });
});
