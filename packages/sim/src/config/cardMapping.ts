import { getCardStrength, getPokerCardById, type PlayingCard } from '../cards/deck.js';
import { fromFloat, type Fx } from '../math/fixed.js';
import { UNIT_CONFIGS, UNIT_LEVELS_ENABLED, type UnitTypeId } from './units.js';
import type { HandCategory } from './cardFormations.js';

/** 三条兑换小炸弹：基础伤害；最终伤害 = 基础 + 牌力 × 系数。 */
export const TRIPLE_SMALL_BOMB_DAMAGE_BASE = 300;
/** 三条兑换小炸弹：每点牌力增加的伤害。 */
export const TRIPLE_SMALL_BOMB_DAMAGE_PER_STRENGTH = 50;

/** 规则阵型中的单个出兵位，等级随实际出牌点数推导。 */
export interface MappedFormationUnit {
  typeId: UnitTypeId;
  level: number;
}

type UnitChoice = 'melee' | 'ranged' | 'rank' | 'tower' | 'chariot' | 'dragon' | 'bomb';

/**
 * 点数阵型匹配键（单张/对子共用），与 formationId 后缀约定一致：
 * `_grunt`/`_archer`→数字牌，`_J`/`_Q`/`_K`/`_A`/`_joker_black`/`_joker_red`→对应点数。
 */
export type RankFormationKey = 'number' | 'J' | 'Q' | 'K' | 'A' | 'joker_black' | 'joker_red';
/** @deprecated 使用 RankFormationKey */
export type SingleFormationKey = RankFormationKey;

/**
 * 根据静态阵型 id 识别其可选方案。
 * 规则由代码统一维护，JSON 只保留方案的 id、名称和缩略图参数。
 */
function choiceFromFormationId(id: string): UnitChoice {
  if (id.includes('_archer')) return 'ranged';
  if (id.includes('_grunt')) return 'melee';
  if (id.includes('_tower')) return 'tower';
  if (id.includes('_chariot')) return 'chariot';
  if (id.includes('_dragon')) return 'dragon';
  if (id.includes('_bomb')) return 'bomb';
  return 'rank';
}

/** 从阵型 id 解析点数匹配键；无法识别时返回 null（自定义未命名方案不出兵）。 */
export function parseRankFormationKey(formationId: string): RankFormationKey | null {
  if (formationId.includes('_joker_black')) return 'joker_black';
  if (formationId.includes('_joker_red')) return 'joker_red';
  if (formationId.includes('_grunt') || formationId.includes('_archer')) return 'number';
  const face = /_(J|Q|K|A)$/.exec(formationId);
  if (face?.[1] === 'J' || face?.[1] === 'Q' || face?.[1] === 'K' || face?.[1] === 'A') {
    return face[1];
  }
  return null;
}

/** @deprecated 使用 parseRankFormationKey */
export const parseSingleFormationKey = parseRankFormationKey;

/** 判断点数是否走民兵/弓手的 1～9 级阶梯。 */
function isNumberRank(card: PlayingCard): boolean {
  return !card.joker && ['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(card.rank);
}

/** 手牌是否命中点数阵型键。 */
export function cardMatchesRankKey(card: PlayingCard, key: RankFormationKey): boolean {
  if (key === 'number') return isNumberRank(card);
  if (key === 'joker_black') return card.joker === 'black';
  if (key === 'joker_red') return card.joker === 'red';
  return !card.joker && card.rank === key;
}

/** @deprecated 使用 cardMatchesRankKey */
export const cardMatchesSingleKey = cardMatchesRankKey;

/** 数字牌 2-10 对应 1-9 级。 */
function numberRankLevel(card: PlayingCard): number {
  return Number(card.rank) - 1;
}

/** 获取组合中牌力最大的牌；规则牌型保证 cards 非空。 */
function strongestCard(cards: readonly PlayingCard[]): PlayingCard {
  return cards.reduce((strongest, card) => (getCardStrength(card) > getCardStrength(strongest) ? card : strongest));
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

/** 等级关闭时把推算结果钳到 1 级，保留上方公式便于重新启用。 */
function applyLevelGate(units: MappedFormationUnit[]): MappedFormationUnit[] {
  if (UNIT_LEVELS_ENABLED) return units;
  return units.map((unit) => (unit.level === 1 ? unit : { ...unit, level: 1 }));
}

/**
 * 三顺点数段键，与 formationId 后缀约定一致：
 * `_number`→纯数字顺，`_A23`/`_910J`/`_10JQ`/`_JQK`/`_QKA`→对应固定点数段。
 */
export type Straight3SegmentKey = 'number' | 'A23' | '910J' | '10JQ' | 'JQK' | 'QKA';

/** 从阵型 id 解析三顺点数段；无法识别时返回 null。 */
export function parseStraight3SegmentKey(formationId: string): Straight3SegmentKey | null {
  if (formationId.includes('_A23')) return 'A23';
  if (formationId.includes('_910J')) return '910J';
  if (formationId.includes('_10JQ')) return '10JQ';
  if (formationId.includes('_JQK')) return 'JQK';
  if (formationId.includes('_QKA')) return 'QKA';
  if (formationId.includes('_number')) return 'number';
  return null;
}

/** 手牌点数是否命中指定三顺段（用 rank 集合，避免 A-2-3 与 Q-K-A 混淆）。 */
export function cardsMatchStraight3Segment(
  cards: readonly PlayingCard[],
  key: Straight3SegmentKey,
): boolean {
  if (cards.length !== 3 || cards.some((card) => card.joker)) return false;
  if (key === 'number') return cards.every((card) => isNumberRank(card));
  const sorted = [...new Set(cards.map((card) => card.rank))].sort().join(',');
  switch (key) {
    case 'A23':
      return sorted === '2,3,A';
    case '910J':
      return sorted === '10,9,J';
    case '10JQ':
      return sorted === '10,J,Q';
    case 'JQK':
      return sorted === 'J,K,Q';
    case 'QKA':
      return sorted === 'A,K,Q';
  }
}

/**
 * 三顺：校验点数段匹配后按配置 rows 展开站位（不重排）。
 * 纯数字段等级跟最大牌；含人头段固定 2 级。
 */
export function resolveStraight3MappedRows(
  formationId: string,
  rows: readonly (readonly UnitTypeId[])[],
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  const key = parseStraight3SegmentKey(formationId);
  if (!key || !cardsMatchStraight3Segment(cards, key)) return null;
  const level = key === 'number' ? numberRankLevel(strongestCard(cards)) : 2;
  return rows.map((row) => applyLevelGate(row.map((typeId) => ({ typeId, level }))));
}

/**
 * 五顺点数段键，与 formationId 后缀约定一致：
 * `_number`→纯数字五顺；`_A2345`/`_910JQK`/`_10JQKA`→对应固定点数段。
 */
export type Straight5SegmentKey = 'number' | 'A2345' | '910JQK' | '10JQKA';

/** 从阵型 id 解析五顺点数段；无法识别时返回 null。 */
export function parseStraight5SegmentKey(formationId: string): Straight5SegmentKey | null {
  // 先匹配更长后缀，避免被短串误伤。
  if (formationId.includes('_A2345')) return 'A2345';
  if (formationId.includes('_910JQK')) return '910JQK';
  if (formationId.includes('_10JQKA')) return '10JQKA';
  if (formationId.includes('_number')) return 'number';
  return null;
}

/** 手牌点数是否命中指定五顺段（用 rank 集合匹配）。 */
export function cardsMatchStraight5Segment(
  cards: readonly PlayingCard[],
  key: Straight5SegmentKey,
): boolean {
  if (cards.length !== 5 || cards.some((card) => card.joker)) return false;
  if (key === 'number') return cards.every((card) => isNumberRank(card));
  const sorted = [...new Set(cards.map((card) => card.rank))].sort().join(',');
  switch (key) {
    case 'A2345':
      return sorted === '2,3,4,5,A';
    case '910JQK':
      return sorted === '10,9,J,K,Q';
    case '10JQKA':
      return sorted === '10,A,J,K,Q';
  }
}

/**
 * 五顺：校验点数段匹配后按配置 rows 展开站位（不重排）。
 * 箭塔/战车为全局方案（任意合法五顺可用）；纯数字段等级跟最大牌；含人头段固定 2 级。
 */
export function resolveStraight5MappedRows(
  formationId: string,
  rows: readonly (readonly UnitTypeId[])[],
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  if (cards.length !== 5 || cards.some((card) => card.joker)) return null;

  // 箭塔/战车：任意五顺均可兑换，尊重配置 rows。
  if (formationId.includes('_tower') || formationId.includes('_chariot')) {
    return rows.map((row) => applyLevelGate(row.map((typeId) => ({ typeId, level: 1 }))));
  }

  const key = parseStraight5SegmentKey(formationId);
  if (!key || !cardsMatchStraight5Segment(cards, key)) return null;
  const level = key === 'number' ? numberRankLevel(strongestCard(cards)) : 2;
  return rows.map((row) => applyLevelGate(row.map((typeId) => ({ typeId, level }))));
}

/**
 * 连对点数段键，与 formationId 后缀约定一致：
 * `_number`→纯数字连对；`_A2`/`_10J`/`_JQ`/`_QK`/`_KA`→对应相邻段。
 */
export type TwoPairSegmentKey = 'number' | 'A2' | '10J' | 'JQ' | 'QK' | 'KA';

/** 从阵型 id 解析连对点数段；无法识别时返回 null。 */
export function parseTwoPairSegmentKey(formationId: string): TwoPairSegmentKey | null {
  // 先匹配更长/更具体后缀，避免被短串误伤。
  if (formationId.includes('_10J')) return '10J';
  if (formationId.includes('_A2')) return 'A2';
  if (formationId.includes('_JQ')) return 'JQ';
  if (formationId.includes('_QK')) return 'QK';
  if (formationId.includes('_KA')) return 'KA';
  if (formationId.includes('_number')) return 'number';
  return null;
}

/** 手牌点数是否命中指定连对段（用 rank 集合匹配相邻两对）。 */
export function cardsMatchTwoPairSegment(
  cards: readonly PlayingCard[],
  key: TwoPairSegmentKey,
): boolean {
  if (cards.length !== 4 || cards.some((card) => card.joker)) return false;
  const ranks = [...new Set(cards.map((card) => card.rank))];
  if (ranks.length !== 2) return false;
  // 纯数字连对：两对点数都必须在 2～10。
  if (key === 'number') return cards.every((card) => isNumberRank(card));
  const sorted = [...ranks].sort().join(',');
  switch (key) {
    case 'A2':
      return sorted === '2,A';
    case '10J':
      return sorted === '10,J';
    case 'JQ':
      return sorted === 'J,Q';
    case 'QK':
      return sorted === 'K,Q';
    case 'KA':
      return sorted === 'A,K';
  }
}

/**
 * 连对：校验点数段匹配后按配置 rows 展开站位（不重排）。
 * 纯数字段等级 = 最大牌点数等级 + 2；含人头段固定 4 级。
 */
export function resolveTwoPairMappedRows(
  formationId: string,
  rows: readonly (readonly UnitTypeId[])[],
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  const key = parseTwoPairSegmentKey(formationId);
  if (!key || !cardsMatchTwoPairSegment(cards, key)) return null;
  const top = strongestCard(cards);
  const level = key === 'number' ? numberRankLevel(top) + 2 : 4;
  return rows.map((row) => applyLevelGate(row.map((typeId) => ({ typeId, level }))));
}

/**
 * 三条兑换小炸弹伤害：300 + 牌力 × 50（牌力 2→400，A→1000）。
 * 仅用于三条小炸弹；四条小炸弹仍走单位配置固定伤。
 */
export function computeTripleSmallBombDamage(cards: readonly PlayingCard[]): Fx {
  const top = strongestCard(cards);
  const damage =
    TRIPLE_SMALL_BOMB_DAMAGE_BASE + getCardStrength(top) * TRIPLE_SMALL_BOMB_DAMAGE_PER_STRENGTH;
  return fromFloat(damage);
}

/**
 * 三条小炸弹：任意同点三条均可兑换，按配置 rows 展开为单槽引信弹。
 */
export function resolveTripleSmallBombMappedRows(
  formationId: string,
  rows: readonly (readonly UnitTypeId[])[],
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  if (!formationId.includes('small_bomb')) return null;
  if (cards.length !== 3 || cards.some((card) => card.joker)) return null;
  const rank = cards[0]!.rank;
  if (cards.some((card) => card.rank !== rank)) return null;
  return rows.map((row) => applyLevelGate(row.map((typeId) => ({ typeId, level: 1 }))));
}

/**
 * 单张/对子/三条：校验点数匹配后按配置 rows 展开站位（不重排）。
 * 对子在基础等级上 +1；三条数字 +1、人头固定 3 级；返回 null 表示不适用。
 */
export function resolveRankConfiguredMappedRows(
  category: 'single' | 'pair' | 'triple',
  formationId: string,
  rows: readonly (readonly UnitTypeId[])[],
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  const expectedCount = category === 'single' ? 1 : category === 'pair' ? 2 : 3;
  if (cards.length !== expectedCount) return null;
  // 双王只走王炸；三条不含王牌。
  if ((category === 'pair' || category === 'triple') && cards.some((card) => card.joker)) return null;

  // 三条小炸弹不走点数键，任意同点三条均可兑换。
  if (category === 'triple' && formationId.includes('small_bomb')) {
    return resolveTripleSmallBombMappedRows(formationId, rows, cards);
  }

  const key = parseRankFormationKey(formationId);
  const top = strongestCard(cards);
  if (!key || !cardMatchesRankKey(top, key)) return null;

  let level: number;
  if (category === 'triple') {
    level = key === 'number' ? numberRankLevel(top) + 1 : 3;
  } else {
    const baseLevel = key === 'number' ? numberRankLevel(top) : 1;
    level = category === 'pair' ? baseLevel + 1 : baseLevel;
  }
  return rows.map((row) => applyLevelGate(row.map((typeId) => ({ typeId, level }))));
}

/** 单张便捷封装，供旧调用方使用。 */
export function resolveSingleMappedRows(
  formationId: string,
  rows: readonly (readonly UnitTypeId[])[],
  cards: readonly PlayingCard[],
): MappedFormationUnit[][] | null {
  return resolveRankConfiguredMappedRows('single', formationId, rows, cards);
}

/**
 * 按实际手牌和阵型方案推导单位与等级。
 * 返回 null 代表该方案不适用于当前点数，调用方不应向玩家展示。
 * 单张/对子/三条/三顺/连对/五顺由 resolveCardFormation 按配置 rows 展开，此处直接返回 null。
 */
export function resolveHandUnits(
  category: HandCategory,
  formationId: string,
  cards: readonly PlayingCard[],
): MappedFormationUnit[] | null {
  if (cards.length === 0) return null;
  // 单张/对子/三条/三顺/连对/五顺站位以 cardFormations.json 的 rows 为准，不走规则推导。
  if (
    category === 'single' ||
    category === 'pair' ||
    category === 'triple' ||
    category === 'straight3' ||
    category === 'two_pair' ||
    category === 'straight5'
  ) {
    return null;
  }

  const choice = choiceFromFormationId(formationId);
  const top = strongestCard(cards);

  if (category === 'rocket') {
    return choice === 'bomb' ? applyLevelGate([{ typeId: 'giant_bomb', level: 3 }]) : null;
  }
  if (category === 'bomb') {
    if (choice !== 'bomb') return null;
    // bomb_small_bomb → 小炸弹；其余炸弹方案（含 bomb_giant_bomb）→ 巨型炸弹
    const typeId: UnitTypeId = formationId.includes('small_bomb') ? 'small_bomb' : 'giant_bomb';
    return applyLevelGate([{ typeId, level: isNumberRank(top) ? 1 : 2 }]);
  }
  if (category === 'flush' || category === 'full_house') {
    return choice === 'tower'
      ? applyLevelGate([{ typeId: 'building_tower', level: 2 }])
      : choice === 'chariot'
        ? applyLevelGate([{ typeId: 'ranged_chariot', level: 2 }])
        : choice === 'dragon'
          ? applyLevelGate([{ typeId: 'dragon', level: 1 }])
          : null;
  }
  if (category === 'straight_flush') {
    return choice === 'tower'
      ? applyLevelGate([{ typeId: 'building_tower', level: 3 }])
      : choice === 'chariot'
        ? applyLevelGate([{ typeId: 'ranged_chariot', level: 3 }])
        : choice === 'dragon'
          ? applyLevelGate([{ typeId: 'dragon', level: 2 }])
          : null;
  }
  return null;
}

/** 按点数键生成单张/对子/三条预览样例牌。 */
function previewCardsForRankKey(
  category: 'single' | 'pair' | 'triple',
  key: RankFormationKey | null,
  card: (id: string) => PlayingCard,
): PlayingCard[] {
  const pick = (rank: string): PlayingCard[] => {
    if (category === 'single') {
      if (rank === 'joker-black' || rank === 'joker-red') return [card(rank)];
      return [card(`${rank}-spades`)];
    }
    if (category === 'pair') {
      return [card(`${rank}-spades`), card(`${rank}-hearts`)];
    }
    return [card(`${rank}-spades`), card(`${rank}-hearts`), card(`${rank}-clubs`)];
  };
  switch (key) {
    case 'J':
      return pick('J');
    case 'Q':
      return pick('Q');
    case 'K':
      return pick('K');
    case 'A':
      return pick('A');
    case 'joker_black':
      return category === 'single' ? [card('joker-black')] : pick('5');
    case 'joker_red':
      return category === 'single' ? [card('joker-red')] : pick('5');
    default:
      return pick('5');
  }
}

/** 按三顺点数段生成预览样例牌。 */
function previewCardsForStraight3Segment(
  key: Straight3SegmentKey | null,
  card: (id: string) => PlayingCard,
): PlayingCard[] {
  switch (key) {
    case 'A23':
      return [card('A-spades'), card('2-hearts'), card('3-clubs')];
    case '910J':
      return [card('9-spades'), card('10-hearts'), card('J-clubs')];
    case '10JQ':
      return [card('10-spades'), card('J-hearts'), card('Q-clubs')];
    case 'JQK':
      return [card('J-spades'), card('Q-hearts'), card('K-clubs')];
    case 'QKA':
      return [card('Q-spades'), card('K-hearts'), card('A-clubs')];
    case 'number':
    default:
      return [card('8-spades'), card('9-hearts'), card('10-clubs')];
  }
}

/** 按五顺点数段生成预览样例牌；箭塔/战车用数字五顺样例。 */
function previewCardsForStraight5Segment(
  formationId: string,
  card: (id: string) => PlayingCard,
): PlayingCard[] {
  const numberStraight = [
    card('2-spades'),
    card('3-hearts'),
    card('4-clubs'),
    card('5-diamonds'),
    card('6-spades'),
  ];
  switch (parseStraight5SegmentKey(formationId)) {
    case 'A2345':
      return [
        card('A-spades'),
        card('2-hearts'),
        card('3-clubs'),
        card('4-diamonds'),
        card('5-spades'),
      ];
    case '910JQK':
      return [
        card('9-spades'),
        card('10-hearts'),
        card('J-clubs'),
        card('Q-diamonds'),
        card('K-spades'),
      ];
    case '10JQKA':
      return [
        card('10-spades'),
        card('J-hearts'),
        card('Q-clubs'),
        card('K-diamonds'),
        card('A-spades'),
      ];
    case 'number':
    default:
      return numberStraight;
  }
}

/** 按连对点数段生成相邻两对预览样例。 */
function previewCardsForTwoPair(
  formationId: string,
  card: (id: string) => PlayingCard,
): PlayingCard[] {
  const pair = (low: string, high: string): PlayingCard[] => [
    card(`${low}-spades`),
    card(`${low}-hearts`),
    card(`${high}-clubs`),
    card(`${high}-diamonds`),
  ];
  switch (parseTwoPairSegmentKey(formationId)) {
    case 'A2':
      return pair('A', '2');
    case '10J':
      return pair('10', 'J');
    case 'JQ':
      return pair('J', 'Q');
    case 'QK':
      return pair('Q', 'K');
    case 'KA':
      return pair('K', 'A');
    case 'number':
    default:
      return pair('4', '5');
  }
}

/**
 * 卡组页预览用的样例手牌。
 * 单张/对子/三条/三顺/连对/五顺按 formationId 点数键选牌；其它牌型按方案 id 选数字牌或人头牌。
 */
export function getPreviewCardsForFormation(
  category: HandCategory,
  formationId: string,
): PlayingCard[] {
  const card = (id: string): PlayingCard => {
    const found = getPokerCardById(id);
    if (!found) throw new Error(`缺少预览样例牌：${id}`);
    return found;
  };

  if (category === 'single' || category === 'pair' || category === 'triple') {
    // 三条小炸弹无点数键，用数字三条做预览样例。
    const key = formationId.includes('small_bomb')
      ? ('number' as const)
      : parseRankFormationKey(formationId);
    return previewCardsForRankKey(category, key, card);
  }
  if (category === 'straight3') {
    return previewCardsForStraight3Segment(parseStraight3SegmentKey(formationId), card);
  }
  if (category === 'two_pair') {
    return previewCardsForTwoPair(formationId, card);
  }
  if (category === 'straight5') {
    return previewCardsForStraight5Segment(formationId, card);
  }

  switch (category) {
    case 'flush':
      return [card('2-spades'), card('4-spades'), card('6-spades'), card('8-spades'), card('J-spades')];
    case 'full_house':
      return [card('5-spades'), card('5-hearts'), card('5-clubs'), card('9-diamonds'), card('9-spades')];
    case 'bomb':
      return [card('5-spades'), card('5-hearts'), card('5-clubs'), card('5-diamonds')];
    case 'rocket':
      return [card('joker-black'), card('joker-red')];
    case 'straight_flush':
      return [card('6-spades'), card('7-spades'), card('8-spades'), card('9-spades'), card('10-spades')];
  }
}
