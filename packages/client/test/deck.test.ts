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

  it('出牌后进入冷却，随后 5 张都不是它', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const [card] = deck.drawMany(1);

    expect(card).toBeDefined();
    expect(deck.getReturnCooldown(card!.id)).toBeUndefined();

    expect(deck.play([card!.id, card!.id])).toEqual([card]);
    expect(deck.hand).toHaveLength(0);
    expect(deck.availableCount).toBe(54);
    expect(deck.getReturnCooldown(card!.id)).toBe(RETURN_MIN_DEPTH);
    expect(deck.getWaitDraws(card!.id)).toBe(0);

    const nextFive = deck.drawMany(RETURN_MIN_DEPTH);
    expect(nextFive).toHaveLength(RETURN_MIN_DEPTH);
    expect(nextFive.map((drawn) => drawn.id)).not.toContain(card!.id);
    expect(deck.getReturnCooldown(card!.id)).toBe(0);
  });

  it('堆里只剩 3 张时打出后先抽完其余牌，第 4 张才是它', () => {
    const allCards = createPokerCards().slice(0, 4);
    const deck = new PokerDeck(allCards, new Rng(1));
    const [card] = deck.drawMany(1);

    expect(deck.availableCount).toBe(3);
    deck.play([card!.id]);
    expect(deck.getReturnCooldown(card!.id)).toBe(RETURN_MIN_DEPTH);

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
    expect(deck.getReturnCooldown(card!.id)).toBe(RETURN_MIN_DEPTH);
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

  it('reset 清空手牌并重新洗牌，冷却与等待一并清零', () => {
    const deck = new PokerDeck(createPokerCards(), new Rng(1));
    const [card] = deck.drawMany(1);
    deck.play([card!.id]);
    expect(deck.getReturnCooldown(card!.id)).toBe(RETURN_MIN_DEPTH);

    deck.reset();

    expect(deck.hand).toHaveLength(0);
    expect(deck.availableCount).toBe(54);
    expect(deck.getReturnCooldown(card!.id)).toBe(0);
    expect(deck.getWaitDraws(card!.id)).toBe(0);
  });

  it('等待或冷却不同则牌堆指纹分叉', () => {
    const cards = createPokerCards().slice(0, 2);
    const left = new PokerDeck(cards, new Rng(1));
    const right = new PokerDeck(cards, new Rng(1));
    expect(left.hash()).toBe(right.hash());

    left.setWaitDrawsForTest(cards[0]!.id, 7);
    expect(left.hash()).not.toBe(right.hash());
  });

  it('等待更久的牌更容易被抽到', () => {
    const [older, newer] = createPokerCards();
    let olderHits = 0;
    const trials = 40;
    for (let seed = 1; seed <= trials; seed += 1) {
      const deck = new PokerDeck([older!, newer!], new Rng(seed));
      deck.setWaitDrawsForTest(older!.id, 99);
      deck.setWaitDrawsForTest(newer!.id, 0);
      if (deck.draw()?.id === older!.id) olderHits += 1;
    }
    expect(olderHits).toBeGreaterThan(trials * 0.8);
  });
});
