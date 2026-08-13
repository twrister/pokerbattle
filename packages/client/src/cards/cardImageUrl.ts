import type { CardSuit, PlayingCard } from '@pb/sim';

const SUIT_FILE_INDEX: Readonly<Record<CardSuit, number>> = {
  spades: 1,
  hearts: 2,
  clubs: 3,
  diamonds: 4,
};

/**
 * public/cards 贴图路径。必须用相对路径，不能写 /cards/...：
 * 正式服页面在 /poker-battle/ 下，绝对根路径会打到域名 /cards 而 404。
 * 兵种立绘同样用相对路径（units/...），线上已能显示。
 */
export function cardImageUrl(card: PlayingCard): string {
  if (card.joker === 'black') return 'cards/Joker_1.png';
  if (card.joker === 'red') return 'cards/Joker_2.png';
  const suit = card.suit;
  if (!suit) return 'cards/Joker_1.png';
  return `cards/${card.rank}_${SUIT_FILE_INDEX[suit]}.png`;
}
