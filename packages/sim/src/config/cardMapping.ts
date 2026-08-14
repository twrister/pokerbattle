import { getCardStrength, getPokerCardById, type CardRank, type PlayingCard } from '../cards/deck.js';
import { fromFloat, type Fx } from '../math/fixed.js';
import { UNIT_CONFIGS, type UnitTypeId } from './units.js';
import type {
  FormationMatchRule,
  HandCategory,
} from './cardFormations.js';

/** 合法点数集合，供配置校验与预览复用。 */
export const FORMATION_MATCH_RANKS: readonly CardRank[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const;

/** 引信炸弹伤害档：数字牌 2～10 共用一档，J/Q/K/A 各一档。 */
export type FuseBombDamageRank = '2-10' | 'J' | 'Q' | 'K' | 'A';

export const FUSE_BOMB_DAMAGE_RANKS: readonly FuseBombDamageRank[] = [
  '2-10',
  'J',
  'Q',
  'K',
  'A',
] as const;

/** 卡组页标签；键与 JSON 档位一致。 */
export const FUSE_BOMB_DAMAGE_RANK_LABELS: Readonly<Record<FuseBombDamageRank, string>> = {
  '2-10': '2～10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
};

/** 把牌面点数映射到伤害档；王牌没有点数档。 */
export function fuseBombDamageRankOf(rank: PlayingCard['rank']): FuseBombDamageRank | null {
  if (rank === 'JOKER') return null;
  if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === 'A') return rank;
  return '2-10';
}

/** 规则阵型中的单个出兵位；等级由展开逻辑统一赋 1。 */
export interface MappedFormationUnit {
  typeId: UnitTypeId;
  level: number;
}

/** 判断点数是否走民兵/弓手的 1～9 级阶梯。 */
function isNumberRank(card: PlayingCard): boolean {
  return !card.joker && ['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(card.rank);
}

/** 获取组合中牌力最大的牌；规则牌型保证 cards 非空。 */
function strongestCard(cards: readonly PlayingCard[]): PlayingCard {
  return cards.reduce((strongest, card) => (getCardStrength(card) > getCardStrength(strongest) ? card : strongest));
}

/** 手牌是否命中配置的牌面匹配规则。 */
export function cardsMatchRule(cards: readonly PlayingCard[], match: FormationMatchRule): boolean {
  if (cards.length === 0) return false;
  switch (match.kind) {
    case 'any':
      return true;
    case 'numbers':
      return cards.every((card) => isNumberRank(card));
    case 'joker':
      return cards.length === 1 && cards[0]!.joker === match.joker;
    case 'ranks': {
      // 王牌不走点数集合；去重后的点数集合必须与配置完全一致。
      if (cards.some((card) => card.joker)) return false;
      const unique = new Set(cards.map((card) => card.rank));
      if (unique.size !== match.ranks.length) return false;
      return match.ranks.every((rank) => unique.has(rank));
    }
  }
}

/**
 * 校验牌面匹配后，按配置 rows 展开站位。
 * 阵型不再单独配等级规则，出兵统一 1 级。
 * 不适用时返回 null，调用方不应向玩家展示。
 */
export function resolveMappedRows(
  rows: readonly (readonly UnitTypeId[])[],
  match: FormationMatchRule,
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  if (!cardsMatchRule(cards, match)) return null;
  return rows.map((row) => row.map((typeId) => ({ typeId, level: 1 })));
}

/** 按攻击类型将近战排在前、远程排在后，每排最多三名以控制阵型宽度。 */
export function layoutMappedUnits(units: readonly MappedFormationUnit[]): MappedFormationUnit[][] {
  const melee: MappedFormationUnit[] = [];
  const ranged: MappedFormationUnit[] = [];
  for (const unit of units) {
    const attack = UNIT_CONFIGS[unit.typeId].attack.kind;
    (attack === 'melee' || attack === 'melee_aoe' ? melee : ranged).push(unit);
  }
  return [...chunk(melee, 3), ...chunk(ranged, 3)];
}

/** 将兵种列表按固定列数分行，保持输入顺序以确保联机确定性。 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/**
 * 按阵型配置查引信炸弹伤害：火箭读固定伤，其余按最强牌点数查表。
 * 缺档或缺字段时返回 undefined，调用方回落单位配置。
 */
export function resolveFuseBombDamage(
  formation: FuseBombDamageSource,
  cards: readonly PlayingCard[],
): Fx | undefined {
  if (cards.length === 0) return undefined;
  if (formation.category === 'rocket') {
    return formation.damage !== undefined ? fromFloat(formation.damage) : undefined;
  }
  const top = strongestCard(cards);
  const key = fuseBombDamageRankOf(top.rank);
  if (!key) {
    return formation.damage !== undefined ? fromFloat(formation.damage) : undefined;
  }
  const value = formation.rankDamage?.[key];
  return value !== undefined ? fromFloat(value) : undefined;
}

/** 引信炸弹伤害配置来源；与阵型上的可选字段对齐。 */
export interface FuseBombDamageSource {
  category: HandCategory;
  rankDamage?: Partial<Record<FuseBombDamageRank, number>>;
  damage?: number;
}

/** 预览用：按牌型决定每个点数生成几张牌。 */
function previewCopiesForCategory(category: HandCategory): number {
  switch (category) {
    case 'pair':
    case 'two_pair':
      return 2;
    case 'triple':
      return 3;
    default:
      return 1;
  }
}

/** 按点数列表生成预览样例牌；花色循环以保证 id 不重复。 */
function previewCardsFromRanks(
  ranks: readonly CardRank[],
  copies: number,
  card: (id: string) => PlayingCard,
): PlayingCard[] {
  const suits = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
  const result: PlayingCard[] = [];
  let suitIndex = 0;
  for (const rank of ranks) {
    for (let i = 0; i < copies; i += 1) {
      result.push(card(`${rank}-${suits[suitIndex % suits.length]!}`));
      suitIndex += 1;
    }
  }
  return result;
}

/** 数字牌 / any 时各牌型的默认预览样例，与改造前画面保持一致。 */
function previewCardsForNumbersOrAny(
  category: HandCategory,
  card: (id: string) => PlayingCard,
): PlayingCard[] {
  switch (category) {
    case 'single':
      return [card('5-spades')];
    case 'pair':
      return [card('5-spades'), card('5-hearts')];
    case 'triple':
      return [card('5-spades'), card('5-hearts'), card('5-clubs')];
    case 'straight3':
      return [card('8-spades'), card('9-hearts'), card('10-clubs')];
    case 'two_pair':
      return [card('4-spades'), card('4-hearts'), card('5-clubs'), card('5-diamonds')];
    case 'straight4':
      return [card('6-spades'), card('7-hearts'), card('8-clubs'), card('9-diamonds')];
    case 'straight5':
      return [
        card('2-spades'),
        card('3-hearts'),
        card('4-clubs'),
        card('5-diamonds'),
        card('6-spades'),
      ];
    case 'flush':
      return [card('2-spades'), card('4-spades'), card('6-spades'), card('8-spades'), card('J-spades')];
    case 'full_house':
      return [card('5-spades'), card('5-hearts'), card('5-clubs'), card('9-diamonds'), card('9-spades')];
    case 'bomb':
      return [card('5-spades'), card('5-hearts'), card('5-clubs'), card('5-diamonds')];
    case 'rocket':
      return [card('joker-black'), card('joker-red')];
    case 'straight_flush':
      return [
        card('6-spades'),
        card('7-spades'),
        card('8-spades'),
        card('9-spades'),
        card('10-spades'),
      ];
  }
}

/**
 * 卡组页预览用的样例手牌。
 * 按 formation.match 生成；numbers/any 使用各牌型默认数字样例。
 */
export function getPreviewCardsForFormation(
  category: HandCategory,
  formation: { match: FormationMatchRule },
): PlayingCard[] {
  const card = (id: string): PlayingCard => {
    const found = getPokerCardById(id);
    if (!found) throw new Error(`缺少预览样例牌：${id}`);
    return found;
  };

  const match = formation.match;
  if (match.kind === 'joker') {
    return [card(match.joker === 'black' ? 'joker-black' : 'joker-red')];
  }
  if (match.kind === 'ranks') {
    return previewCardsFromRanks(match.ranks, previewCopiesForCategory(category), card);
  }
  return previewCardsForNumbersOrAny(category, card);
}
