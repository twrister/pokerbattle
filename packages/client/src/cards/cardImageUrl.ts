import type { CardSuit, PlayingCard } from '@pb/sim';

const SUIT_FILE_INDEX: Readonly<Record<CardSuit, number>> = {
  spades: 1,
  hearts: 2,
  clubs: 3,
  diamonds: 4,
};

/** 按牌面推导 public/cards 下的贴图路径（sim 侧 PlayingCard 不再携带 imageUrl）。 */
export function cardImageUrl(card: PlayingCard): string {
  if (card.joker === 'black') return '/cards/Joker_1.png';
  if (card.joker === 'red') return '/cards/Joker_2.png';
  const suit = card.suit;
  if (!suit) return '/cards/Joker_1.png';
  return `/cards/${card.rank}_${SUIT_FILE_INDEX[suit]}.png`;
}
