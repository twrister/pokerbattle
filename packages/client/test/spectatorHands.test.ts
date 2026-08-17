// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type MatchState, type PlayingCard } from '@pb/sim';
import { createSpectatorHands } from '../src/ui/spectatorHands.js';

function mountHandsDom(): void {
  document.body.innerHTML = `
    <section id="spectator-hands" class="is-hidden">
      <span id="spectator-hand-blue-label">蓝方</span>
      <div id="spectator-hand-blue" class="spectator-hand-cards"></div>
      <div id="spectator-hand-blue-mate-group" class="is-hidden">
        <span id="spectator-hand-blue-mate-label">蓝方2</span>
        <div id="spectator-hand-blue-mate" class="spectator-hand-cards"></div>
      </div>
      <span id="spectator-hand-red-label">红方</span>
      <div id="spectator-hand-red" class="spectator-hand-cards"></div>
      <div id="spectator-hand-red-mate-group" class="is-hidden">
        <span id="spectator-hand-red-mate-label">红方2</span>
        <div id="spectator-hand-red-mate" class="spectator-hand-cards"></div>
      </div>
    </section>
  `;
}

function fakeCard(id: string): PlayingCard {
  return { id, rank: 'A', suit: 'spades', label: id };
}

function fakeHand(prefix: string, count: number): { hand: PlayingCard[] } {
  return { hand: Array.from({ length: count }, (_, i) => fakeCard(`${prefix}${i}`)) };
}

function fakeMatch(blueCount: number, redCount: number): MatchState {
  return {
    mode: '1v1',
    decks: [fakeHand('b', blueCount), fakeHand('r', redCount)],
  } as unknown as MatchState;
}

function fakeMatch2v2(): MatchState {
  return {
    mode: '2v2',
    decks: [fakeHand('b0-', 2), fakeHand('b1-', 1), fakeHand('r0-', 3), fakeHand('r1-', 4)],
  } as unknown as MatchState;
}

describe('观战手牌', () => {
  beforeEach(() => {
    mountHandsDom();
  });

  it('按手数写入满幅重叠计数，超过 9 张仍单行渲染', () => {
    const hands = createSpectatorHands();
    hands.show();
    hands.update(fakeMatch(12, 5));

    const blue = document.querySelector<HTMLElement>('#spectator-hand-blue')!;
    const red = document.querySelector<HTMLElement>('#spectator-hand-red')!;
    expect(blue.childElementCount).toBe(12);
    expect(red.childElementCount).toBe(5);
    expect(blue.style.getPropertyValue('--spec-count')).toBe('12');
    expect(red.style.getPropertyValue('--spec-count')).toBe('5');
    expect(blue.style.getPropertyValue('--spec-full')).toBe('9');
    expect(document.querySelector('#spectator-hands')?.classList.contains('is-2v2')).toBe(false);
    expect(document.querySelector('#spectator-hand-blue-mate-group')?.classList.contains('is-hidden')).toBe(true);
    hands.dispose();
  });

  it('2v2 同队两人分栏渲染，不把队友手牌拼进同一排', () => {
    const hands = createSpectatorHands();
    hands.setNames({
      blue: '蓝A',
      blueMate: '蓝B',
      red: '红A',
      redMate: '红B',
    });
    hands.show();
    hands.update(fakeMatch2v2());

    const root = document.querySelector<HTMLElement>('#spectator-hands')!;
    const blue = document.querySelector<HTMLElement>('#spectator-hand-blue')!;
    const blueMate = document.querySelector<HTMLElement>('#spectator-hand-blue-mate')!;
    const red = document.querySelector<HTMLElement>('#spectator-hand-red')!;
    const redMate = document.querySelector<HTMLElement>('#spectator-hand-red-mate')!;
    expect(root.classList.contains('is-2v2')).toBe(true);
    expect(document.querySelector('#spectator-hand-blue-mate-group')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#spectator-hand-red-mate-group')?.classList.contains('is-hidden')).toBe(false);
    expect(blue.childElementCount).toBe(2);
    expect(blueMate.childElementCount).toBe(1);
    expect(red.childElementCount).toBe(3);
    expect(redMate.childElementCount).toBe(4);
    expect(document.querySelector('#spectator-hand-blue-label')?.textContent).toBe('蓝A');
    expect(document.querySelector('#spectator-hand-blue-mate-label')?.textContent).toBe('蓝B');
    expect(document.querySelector('#spectator-hand-red-label')?.textContent).toBe('红A');
    expect(document.querySelector('#spectator-hand-red-mate-label')?.textContent).toBe('红B');
    hands.dispose();
  });
});
