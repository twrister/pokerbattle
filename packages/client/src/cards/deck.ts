/** 兼容旧导入路径：牌堆逻辑已下沉到 @pb/sim。 */
export {
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  RETURN_MIN_DEPTH,
  compareCardsByStrength,
  createPokerCards,
  getCardStrength,
  type CardRank,
  type CardSuit,
  type PlayingCard,
} from '@pb/sim';
export { cardImageUrl } from './cardImageUrl.js';
