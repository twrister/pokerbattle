import { Rng } from '../math/rng.js';

export const INITIAL_HAND_SIZE = 4;
/** 局内绝对手牌上限，等于决胜阶段默认上限。 */
export const MAX_HAND_SIZE = 11;
/** 常规阶段默认手牌上限。 */
export const HAND_LIMIT_NORMAL = 9;
/** 倍速阶段默认手牌上限。 */
export const HAND_LIMIT_DOUBLE_SPEED = 10;
/** 决胜阶段默认手牌上限。 */
export const HAND_LIMIT_FINAL = 11;

/** 把张数夹到局内合法区间，供 MatchState 与运行控制共用。 */
export function clampHandSize(size: number): number {
  if (!Number.isFinite(size)) return INITIAL_HAND_SIZE;
  return Math.max(1, Math.min(MAX_HAND_SIZE, Math.floor(size)));
}
/** 新牌权重（整数）；与 RETURNED 比约为 4:1，对应旧版 1 : 0.25。 */
export const FRESH_CARD_WEIGHT = 4;
/** 打出回收后的权重，降低立刻重抽概率。 */
export const RETURNED_CARD_WEIGHT = 1;

export type CardSuit = 'spades' | 'hearts' | 'clubs' | 'diamonds';
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/** 纯逻辑牌面；贴图路径由客户端按 rank/suit 推导，避免 sim 依赖资源。 */
export interface PlayingCard {
  id: string;
  rank: CardRank | 'JOKER';
  suit?: CardSuit;
  label: string;
  joker?: 'black' | 'red';
}

interface AvailableCard {
  card: PlayingCard;
  weight: number;
}

const SUITS: ReadonlyArray<{ id: CardSuit; symbol: string }> = [
  { id: 'spades', symbol: '♠' },
  { id: 'hearts', symbol: '♥' },
  { id: 'clubs', symbol: '♣' },
  { id: 'diamonds', symbol: '♦' },
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
    SUITS.map(({ id, symbol }) => ({
      id: `${rank}-${id}`,
      rank,
      suit: id,
      label: `${rank}${symbol}`,
    })),
  );

  cards.push(
    {
      id: 'joker-black',
      rank: 'JOKER',
      joker: 'black',
      label: '小王',
    },
    {
      id: 'joker-red',
      rank: 'JOKER',
      joker: 'red',
      label: '大王',
    },
  );
  return cards;
}

/** 按稳定 id 查询标准牌面，供出牌指令从 cardIds 还原等级映射。 */
export function getPokerCardById(cardId: string): PlayingCard | undefined {
  return STANDARD_DECK_BY_ID.get(cardId);
}

/** 标准牌堆的只读索引，避免每次展开出牌指令都重新创建 54 张牌。 */
const STANDARD_DECK_BY_ID = new Map(createPokerCards().map((card) => [card.id, card]));

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

/**
 * 管理有限牌堆与手牌。
 * 随机源必须注入 Rng，用整数权重抽取，保证联机/回放确定性。
 */
export class PokerDeck {
  private readonly available = new Map<string, AvailableCard>();
  private readonly cardsInHand = new Map<string, PlayingCard>();
  /** 当前可持有张数；阶段切换时由 MatchState 改写，下调不丢已有手牌。 */
  private currentMaxHandSize = MAX_HAND_SIZE;

  constructor(
    cards: readonly PlayingCard[] = createPokerCards(),
    private readonly rng: Rng = new Rng(1),
  ) {
    for (const card of cards) {
      this.available.set(card.id, { card, weight: FRESH_CARD_WEIGHT });
    }
  }

  /** 当前抽牌上限；满手后 draw 直接返回。 */
  get maxHandSize(): number {
    return this.currentMaxHandSize;
  }

  /** 更新抽牌上限，不丢已有手牌。 */
  setMaxHandSize(size: number): void {
    this.currentMaxHandSize = clampHandSize(size);
  }

  get hand(): readonly PlayingCard[] {
    return [...this.cardsInHand.values()].sort(compareCardsByStrength);
  }

  get availableCount(): number {
    return this.available.size;
  }

  /** 手牌中是否持有指定 id。 */
  hasInHand(cardId: string): boolean {
    return this.cardsInHand.has(cardId);
  }

  /** 按当前整数权重抽一张；抽出的牌离开牌堆直到被打出后回收。 */
  draw(): PlayingCard | undefined {
    if (this.cardsInHand.size >= this.currentMaxHandSize) return undefined;
    return this.drawFromAvailable();
  }

  /**
   * 按原权重抽一张，但无视手牌上限。
   * 城堡保护等奖励补牌用；牌堆空时仍返回 undefined。
   */
  drawIgnoringLimit(): PlayingCard | undefined {
    return this.drawFromAvailable();
  }

  /** 连续补牌但不突破手牌上限。 */
  drawMany(count: number): PlayingCard[] {
    const drawn: PlayingCard[] = [];
    for (let index = 0; index < count; index += 1) {
      const card = this.draw();
      if (!card) break;
      drawn.push(card);
    }
    return drawn;
  }

  /** 从剩余牌堆按权重抽一张并入手；不做手牌上限检查。 */
  private drawFromAvailable(): PlayingCard | undefined {
    if (this.available.size === 0) return undefined;

    // 按 id 排序再抽，避免 Map 迭代顺序造成跨端分叉
    const entries = [...this.available.values()].sort((a, b) => (a.card.id < b.card.id ? -1 : 1));
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = this.rng.nextInt(totalWeight);
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

  /** 将有效手牌放回牌堆并降低权重。 */
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

  /** 暴露只读权重用于状态展示与单元测试。 */
  getAvailableWeight(cardId: string): number | undefined {
    return this.available.get(cardId)?.weight;
  }

  /**
   * 原地清空手牌与牌堆权重，恢复为全新一副牌。
   * 保持实例引用不变，避免 UI 仍握着旧 deck 导致清空后无法出牌。
   */
  reset(cards: readonly PlayingCard[] = createPokerCards()): void {
    this.available.clear();
    this.cardsInHand.clear();
    for (const card of cards) {
      this.available.set(card.id, { card, weight: FRESH_CARD_WEIGHT });
    }
  }

  /** 牌堆+手牌指纹，供 MatchState 对账。 */
  hash(): number {
    let h = 0x811c9dc5;
    h = mix(h, this.currentMaxHandSize);
    h = mix(h, this.cardsInHand.size);
    const handIds = [...this.cardsInHand.keys()].sort();
    for (const id of handIds) h = mixString(h, id);
    const availableIds = [...this.available.keys()].sort();
    for (const id of availableIds) {
      h = mixString(h, id);
      h = mix(h, this.available.get(id)!.weight);
    }
    return h >>> 0;
  }
}

/** FNV-1a，逐字节混入一个 32 位整数 */
function mix(hash: number, value: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (value >>> shift) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/** 把字符串逐字节混入指纹。 */
function mixString(hash: number, value: string): number {
  let h = hash;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}
