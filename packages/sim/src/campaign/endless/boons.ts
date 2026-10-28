import { MAX_HAND_SIZE, MAX_WILD_CARDS } from '../../cards/deck.js';
import { Rng } from '../../math/rng.js';
import { ENDLESS_MIN_DRAW_INTERVAL, sanitizeRun, type EndlessRunState } from './endlessRun.js';

/** 强化稀有度：Boss 波后只出稀有。 */
export type BoonRarity = 'common' | 'rare';

/** 一条强化定义：只改继承数值，不碰战斗逻辑。 */
export interface BoonDef {
  id: string;
  name: string;
  description: string;
  rarity: BoonRarity;
  /** 当前状态下还能否再选（到上限后不再出现）。 */
  available: (state: EndlessRunState) => boolean;
  apply: (state: EndlessRunState) => EndlessRunState;
}

/** 全部强化；新增条目只需追加到这里。 */
export const BOONS: readonly BoonDef[] = [
  {
    id: 'hand_limit',
    name: '扩充手牌',
    description: '手牌上限 +1',
    rarity: 'common',
    available: (s) => s.handLimit < MAX_HAND_SIZE,
    apply: (s) => ({ ...s, handLimit: s.handLimit + 1 }),
  },
  {
    id: 'draw_speed',
    name: '快速补给',
    description: '发牌间隔 -0.5 秒',
    rarity: 'common',
    available: (s) => s.drawIntervalSeconds > ENDLESS_MIN_DRAW_INTERVAL,
    apply: (s) => ({ ...s, drawIntervalSeconds: s.drawIntervalSeconds - 0.5 }),
  },
  {
    id: 'castle_heal',
    name: '修缮城墙',
    description: '主堡立即回复 25% 血量',
    rarity: 'common',
    available: (s) => s.castleHpRatio < 1,
    apply: (s) => ({ ...s, castleHpRatio: Math.min(1, s.castleHpRatio + 0.25) }),
  },
  {
    id: 'initial_hand',
    name: '整装待发',
    description: '每波起手牌 +1',
    rarity: 'common',
    available: (s) => s.initialHandSize < s.handLimit,
    apply: (s) => ({ ...s, initialHandSize: s.initialHandSize + 1 }),
  },
  {
    id: 'wild_card',
    name: '万能之力',
    description: '牌堆万能牌 +1',
    rarity: 'rare',
    available: (s) => s.wildCards < MAX_WILD_CARDS,
    apply: (s) => ({ ...s, wildCards: s.wildCards + 1 }),
  },
  {
    id: 'regen',
    name: '自愈城砖',
    description: '每波结束主堡自动回复 10% 血量',
    rarity: 'rare',
    available: (s) => s.regenPerWave < 0.3,
    apply: (s) => ({ ...s, regenPerWave: s.regenPerWave + 0.1 }),
  },
  {
    id: 'full_heal',
    name: '重建主堡',
    description: '主堡回满血',
    rarity: 'rare',
    available: (s) => s.castleHpRatio < 0.9,
    apply: (s) => ({ ...s, castleHpRatio: 1 }),
  },
];

/** 按 id 查强化。 */
export function getBoonById(id: string): BoonDef | undefined {
  return BOONS.find((boon) => boon.id === id);
}

/**
 * 抽三选一：普通波后普通/稀有混抽（稀有约 1/4），Boss 波后只抽稀有；
 * 剔除已到上限的强化，候选不足时用另一档补齐。种子由 runSeed 与波次派生，同档同结果。
 */
export function rollBoonChoices(state: EndlessRunState, rareOnly: boolean, count = 3): BoonDef[] {
  const rng = new Rng(((state.runSeed ^ Math.imul(state.wave, 0x9e3779b1)) >>> 0) || 1);
  const open = BOONS.filter((boon) => boon.available(state));
  const rares = open.filter((boon) => boon.rarity === 'rare');
  const commons = open.filter((boon) => boon.rarity === 'common');
  const picked: BoonDef[] = [];
  while (picked.length < count && (rares.length > 0 || commons.length > 0)) {
    const wantRare = rareOnly || rng.nextInt(4) === 0;
    const pool = (wantRare ? rares : commons).length > 0 ? (wantRare ? rares : commons) : wantRare ? commons : rares;
    const index = rng.nextInt(pool.length);
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

/** 应用一条强化并记入已选列表；不可用时原样返回。 */
export function applyBoon(state: EndlessRunState, boonId: string): EndlessRunState {
  const boon = getBoonById(boonId);
  if (!boon || !boon.available(state)) return state;
  const next = boon.apply(state);
  return sanitizeRun({ ...next, boons: [...state.boons, boon.id] });
}
