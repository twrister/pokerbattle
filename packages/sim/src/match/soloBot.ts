import { detectHandCategories } from '../cards/handCategory.js';
import type { PlayingCard } from '../cards/deck.js';
import { claimCastlePackCommand, playFormationCommand, type Command } from '../commands.js';
import {
  HAND_CATEGORY_STRENGTH_ORDER,
  getFormationsFor,
  isBuildingOnlyFormation,
  isFuseBombFormation,
  type CardFormation,
  type HandCategory,
} from '../config/cardFormations.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/arena.js';
import { halfCourtSafeAnchor, halfCourtYRange, isDeployAnchorInsideHalfCourt } from '../config/halfCourt.js';
import { UNIT_CONFIGS } from '../config/units.js';
import { Faction } from '../entity/unit.js';
import { fromFloat, toFloat } from '../math/fixed.js';
import { Rng } from '../math/rng.js';
import type { MatchState } from './matchState.js';

/** 单机敌人的决策档位；困难模式会读取玩家手牌来预判威胁。 */
export type SoloDifficulty = 'easy' | 'hard';

interface Candidate {
  cards: PlayingCard[];
  formation: CardFormation;
  x: number;
  y: number;
  score: number;
}

/** 简单人机更慢的思考节奏，刻意降低出牌频率。 */
const EASY_THINK_TICKS = 70;
const HARD_THINK_TICKS = 28;
/** 双方均先攒牌再出，避免开局就零散单张。 */
const MIN_HAND_TO_PLAY = 6;

/**
 * 单机红方的玩家级控制器。
 * 它只生成正常出牌或领包指令，扣牌、落点和阵型合法性始终由 MatchState 统一裁决。
 */
export class SoloBotController {
  private readonly rng: Rng;
  private nextThinkTick = 0;

  constructor(
    readonly difficulty: SoloDifficulty,
    seed = 1,
    readonly faction: Faction = Faction.Red,
  ) {
    this.rng = new Rng(seed ^ (difficulty === 'hard' ? 0x6d2b79f5 : 0x1b873593));
  }

  /** 重开同一局时清除节奏状态，避免沿用上局的冷却。 */
  reset(): void {
    this.nextThinkTick = 0;
  }

  /**
   * 在逻辑帧开始前考虑一次出牌。
   * 手牌不足时继续攒牌凑组合；有牌可出时用延迟与偏好扰动模拟思考，而不是每 tick 完美反应。
   */
  decide(match: MatchState): Command | null {
    if (match.result) return null;
    // 保护卡包优先于出牌思考，不受攒牌门槛和冷却限制
    if (match.getCastlePackState(this.faction) === 'pending') {
      return claimCastlePackCommand(this.faction);
    }
    if (match.world.tick < this.nextThinkTick) return null;

    const hand = match.decks[this.faction].hand;
    // 手牌未超过 5 张时只观察不操作，优先把牌攒成组合
    if (hand.length < MIN_HAND_TO_PLAY) return null;

    const candidates = this.preferComboCandidates(this.collectCandidates(match, hand));
    if (candidates.length === 0) {
      this.wait(match, false);
      return null;
    }

    candidates.sort((left, right) => right.score - left.score);
    const pickIndex = this.difficulty === 'easy'
      ? Math.min(candidates.length - 1, this.rng.nextInt(Math.min(3, candidates.length)))
      : this.rng.nextInt(100) < 16 && candidates[1] ? 1 : 0;
    const chosen = candidates[pickIndex]!;
    const command = playFormationCommand(
      this.faction,
      chosen.formation.id,
      chosen.cards.map((card) => card.id),
      fromFloat(chosen.x),
      fromFloat(chosen.y),
    );
    if (!match.validate(command)) {
      this.wait(match, false);
      return null;
    }
    this.wait(match, true);
    return command;
  }

  /** 从全部合法牌组和可部署位置中挑选有限候选，控制一次思考的成本。 */
  private collectCandidates(match: MatchState, hand: readonly PlayingCard[]): Candidate[] {
    const candidates: Candidate[] = [];
    const maxSize = Math.min(5, hand.length);
    for (let size = 1; size <= maxSize; size += 1) {
      forEachCombination(hand, size, (cards) => {
        const formations = getFormationsFor(detectHandCategories(cards), cards);
        for (const formation of formations) {
          for (const point of this.candidateAnchors(match, formation)) {
            const command = playFormationCommand(
              this.faction,
              formation.id,
              cards.map((card) => card.id),
              fromFloat(point.x),
              fromFloat(point.y),
            );
            if (!match.validate(command)) continue;
            candidates.push({
              cards,
              formation,
              x: point.x,
              y: point.y,
              score: this.score(match, cards, formation, point.x, point.y),
            });
          }
        }
      });
    }
    return candidates;
  }

  /**
   * 有多张组合可打时优先排除单张，逼近“先凑牌再出手”的真人习惯。
   * 若整手牌只能打单张，才退回单张候选以免卡死。
   */
  private preferComboCandidates(candidates: Candidate[]): Candidate[] {
    const combos = candidates.filter((candidate) => candidate.cards.length >= 2);
    return combos.length > 0 ? combos : candidates;
  }

  /** 根据场上攻守压力给阵型生成前、中、后排落点；炸弹则优先瞄准敌军密集点。 */
  private candidateAnchors(match: MatchState, formation: CardFormation): Array<{ x: number; y: number }> {
    if (isFuseBombFormation(formation)) return this.bombAnchors(match);
    const safe = halfCourtSafeAnchor(formation, this.faction);
    if (!safe) return [];
    if (isBuildingOnlyFormation(formation)) return [safe];

    const { minY, maxY } = halfCourtYRange(this.faction);
    const width = toFloat(ARENA_WIDTH);
    const depth = maxY - minY;
    const ys = this.difficulty === 'easy'
      ? [safe.y]
      : [minY + depth * 0.2, safe.y, maxY - depth * 0.2];
    const xs = this.difficulty === 'easy' ? [safe.x] : [width * 0.28, safe.x, width * 0.72];
    return xs.flatMap((x) => ys.filter((y) =>
      isDeployAnchorInsideHalfCourt(x, y, this.faction),
    ).map((y) => ({ x, y })));
  }

  /** 巨型炸弹可越过半场，优先攻击蓝方最密集的可见单位群。 */
  private bombAnchors(match: MatchState): Array<{ x: number; y: number }> {
    const enemies = match.world.units.filter((unit) => !unit.dead && unit.faction !== this.faction);
    if (enemies.length === 0) return [{ x: toFloat(ARENA_WIDTH) / 2, y: toFloat(ARENA_HEIGHT) * 0.3 }];
    const sorted = [...enemies].sort((a, b) => nearbyEnemies(match, b, this.faction) - nearbyEnemies(match, a, this.faction));
    return sorted.slice(0, this.difficulty === 'easy' ? 1 : 3).map((unit) => ({
      x: toFloat(unit.pos.x),
      y: toFloat(unit.pos.y),
    }));
  }

  /** 对候选同时评价牌力、部署价值、局势与困难模式的玩家手牌威胁。 */
  private score(
    match: MatchState,
    cards: readonly PlayingCard[],
    formation: CardFormation,
    x: number,
    y: number,
  ): number {
    const category = detectHandCategories(cards)[0];
    const categoryScore = category ? categoryStrength(category) : 0;
    // 张数与牌型权重抬高，鼓励对子及以上组合而不是散出单张
    const comboScore = cards.length * 14 + (cards.length >= 3 ? 12 : 0);
    const unitScore = formation.slots.reduce((sum, slot) => sum + unitValue(slot.typeId), 0);
    const selfUnits = match.world.units.filter((unit) => !unit.dead && unit.faction === this.faction).length;
    const enemyUnits = match.world.units.filter((unit) => !unit.dead && unit.faction !== this.faction).length;
    const { minY, maxY } = halfCourtYRange(this.faction);
    const forward = (y - minY) / Math.max(1, maxY - minY);
    const defensiveBias = enemyUnits > selfUnits ? -forward * 8 : forward * 5;
    const handPressure = match.decks[this.faction].hand.length >= 8 ? 18 : 0;
    const bombScore = isFuseBombFormation(formation)
      ? nearbyPointEnemies(match, x, y, this.faction) * 10
      : 0;
    const playerThreat = this.difficulty === 'hard'
      ? predictedThreat(match.decks[Faction.Blue].hand) * 2.5
      : 0;
    const phaseUrgency =
      match.phase === 'normal' ? 0 : match.phase === 'final' || match.phase === 'settlement' ? 12 : 7;
    const noise = this.rng.nextInt(this.difficulty === 'easy' ? 12 : 4);
    return (
      categoryScore * 10
      + comboScore
      + unitScore
      + defensiveBias
      + handPressure
      + bombScore
      + playerThreat
      + phaseUrgency
      + noise
    );
  }

  /** 出牌后进入更长冷却；简单人机额外拉长间隔，手牌接近满时才略微加快。 */
  private wait(match: MatchState, played: boolean): void {
    const base = this.difficulty === 'easy' ? EASY_THINK_TICKS : HARD_THINK_TICKS;
    const pressure = match.decks[this.faction].hand.length >= 8 ? Math.floor(base / 3) : 0;
    const jitter = this.rng.nextInt(Math.max(2, Math.floor(base / 3)));
    this.nextThinkTick = match.world.tick + Math.max(8, (played ? base : Math.floor(base / 2)) - pressure + jitter);
  }
}

function forEachCombination(cards: readonly PlayingCard[], size: number, visit: (cards: PlayingCard[]) => void): void {
  const combo: PlayingCard[] = [];
  const walk = (start: number): void => {
    if (combo.length === size) {
      visit([...combo]);
      return;
    }
    for (let index = start; index <= cards.length - (size - combo.length); index += 1) {
      combo.push(cards[index]!);
      walk(index + 1);
      combo.pop();
    }
  };
  walk(0);
}

/** 牌型越强分数越高，与 HAND_CATEGORY_STRENGTH_ORDER 一致。 */
function categoryStrength(category: string): number {
  const rank = HAND_CATEGORY_STRENGTH_ORDER.indexOf(category as HandCategory);
  return rank < 0 ? 0 : HAND_CATEGORY_STRENGTH_ORDER.length - rank;
}

function unitValue(typeId: keyof typeof UNIT_CONFIGS): number {
  const config = UNIT_CONFIGS[typeId];
  return Math.max(1, Math.round((toFloat(config.maxHp) + toFloat(config.damage) * 8) / 30));
}

function predictedThreat(cards: readonly PlayingCard[]): number {
  const category = detectHandCategories(cards)[0];
  return category ? categoryStrength(category) + cards.length : cards.length;
}

function nearbyEnemies(match: MatchState, center: { pos: { x: number; y: number } }, faction: Faction): number {
  return match.world.units.filter((unit) => !unit.dead && unit.faction !== faction
    && Math.abs(unit.pos.x - center.pos.x) <= fromFloat(4)
    && Math.abs(unit.pos.y - center.pos.y) <= fromFloat(4)).length;
}

function nearbyPointEnemies(match: MatchState, x: number, y: number, faction: Faction): number {
  return match.world.units.filter((unit) => !unit.dead && unit.faction !== faction
    && Math.abs(toFloat(unit.pos.x) - x) <= 5
    && Math.abs(toFloat(unit.pos.y) - y) <= 5).length;
}
