import { describe, expect, it } from 'vitest';
import { Rng } from '@pb/sim';
import {
  FRESH_CARD_WEIGHT,
  MAX_HAND_SIZE,
  PokerDeck,
  RETURNED_CARD_WEIGHT,
  createPokerCards,
} from '../src/cards/deck.js';
import { cardImageUrl } from '../src/cards/cardImageUrl.js';

describe('单机扑克牌堆', () => {
  it('生成包含四花色和大小王的 54 张唯一牌', () => {
    const cards = createPokerCards();

    expect(cards).toHaveLength(54);
    expect(new Set(cards.map((card) => card.id))).toHaveLength(54);
    expect(cards.filter((card) => card.rank === 'JOKER')).toHaveLength(2);
    expect(cardImageUrl(cards.find((card) => card.id === 'A-spades')!)).toBe('cards/A_1.png');
    expect(cardImageUrl(cards.find((card) => card.id === 'joker-red')!)).toBe('cards/Joker_2.png');
  });

  it('抽牌离开有限牌堆且不能突破九张手牌上限', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const drawn = deck.drawMany(20);

    expect(drawn).toHaveLength(MAX_HAND_SIZE);
    expect(deck.hand).toHaveLength(MAX_HAND_SIZE);
    expect(deck.availableCount).toBe(54 - MAX_HAND_SIZE);
    expect(new Set(drawn.map((card) => card.id))).toHaveLength(MAX_HAND_SIZE);
    expect(deck.draw()).toBeUndefined();
  });

  it('出牌后回到牌堆并永久使用更低抽取权重', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const [card] = deck.drawMany(1);

    expect(card).toBeDefined();
    expect(deck.getAvailableWeight(card!.id)).toBeUndefined();
    expect(deck.getAvailableWeight('2-spades')).toBe(FRESH_CARD_WEIGHT);

    expect(deck.play([card!.id, card!.id])).toEqual([card]);
    expect(deck.hand).toHaveLength(0);
    expect(deck.availableCount).toBe(54);
    expect(deck.getAvailableWeight(card!.id)).toBe(RETURNED_CARD_WEIGHT);
  });

  it('每次查看手牌都按牌力自动从大到小排列（2 最小）', () => {
    const allCards = createPokerCards();
    const ids = ['3-diamonds', 'A-clubs', 'joker-red', '2-hearts', 'joker-black', 'K-spades'];
    const cards = ids.map((id) => allCards.find((card) => card.id === id)!);
    const deck = new PokerDeck(cards, new Rng(1));

    deck.drawMany(cards.length);

    expect(deck.hand.map((card) => card.id)).toEqual([
      'joker-red',
      'joker-black',
      'A-clubs',
      'K-spades',
      '3-diamonds',
      '2-hearts',
    ]);
  });

  it('reset 清空手牌与回收权重，恢复为全新一副牌', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const [card] = deck.drawMany(1);
    deck.play([card!.id]);
    expect(deck.getAvailableWeight(card!.id)).toBe(RETURNED_CARD_WEIGHT);

    deck.reset();

    expect(deck.hand).toHaveLength(0);
    expect(deck.availableCount).toBe(54);
    expect(deck.getAvailableWeight(card!.id)).toBe(FRESH_CARD_WEIGHT);
  });
});
