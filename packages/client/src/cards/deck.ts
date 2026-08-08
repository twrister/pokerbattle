export const INITIAL_HAND_SIZE = 3;
export const MAX_HAND_SIZE = 10;
export const FRESH_CARD_WEIGHT = 1;
export const RETURNED_CARD_WEIGHT = 0.25;

export type CardSuit = 'spades' | 'hearts' | 'clubs' | 'diamonds';
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface PlayingCard {
  id: string;
  rank: CardRank | 'JOKER';
  suit?: CardSuit;
  label: string;
  imageUrl: string;
  joker?: 'black' | 'red';
}

interface AvailableCard {
  card: PlayingCard;
  weight: number;
}

const SUITS: ReadonlyArray<{ id: CardSuit; fileIndex: number; symbol: string }> = [
  { id: 'spades', fileIndex: 1, symbol: '♠' },
  { id: 'hearts', fileIndex: 2, symbol: '♥' },
  { id: 'clubs', fileIndex: 3, symbol: '♣' },
  { id: 'diamonds', fileIndex: 4, symbol: '♦' },
];

const RANKS: readonly CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
/** 点数牌力：2 最小，A 最大；大小王另计。 */
const RANK_STRENGTH: Readonly<Record<CardRank, number>> = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  '10': 10,
  '9': 9,
  '8': 8,
  '7': 7,
  '6': 6,
  '5': 5,
  '4': 4,
  '3': 3,
  '2': 2,
};
const SUIT_STRENGTH: Readonly<Record<CardSuit, number>> = {
  spades: 4,
  hearts: 3,
  clubs: 2,
  diamonds: 1,
};

/** 按素材命名生成完整 54 张牌，避免维护易漏的手写清单。 */
export function createPokerCards(): PlayingCard[] {
  const cards: PlayingCard[] = RANKS.flatMap((rank) =>
    SUITS.map(({ id, fileIndex, symbol }) => ({
      id: `${rank}-${id}`,
      rank,
      suit: id,
      label: `${rank}${symbol}`,
      imageUrl: `/cards/${rank}_${fileIndex}.png`,
    })),
  );

  cards.push(
    {
      id: 'joker-black',
      rank: 'JOKER',
      joker: 'black',
      label: '小王',
      imageUrl: '/cards/Joker_1.png',
    },
    {
      id: 'joker-red',
      rank: 'JOKER',
      joker: 'red',
      label: '大王',
      imageUrl: '/cards/Joker_2.png',
    },
  );
  return cards;
}

/** 按牌力从大到小排序，同点数以黑桃、红桃、梅花、方片稳定排列。 */
export function compareCardsByStrength(left: PlayingCard, right: PlayingCard): number {
  const strengthDiff = getCardStrength(right) - getCardStrength(left);
  if (strengthDiff !== 0) return strengthDiff;
  return (SUIT_STRENGTH[right.suit ?? 'diamonds'] ?? 0) - (SUIT_STRENGTH[left.suit ?? 'diamonds'] ?? 0);
}

/** 大小王最强，其余按 A>K>…>3>2。 */
export function getCardStrength(card: PlayingCard): number {
  if (card.joker === 'red') return 17;
  if (card.joker === 'black') return 16;
  return RANK_STRENGTH[card.rank as CardRank];
}

/** 管理有限牌堆与手牌；随机源可注入，便于测试和未来接入确定性回放。 */
export class PokerDeck {
  private readonly available = new Map<string, AvailableCard>();
  private readonly cardsInHand = new Map<string, PlayingCard>();

  constructor(
    cards: readonly PlayingCard[] = createPokerCards(),
    private readonly random: () => number = Math.random,
  ) {
    for (const card of cards) {
      this.available.set(card.id, { card, weight: FRESH_CARD_WEIGHT });
    }
  }

  get hand(): readonly PlayingCard[] {
    return [...this.cardsInHand.values()].sort(compareCardsByStrength);
  }

  get availableCount(): number {
    return this.available.size;
  }

  /** 按当前权重抽一张牌；抽出的牌会离开牌堆，直到被打出后回收。 */
  draw(): PlayingCard | undefined {
    if (this.cardsInHand.size >= MAX_HAND_SIZE || this.available.size === 0) return undefined;

    const entries = [...this.available.values()];
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = Math.min(Math.max(this.random(), 0), 1 - Number.EPSILON) * totalWeight;
    let selected = entries.at(-1)!;

    for (const entry of entries) {
      cursor -= entry.weight;
      if (cursor < 0) {
        selected = entry;
        break;
      }
    }

    this.available.delete(selected.card.id);
    this.cardsInHand.set(selected.card.id, selected.card);
    return selected.card;
  }

  /** 连续补牌但不突破手牌上限，返回实际抽到的牌供视图逐张播放动画。 */
  drawMany(count: number): PlayingCard[] {
    const drawn: PlayingCard[] = [];
    for (let index = 0; index < count; index += 1) {
      const card = this.draw();
      if (!card) break;
      drawn.push(card);
    }
    return drawn;
  }

  /** 将有效手牌放回牌堆并降低权重，避免刚打出的牌频繁立刻重抽。 */
  play(cardIds: Iterable<string>): PlayingCard[] {
    const played: PlayingCard[] = [];
    for (const cardId of new Set(cardIds)) {
      const card = this.cardsInHand.get(cardId);
      if (!card) continue;
      this.cardsInHand.delete(cardId);
      this.available.set(cardId, { card, weight: RETURNED_CARD_WEIGHT });
      played.push(card);
    }
    return played;
  }

  /** 暴露只读权重用于状态展示与单元测试，不允许外部篡改牌堆。 */
  getAvailableWeight(cardId: string): number | undefined {
    return this.available.get(cardId)?.weight;
  }
}
