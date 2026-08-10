import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { MatchState } from '../src/match/matchState.js';

describe('MatchState.clear', () => {
  it('清空后保留牌堆实例引用，并重新发初始手牌', () => {
    const match = new MatchState(1);
    const blueDeck = match.decks[Faction.Blue];
    const redDeck = match.decks[Faction.Red];
    const beforeBlue = blueDeck.hand.map((card) => card.id);

    blueDeck.play(beforeBlue.slice(0, 1));
    expect(blueDeck.hand).toHaveLength(beforeBlue.length - 1);

    match.clear();

    // 单机 HandPanel 绑的是同一 deck；换实例会导致校验手牌 id 永远对不上
    expect(match.decks[Faction.Blue]).toBe(blueDeck);
    expect(match.decks[Faction.Red]).toBe(redDeck);
    expect(blueDeck.hand).toHaveLength(3);
    expect(redDeck.hand).toHaveLength(3);
  });
});
