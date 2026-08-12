import { getCardStrength, getPokerCardById, type PlayingCard } from '../cards/deck.js';
import { UNIT_CONFIGS, UNIT_LEVELS_ENABLED, type UnitTypeId } from './units.js';
import type { HandCategory } from './cardFormations.js';

/** 规则阵型中的单个出兵位，等级随实际出牌点数推导。 */
export interface MappedFormationUnit {
  typeId: UnitTypeId;
  level: number;
}

type UnitChoice = 'melee' | 'ranged' | 'rank' | 'tower' | 'chariot' | 'dragon' | 'bomb';

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

/** 判断点数是否走民兵/弓手的 1～9 级阶梯。 */
function isNumberRank(card: PlayingCard): boolean {
  return !card.joker && ['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(card.rank);
}

/** 数字牌 2-10 对应 1-9 级。 */
function numberRankLevel(card: PlayingCard): number {
  return Number(card.rank) - 1;
}

/** 获取组合中牌力最大的牌；规则牌型保证 cards 非空。 */
function strongestCard(cards: readonly PlayingCard[]): PlayingCard {
  return cards.reduce((strongest, card) => (getCardStrength(card) > getCardStrength(strongest) ? card : strongest));
}

/** J、Q、K、A 与大小王的唯一兵种映射。 */
function rankUnit(card: PlayingCard): UnitTypeId | null {
  if (card.joker === 'black') return 'hero_mage';
  if (card.joker === 'red') return 'hero_archmage';
  if (card.rank === 'J') return 'melee_guard';
  if (card.rank === 'Q') return 'hero_queen';
  if (card.rank === 'K') return 'hero_king';
  if (card.rank === 'A') return 'melee_cavalry';
  return null;
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
 * 按实际手牌和阵型方案推导单位与等级。
 * 返回 null 代表该方案不适用于当前点数，调用方不应向玩家展示。
 */
export function resolveHandUnits(
  category: HandCategory,
  formationId: string,
  cards: readonly PlayingCard[],
): MappedFormationUnit[] | null {
  if (cards.length === 0) return null;
  const choice = choiceFromFormationId(formationId);
  const top = strongestCard(cards);

  if (category === 'rocket') {
    return choice === 'bomb' ? applyLevelGate([{ typeId: 'giant_bomb', level: 3 }]) : null;
  }
  if (category === 'bomb') {
    if (choice !== 'bomb') return null;
    return applyLevelGate([{ typeId: 'giant_bomb', level: isNumberRank(top) ? 1 : 2 }]);
  }
  if (category === 'straight5') {
    return choice === 'tower'
      ? applyLevelGate([{ typeId: 'building_tower', level: 1 }])
      : choice === 'chariot'
        ? applyLevelGate([{ typeId: 'ranged_chariot', level: 1 }])
        : null;
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

  // 王炸只走独立的 rocket 规则，不能借由同时命中的「对子」绕过映射。
  // 单张大小王仍走 rank 兵种（小王→法师，大王→大法师）。
  if (cards.some((card) => card.joker) && category !== 'single') return null;
  const numeric = isNumberRank(top);
  if (numeric && choice !== 'melee' && choice !== 'ranged') return null;
  if (!numeric && choice !== 'rank') return null;
  const typeId = numeric
    ? choice === 'melee'
      ? 'melee_grunt'
      : 'ranged_archer'
    : rankUnit(top);
  if (!typeId) return null;

  let count = 1;
  let level = numeric ? numberRankLevel(top) : 1;
  if (category === 'pair') {
    count = 2;
    level += 1;
  } else if (category === 'straight3') {
    count = 3;
    level = numeric ? level : 2;
  } else if (category === 'triple') {
    count = numeric ? 5 : 3;
    level = numeric ? level + 1 : 3;
  } else if (category === 'two_pair') {
    count = 4;
    level = numeric ? level + 2 : 4;
  }
  return applyLevelGate(Array.from({ length: count }, () => ({ typeId, level })));
}

/**
 * 卡组页预览用的样例手牌。
 * 按方案 id 选数字牌或人头牌，确保 resolveHandUnits 能展开出真实数量与站位。
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
  const choice = choiceFromFormationId(formationId);
  const face = choice === 'rank';

  switch (category) {
    case 'single':
      return [face ? card('J-spades') : card('5-spades')];
    case 'pair':
      return face
        ? [card('J-spades'), card('J-hearts')]
        : [card('5-spades'), card('5-hearts')];
    case 'straight3':
      return face
        ? [card('Q-spades'), card('K-hearts'), card('A-clubs')]
        : [card('3-spades'), card('4-hearts'), card('5-clubs')];
    case 'triple':
      return face
        ? [card('J-spades'), card('J-hearts'), card('J-clubs')]
        : [card('5-spades'), card('5-hearts'), card('5-clubs')];
    case 'two_pair':
      return face
        ? [card('Q-spades'), card('Q-hearts'), card('K-clubs'), card('K-diamonds')]
        : [card('4-spades'), card('4-hearts'), card('5-clubs'), card('5-diamonds')];
    case 'straight5':
      return [card('2-spades'), card('3-hearts'), card('4-clubs'), card('5-diamonds'), card('6-spades')];
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
