// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type MatchState, type PlayingCard } from '@pb/sim';
import { createSpectatorHands } from '../src/ui/spectatorHands.js';

function mountHandsDom(): void {
  document.body.innerHTML = `
    <section id="spectator-hands" class="is-hidden">
      <span id="spectator-hand-blue-label">蓝方</span>
      <div id="spectator-hand-blue" class="spectator-hand-cards"></div>
      <span id="spectator-hand-red-label">红方</span>
      <div id="spectator-hand-red" class="spectator-hand-cards"></div>
    </section>
  `;
}

function fakeCard(id: string): PlayingCard {
  return { id, rank: 'A', suit: 'spades', label: id };
}

function fakeMatch(blueCount: number, redCount: number): MatchState {
  return {
    mode: '1v1',
    decks: [
      { hand: Array.from({ length: blueCount }, (_, i) => fakeCard(`b${i}`)) },
      { hand: Array.from({ length: redCount }, (_, i) => fakeCard(`r${i}`)) },
    ],
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
    hands.dispose();
  });
});
