/** 兼容旧导入路径：牌堆逻辑已下沉到 @pb/sim。 */
export {
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  RETURN_MIN_DEPTH,
  WILD_CARD_IDS,
  WILD_CARD_RANK,
  compareCardsByStrength,
  createPokerCards,
  getCardStrength,
  isWildCard,
  type CardRank,
  type CardSuit,
  type PlayingCard,
  type PokerDeckOptions,
} from '@pb/sim';
export { cardImageUrl } from './cardImageUrl.js';
