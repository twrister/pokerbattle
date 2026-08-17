import { describe, expect, it } from 'vitest';
import { Rng } from '@pb/sim';
import {
  MAX_HAND_SIZE,
  PokerDeck,
  RETURN_MIN_DEPTH,
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

  it('无视上限抽牌在满手时仍能入手，空堆返回 undefined', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    deck.drawMany(20);
    expect(deck.hand).toHaveLength(MAX_HAND_SIZE);
    expect(deck.draw()).toBeUndefined();

    const extra = deck.drawIgnoringLimit();
    expect(extra).toBeDefined();
    expect(deck.hand).toHaveLength(MAX_HAND_SIZE + 1);

    deck.reset();
    deck.drawMany(54);
    while (deck.drawIgnoringLimit()) {
      // 抽尽剩余牌堆
    }
    expect(deck.availableCount).toBe(0);
    expect(deck.drawIgnoringLimit()).toBeUndefined();
  });

  it('抽牌离开有限牌堆且不能突破手牌上限', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const drawn = deck.drawMany(20);

    expect(drawn).toHaveLength(MAX_HAND_SIZE);
    expect(deck.hand).toHaveLength(MAX_HAND_SIZE);
    expect(deck.availableCount).toBe(54 - MAX_HAND_SIZE);
    expect(new Set(drawn.map((card) => card.id))).toHaveLength(MAX_HAND_SIZE);
    expect(deck.draw()).toBeUndefined();
  });

  it('可下调抽牌上限且不丢已有手牌', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    deck.drawMany(6);
    deck.setMaxHandSize(4);

    expect(deck.hand).toHaveLength(6);
    expect(deck.draw()).toBeUndefined();
  });

  it('出牌后插回牌顶 5 张之后，且随后 5 张都不是它', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const [card] = deck.drawMany(1);
    const pileBeforePlay = deck.availableCount;

    expect(card).toBeDefined();
    expect(deck.getAvailableDepth(card!.id)).toBeUndefined();

    expect(deck.play([card!.id, card!.id])).toEqual([card]);
    expect(deck.hand).toHaveLength(0);
    expect(deck.availableCount).toBe(54);
    expect(deck.getAvailableDepth(card!.id)).toBeGreaterThanOrEqual(
      Math.min(RETURN_MIN_DEPTH, pileBeforePlay),
    );

    const nextFive = deck.drawMany(RETURN_MIN_DEPTH);
    expect(nextFive).toHaveLength(RETURN_MIN_DEPTH);
    expect(nextFive.map((drawn) => drawn.id)).not.toContain(card!.id);
  });

  it('堆里只剩 3 张时打出只能插到牌底，第 4 张才是它', () => {
    const allCards = createPokerCards().slice(0, 4);
    const deck = new PokerDeck(allCards, new Rng(1));
    const [card] = deck.drawMany(1);

    expect(deck.availableCount).toBe(3);
    deck.play([card!.id]);
    expect(deck.getAvailableDepth(card!.id)).toBe(3);

    const nextThree = deck.drawMany(3);
    expect(nextThree.map((drawn) => drawn.id)).not.toContain(card!.id);
    expect(deck.draw()?.id).toBe(card!.id);
  });

  it('空堆回牌后下一张就是它', () => {
    const allCards = createPokerCards().slice(0, 1);
    const deck = new PokerDeck(allCards, new Rng(1));
    const [card] = deck.drawMany(1);

    expect(deck.availableCount).toBe(0);
    deck.play([card!.id]);
    expect(deck.getAvailableDepth(card!.id)).toBe(0);
    expect(deck.draw()?.id).toBe(card!.id);
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

  it('reset 清空手牌并重新洗牌，回收深度不再保留', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const [card] = deck.drawMany(1);
    deck.play([card!.id]);
    expect(deck.getAvailableDepth(card!.id)).toBeGreaterThanOrEqual(RETURN_MIN_DEPTH);

    deck.reset();

    expect(deck.hand).toHaveLength(0);
    expect(deck.availableCount).toBe(54);
    expect(deck.getAvailableDepth(card!.id)).toBeDefined();
  });
});
