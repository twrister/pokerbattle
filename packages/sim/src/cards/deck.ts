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
/** 刚打出的牌本体接下来至少这么多次抽牌不会被抽到。 */
export const RETURN_MIN_DEPTH = 5;
/** 权重 = waitDraws + 该值，避免等待 0 的牌权为 0；改成更大可加强「越久越容易」。 */
const DRAW_WAIT_WEIGHT_OFFSET = 1;

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

/** 堆中一张牌的等待与冷却，仅牌堆内部使用。 */
interface PileEntry {
  card: PlayingCard;
  /** 在堆里熬过的抽牌次数；刚打出或开局为 0。 */
  waitDraws: number;
  /** 剩余禁止被抽的次数；刚打出为 RETURN_MIN_DEPTH。 */
  cooldown: number;
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
 * 随机源必须注入 Rng：开局洗牌、加权抽取都走同一实例，保证联机/回放确定性。
 */
export class PokerDeck {
  /** 未在手牌中的牌；抽取按等待加权，不再固定从下标 0 取。 */
  private readonly pile: PileEntry[] = [];
  private readonly cardsInHand = new Map<string, PlayingCard>();
  /** 当前可持有张数；阶段切换时由 MatchState 改写，下调不丢已有手牌。 */
  private currentMaxHandSize = MAX_HAND_SIZE;

  constructor(
    cards: readonly PlayingCard[] = createPokerCards(),
    private readonly rng: Rng = new Rng(1),
  ) {
    this.refill(cards);
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
    return this.pile.length;
  }

  /** 手牌中是否持有指定 id。 */
  hasInHand(cardId: string): boolean {
    return this.cardsInHand.has(cardId);
  }

  /** 从牌堆加权抽一张；抽出的牌离开牌堆直到被打出后回堆冷却。 */
  draw(): PlayingCard | undefined {
    if (this.cardsInHand.size >= this.currentMaxHandSize) return undefined;
    return this.drawFromAvailable();
  }

  /**
   * 加权抽一张，但无视手牌上限。
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

  /**
   * 在冷却外的牌里按等待加权抽取；堆太小时才允许抽到仍在冷却的牌，避免抽不完。
   * 抽出后让剩余牌变「更老」、冷却推进一拍，这样越久没摸到的牌权重越高。
   */
  private drawFromAvailable(): PlayingCard | undefined {
    if (this.pile.length === 0) return undefined;
    const eligible = this.pile.filter((entry) => entry.cooldown <= 0);
    const pool = eligible.length > 0 ? eligible : this.pile;
    const picked = this.pickWeighted(pool);
    const index = this.pile.indexOf(picked);
    this.pile.splice(index, 1);
    this.ageRemainingEntries();
    this.cardsInHand.set(picked.card.id, picked.card);
    return picked.card;
  }

  /** 权重随等待线性增长，等待更久的牌占更大抽选区间。 */
  private pickWeighted(entries: readonly PileEntry[]): PileEntry {
    let total = 0;
    for (const entry of entries) {
      total += entry.waitDraws + DRAW_WAIT_WEIGHT_OFFSET;
    }
    let roll = this.rng.nextInt(total);
    for (const entry of entries) {
      roll -= entry.waitDraws + DRAW_WAIT_WEIGHT_OFFSET;
      if (roll < 0) return entry;
    }
    return entries[entries.length - 1]!;
  }

  /** 每次成功抽牌后推进堆中剩余牌的等待与冷却。 */
  private ageRemainingEntries(): void {
    for (const entry of this.pile) {
      entry.waitDraws += 1;
      if (entry.cooldown > 0) entry.cooldown -= 1;
    }
  }

  /** 将有效手牌回堆并进入冷却，避免刚打出的本体立刻被再摸到。 */
  play(cardIds: Iterable<string>): PlayingCard[] {
    const played: PlayingCard[] = [];
    for (const cardId of new Set(cardIds)) {
      const card = this.cardsInHand.get(cardId);
      if (!card) continue;
      this.cardsInHand.delete(cardId);
      this.pile.push({ card, waitDraws: 0, cooldown: RETURN_MIN_DEPTH });
      played.push(card);
    }
    return played;
  }

  /** 不在堆中则 undefined。供单测断言回牌冷却。 */
  getReturnCooldown(cardId: string): number | undefined {
    const entry = this.pile.find((item) => item.card.id === cardId);
    return entry ? entry.cooldown : undefined;
  }

  /** 不在堆中则 undefined。供单测断言等待清零。 */
  getWaitDraws(cardId: string): number | undefined {
    const entry = this.pile.find((item) => item.card.id === cardId);
    return entry ? entry.waitDraws : undefined;
  }

  /** 仅供单测拉开等待差距，不参与对局逻辑。 */
  setWaitDrawsForTest(cardId: string, waitDraws: number): void {
    const entry = this.pile.find((item) => item.card.id === cardId);
    if (entry) entry.waitDraws = waitDraws;
  }

  /**
   * 原地清空手牌并重新洗一副牌。
   * 保持实例引用不变，避免 UI 仍握着旧 deck 导致清空后无法出牌。
   */
  reset(cards: readonly PlayingCard[] = createPokerCards()): void {
    this.cardsInHand.clear();
    this.refill(cards);
  }

  /** 用当前牌面填满牌堆并洗牌，开局与 reset 共用；等待与冷却一并清零。 */
  private refill(cards: readonly PlayingCard[]): void {
    this.pile.length = 0;
    for (const card of cards) {
      this.pile.push({ card, waitDraws: 0, cooldown: 0 });
    }
    for (let i = this.pile.length - 1; i > 0; i -= 1) {
      const j = this.rng.nextInt(i + 1);
      const tmp = this.pile[i]!;
      this.pile[i] = this.pile[j]!;
      this.pile[j] = tmp;
    }
  }

  /** 牌堆+手牌指纹，供 MatchState 对账；按 id 排序后混入等待/冷却，避免堆数组顺序干扰。 */
  hash(): number {
    let h = 0x811c9dc5;
    h = mix(h, this.currentMaxHandSize);
    h = mix(h, this.cardsInHand.size);
    const handIds = [...this.cardsInHand.keys()].sort();
    for (const id of handIds) h = mixString(h, id);
    const pileEntries = [...this.pile].sort((left, right) =>
      left.card.id < right.card.id ? -1 : left.card.id > right.card.id ? 1 : 0,
    );
    for (const entry of pileEntries) {
      h = mixString(h, entry.card.id);
      h = mix(h, entry.waitDraws);
      h = mix(h, entry.cooldown);
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
