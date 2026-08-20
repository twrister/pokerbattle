import { getPokerCardById, type CardRank, type PlayingCard } from '../cards/deck.js';
import {
  CARD_FORMATIONS,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  formatMatchRuleLabel,
  resolveCardFormation,
  type CardFormation,
  type FormationMatchRule,
  type HandCategory,
} from '../config/cardFormations.js';
import {
  FUSE_BOMB_DAMAGE_RANK_LABELS,
  FUSE_BOMB_DAMAGE_RANKS,
  getPreviewCardsForFormation,
  type FuseBombDamageRank,
} from '../config/cardMapping.js';

/** 牌位阶梯：2-10 → J → Q → K → A → 小王 → 大王。无点数条目为 -1。 */
export const RANK_TIER_LABELS = ['2-10', 'J', 'Q', 'K', 'A', '小王', '大王'] as const;

/** 一条可对拆的卡组搭配（已按样例牌展开）。 */
export interface Entry {
  key: string;
  label: string;
  category: HandCategory;
  /** 牌位序：2-10=0 … 大王=6；组合无独立点数则为 -1。 */
  rankTier: number;
  formation: CardFormation;
  cards: PlayingCard[];
}

/** 数字牌 2～10 在当前配置下无内部梯度，报表固定提示此说明。 */
export const NUMBERS_FLAT_NOTE =
  '当前配置下数字牌 2～10 共用同一套兵种与单位属性，本工具将其视为单一牌位组，内部无梯度。';

/** 枚举全部阵型条目；引信炸弹按 rankDamage 档位拆成多条。 */
export function listBalanceEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const category of HAND_CATEGORY_ORDER) {
    for (const formation of CARD_FORMATIONS[category]) {
      if (formation.rankDamage) {
        for (const rank of FUSE_BOMB_DAMAGE_RANKS) {
          if (formation.rankDamage[rank] === undefined) continue;
          const cards = cardsForDamageRank(rank);
          const resolved = resolveCardFormation(formation, cards);
          if (!resolved) continue;
          entries.push({
            key: `${category}:${formation.id}:${rank}`,
            label: `${HAND_CATEGORY_NAMES[category]} · ${formation.name} · ${FUSE_BOMB_DAMAGE_RANK_LABELS[rank]}`,
            category,
            rankTier: rankTierOfDamageRank(rank),
            formation: resolved,
            cards,
          });
        }
        continue;
      }
      const cards = getPreviewCardsForFormation(category, formation);
      const resolved = resolveCardFormation(formation, cards);
      if (!resolved) continue;
      entries.push({
        key: `${category}:${formation.id}`,
        label: `${HAND_CATEGORY_NAMES[category]} · ${formation.name} · ${formatMatchRuleLabel(formation.match)}`,
        category,
        rankTier: rankTierOfMatch(formation.match),
        formation: resolved,
        cards,
      });
    }
  }
  return entries;
}

/** 按伤害档生成最少样例牌，供 resolveFuseBombDamage 取最强点数。 */
function cardsForDamageRank(rank: FuseBombDamageRank): PlayingCard[] {
  const id = rank === '2-10' ? '5-spades' : `${rank}-spades`;
  const card = getPokerCardById(id);
  if (!card) throw new Error(`缺少炸弹档位样例牌：${id}`);
  return [card];
}

/** 把 match 收成牌位阶梯下标；多点数取其中最高档。 */
export function rankTierOfMatch(match: FormationMatchRule): number {
  switch (match.kind) {
    case 'numbers':
      return 0;
    case 'any':
      return -1;
    case 'joker':
      return match.joker === 'black' ? 5 : 6;
    case 'ranks':
    case 'tripleRanks':
    case 'rankCount': {
      // 仅有上限的低档（如同花 0～1 张 J～A）按数字牌计；有下限才取指定点数最高档。
      if (match.kind === 'rankCount' && (match.min === undefined || match.min <= 0)) return 0;
      let best = -1;
      for (const rank of match.ranks) {
        const tier = rankTierOfCardRank(rank);
        if (tier > best) best = tier;
      }
      return best;
    }
  }
}

/** 单点数或炸弹档位 → 牌位阶梯下标。 */
export function rankTierOfCardRank(rank: CardRank | FuseBombDamageRank): number {
  if (rank === '2-10' || rank === '2' || rank === '3' || rank === '4' || rank === '5'
    || rank === '6' || rank === '7' || rank === '8' || rank === '9' || rank === '10') {
    return 0;
  }
  if (rank === 'J') return 1;
  if (rank === 'Q') return 2;
  if (rank === 'K') return 3;
  if (rank === 'A') return 4;
  return -1;
}

function rankTierOfDamageRank(rank: FuseBombDamageRank): number {
  return rankTierOfCardRank(rank);
}

/** 牌位阶梯展示名；无点数返回空串。 */
export function formatRankTier(tier: number): string {
  if (tier < 0 || tier >= RANK_TIER_LABELS.length) return '—';
  return RANK_TIER_LABELS[tier]!;
}
