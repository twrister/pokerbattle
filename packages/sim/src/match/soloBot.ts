import { detectHandCategories } from '../cards/handCategory.js';
import type { CardRank, PlayingCard } from '../cards/deck.js';
import { claimCastlePackCommand, playFormationCommand, type Command } from '../commands.js';
import {
  HAND_CATEGORY_STRENGTH_ORDER,
  getFormationBuildingTypeId,
  getFormationsFor,
  isBuildingOnlyFormation,
  isFuseBombFormation,
  isFuseBombTypeId,
  type CardFormation,
  type HandCategory,
} from '../config/cardFormations.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/arena.js';
import { ARENA_BRIDGES } from '../config/arenaTerrain.js';
import {
  halfCourtSafeAnchor,
  halfCourtSafeBuildingAnchor,
  halfCourtYRange,
  isBuildingInsideHalfCourt,
  isDeployAnchorInsideHalfCourt,
} from '../config/halfCourt.js';
import { snapBuildingCenter } from '../nav/buildingGrid.js';
import { isArcherTowerId, isBuildingConfig, UNIT_CONFIGS, type UnitTypeId } from '../config/units.js';
import { Faction } from '../entity/unit.js';
import { fromFloat, toFloat } from '../math/fixed.js';
import { Rng } from '../math/rng.js';
import type { MatchState } from './matchState.js';

/** 单机敌人的决策档位；同一套意图，简单档门槛更松、落点更少。 */
export type SoloDifficulty = 'easy' | 'hard';

/** 本帧出牌目的：决定能不能出、出什么、落在哪。 */
type BotIntent = 'emergency' | 'defend' | 'wave' | 'dump' | 'hoard';

interface Candidate {
  cards: PlayingCard[];
  formation: CardFormation;
  x: number;
  y: number;
  score: number;
}

interface Point {
  x: number;
  y: number;
}

/** 每帧只扫一次战场，避免每个候选重复遍历单位。 */
interface Situation {
  castle: Point | null;
  castleId: number;
  castleHpRatio: number;
  castleThreatened: boolean;
  enemiesInHalf: number;
  approachingEnemies: number;
  fieldPressure: boolean;
  ownArmy: number;
  frontCount: number;
  backCount: number;
  towerCount: number;
  handSize: number;
  nearHandLimit: boolean;
  latePhase: boolean;
  wasteCardIds: ReadonlySet<string>;
  attackers: Point[];
}

interface ScoreContext {
  situation: Situation;
  intent: BotIntent;
}

/** 简单人机更慢的思考节奏，刻意降低出牌频率。 */
const EASY_THINK_TICKS = 70;
const HARD_THINK_TICKS = 28;
/** 敌军中心距主堡小于该值视为正在打基地。 */
const CASTLE_THREAT_RANGE = 6;
/** 已有箭塔达到该数后不再鼓励连铺。 */
const MAX_PREFERRED_TOWERS = 2;

const STRAIGHT_VALUE: Readonly<Record<CardRank, number>> = {
  A: 14,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
};

/**
 * 单机红方的玩家级控制器。
 * 先读局势再选意图，只生成出牌或领包指令；扣牌和落点合法性由 MatchState 裁决。
 */
export class SoloBotController {
  private readonly rng: Rng;
  private nextThinkTick = 0;
  /** 爆兵连击剩余手数；基地转危或规模散掉时清零。 */
  private waveBurstLeft = 0;

  constructor(
    readonly difficulty: SoloDifficulty,
    seed = 1,
    readonly faction: Faction = Faction.Red,
  ) {
    this.rng = new Rng(seed ^ (difficulty === 'hard' ? 0x6d2b79f5 : 0x1b873593));
  }

  /** 重开同一局时清除节奏状态，避免沿用上局的冷却与连击。 */
  reset(): void {
    this.nextThinkTick = 0;
    this.waveBurstLeft = 0;
  }

  /**
   * 在逻辑帧开始前考虑一次出牌。
   * 安全时囤牌；有压再防守或清废牌；成规模后短冷却连打一小波。
   */
  decide(match: MatchState): Command | null {
    if (match.result) return null;
    if (match.getCastlePackState(this.faction) === 'pending') {
      return claimCastlePackCommand(this.faction);
    }
    if (match.world.tick < this.nextThinkTick) return null;

    const hand = match.decks[this.faction].hand;
    const situation = this.readSituation(match, hand);
    const intent = this.chooseIntent(situation);
    if (intent !== 'wave') this.waveBurstLeft = 0;
    // 囤牌期间不进冷却，方便下一帧立刻转入防守
    if (intent === 'hoard') return null;

    const candidates = this.collectCandidates(match, hand, { situation, intent });
    const pool = intent === 'wave' ? this.preferComboCandidates(candidates) : candidates;
    if (pool.length === 0) {
      this.wait(match, false, intent);
      return null;
    }

    pool.sort((left, right) => right.score - left.score);
    const pickIndex = this.difficulty === 'easy'
      ? Math.min(pool.length - 1, this.rng.nextInt(Math.min(3, pool.length)))
      : this.rng.nextInt(100) < 16 && pool[1] ? 1 : 0;
    const chosen = pool[pickIndex]!;
    const command = playFormationCommand(
      this.faction,
      chosen.formation.id,
      chosen.cards.map((card) => card.id),
      fromFloat(chosen.x),
      fromFloat(chosen.y),
    );
    if (!match.validate(command)) {
      this.wait(match, false, intent);
      return null;
    }
    this.wait(match, true, intent);
    return command;
  }

  /** 扫单位与手牌，供本帧意图和打分复用。 */
  private readSituation(match: MatchState, hand: readonly PlayingCard[]): Situation {
    const castlePos = match.getCastlePosition(this.faction);
    const castle = castlePos ? { x: castlePos.x, y: castlePos.y } : null;
    const castleUnit = match.world.units.find(
      (unit) => !unit.dead && unit.faction === this.faction && unit.typeId === 'building_base',
    );
    const castleId = castleUnit?.id ?? 0;
    const maxHp = match.getCastleMaxHp(this.faction);
    const castleHpRatio = maxHp > 0 ? match.getCastleHp(this.faction) / maxHp : 1;
    const { minY, maxY } = halfCourtYRange(this.faction);
    const attackers: Point[] = [];
    let enemiesInHalf = 0;
    let approachingEnemies = 0;
    let ownArmy = 0;
    let frontCount = 0;
    let backCount = 0;
    let towerCount = 0;
    let castleThreatened = false;

    for (const unit of match.world.units) {
      if (unit.dead) continue;
      const x = toFloat(unit.pos.x);
      const y = toFloat(unit.pos.y);
      if (unit.faction === this.faction) {
        if (unit.typeId === 'building_base' || isFuseBombTypeId(unit.typeId)) continue;
        if (isArcherTowerId(unit.typeId)) {
          towerCount += 1;
          continue;
        }
        if (isBuildingConfig(unit.config)) continue;
        ownArmy += 1;
        if (isFrontlineType(unit.typeId)) frontCount += 1;
        else backCount += 1;
        continue;
      }
      const inHalf = y >= minY && y <= maxY;
      if (inHalf) enemiesInHalf += 1;
      if (castle && Math.hypot(x - castle.x, y - castle.y) <= CASTLE_THREAT_RANGE + 2) {
        approachingEnemies += 1;
      }
      const targetingCastle = castleId !== 0 && unit.targetId === castleId;
      const nearCastle = !!castle && Math.hypot(x - castle.x, y - castle.y) <= CASTLE_THREAT_RANGE;
      if (targetingCastle || nearCastle) {
        castleThreatened = true;
        attackers.push({ x, y });
      }
    }

    const handLimit = match.getMaxHandSize();
    return {
      castle,
      castleId,
      castleHpRatio,
      castleThreatened,
      enemiesInHalf,
      approachingEnemies,
      fieldPressure: enemiesInHalf > 0 || (castleHpRatio < 0.8 && approachingEnemies > 0),
      ownArmy,
      frontCount,
      backCount,
      towerCount,
      handSize: hand.length,
      nearHandLimit: hand.length >= handLimit - 1,
      latePhase: match.phase === 'final' || match.phase === 'settlement',
      wasteCardIds: findWasteCardIds(hand),
      attackers,
    };
  }

  /** 按紧急度选意图；简单档囤得更少、爆兵更晚。 */
  private chooseIntent(situation: Situation): BotIntent {
    const easy = this.difficulty === 'easy';
    const hoardUntil = easy ? 7 : 8;
    const dumpMin = easy ? 6 : 7;
    const emergencyMin = easy ? 4 : 3;
    const defendMin = 5;
    const waveMin = easy ? 8 : 6;
    const hasWaste = situation.wasteCardIds.size > 0;
    const forced = situation.nearHandLimit || situation.latePhase;

    if (situation.castleThreatened && situation.handSize >= emergencyMin) return 'emergency';
    if (situation.fieldPressure && situation.handSize >= defendMin) return 'defend';
    if (situation.ownArmy >= waveMin && !situation.castleThreatened && !situation.fieldPressure) {
      return 'wave';
    }
    if (!situation.fieldPressure && !situation.castleThreatened && situation.handSize >= dumpMin && hasWaste) {
      return 'dump';
    }
    if (forced) {
      if (hasWaste) return 'dump';
      return situation.handSize >= defendMin ? 'wave' : 'hoard';
    }
    if (situation.handSize < hoardUntil) return 'hoard';
    return hasWaste ? 'dump' : 'wave';
  }

  /** dump 只枚举 1～2 张，避免清废牌时扫出大牌型。 */
  private collectCandidates(
    match: MatchState,
    hand: readonly PlayingCard[],
    context: ScoreContext,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    const maxSize = context.intent === 'dump' ? Math.min(2, hand.length) : Math.min(5, hand.length);
    for (let size = 1; size <= maxSize; size += 1) {
      forEachCombination(hand, size, (cards) => {
        const formations = getFormationsFor(detectHandCategories(cards), cards);
        for (const formation of formations) {
          for (const point of this.candidateAnchors(match, formation, context)) {
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
              score: this.score(match, cards, formation, point.x, point.y, context),
            });
          }
        }
      });
    }
    return candidates;
  }

  /**
   * 爆兵时优先组合，避免散出单张打断节奏。
   * 整手只能打单张时才退回，以免卡死。
   */
  private preferComboCandidates(candidates: Candidate[]): Candidate[] {
    const combos = candidates.filter((candidate) => candidate.cards.length >= 2);
    return combos.length > 0 ? combos : candidates;
  }

  /** 按意图给阵型挑落点：防守偏后、爆兵偏前、急救贴堆、箭塔看桥口。 */
  private candidateAnchors(
    match: MatchState,
    formation: CardFormation,
    context: ScoreContext,
  ): Point[] {
    if (isFuseBombFormation(formation)) return this.bombAnchors(match, context.situation);
    if (isBuildingOnlyFormation(formation)) return this.buildingAnchors(match, formation, context);

    const { intent, situation } = context;
    if (intent === 'emergency') return this.emergencyAnchors(situation);

    const safe = halfCourtSafeAnchor(formation, this.faction);
    if (!safe) return [];
    const { minY, maxY } = halfCourtYRange(this.faction);
    const width = toFloat(ARENA_WIDTH);
    const depth = maxY - minY;
    const backY = this.faction === Faction.Red ? maxY - depth * 0.2 : minY + depth * 0.2;
    const frontY = this.faction === Faction.Red ? minY + depth * 0.2 : maxY - depth * 0.2;
    const midY = safe.y;
    const preferY = intent === 'wave' ? frontY : intent === 'defend' ? backY : midY;
    const ys = this.difficulty === 'easy' ? [preferY] : [preferY, midY];
    const xs = this.difficulty === 'easy' ? [safe.x] : [width * 0.28, safe.x, width * 0.72];
    return uniquePoints(xs.flatMap((x) => ys.filter((y) =>
      isDeployAnchorInsideHalfCourt(x, y, this.faction),
    ).map((y) => ({ x, y }))));
  }

  /** 主堡前左右与靠河桥口，过滤占地冲突；简单档只留两处。 */
  private buildingAnchors(match: MatchState, formation: CardFormation, context: ScoreContext): Point[] {
    const typeId = getFormationBuildingTypeId(formation);
    if (!typeId) return [];
    const footprint = UNIT_CONFIGS[typeId].footprint;
    const safe = halfCourtSafeBuildingAnchor(footprint, this.faction);
    if (!isArcherTowerId(typeId)) return safe ? [safe] : [];

    const { minY, maxY } = halfCourtYRange(this.faction);
    const castle = context.situation.castle ?? safe;
    if (!castle) return [];
    const riverGuardY = this.faction === Faction.Red ? minY + 2.5 : maxY - 2.5;
    const towardEnemy = this.faction === Faction.Red ? -1 : 1;
    const preferred: Point[] = [
      { x: castle.x - 4, y: castle.y + towardEnemy * 3.5 },
      { x: castle.x + 4, y: castle.y + towardEnemy * 3.5 },
      { x: ARENA_BRIDGES[0] ? (ARENA_BRIDGES[0].minX + ARENA_BRIDGES[0].maxX) / 2 : 4, y: riverGuardY },
      { x: ARENA_BRIDGES[1] ? (ARENA_BRIDGES[1].minX + ARENA_BRIDGES[1].maxX) / 2 : 14, y: riverGuardY },
      { x: castle.x, y: castle.y + towardEnemy * 4.5 },
    ];
    const limit = this.difficulty === 'easy' ? 2 : preferred.length;
    const points: Point[] = [];
    for (const raw of preferred.slice(0, limit)) {
      const x = snapBuildingCenter(raw.x, footprint);
      const y = snapBuildingCenter(raw.y, footprint);
      if (!isBuildingInsideHalfCourt(x, y, footprint, this.faction)) continue;
      if (!match.world.canPlaceBuilding(typeId, fromFloat(x), fromFloat(y))) continue;
      points.push({ x, y });
    }
    if (points.length === 0 && safe && match.world.canPlaceBuilding(typeId, fromFloat(safe.x), fromFloat(safe.y))) {
      return [safe];
    }
    return uniquePoints(points);
  }

  /** 半场内对准打基地的敌军团；对岸来兵则放到己方最前线靠来路处。 */
  private emergencyAnchors(situation: Situation): Point[] {
    const { minY, maxY } = halfCourtYRange(this.faction);
    const frontY = this.faction === Faction.Red ? minY + (maxY - minY) * 0.2 : maxY - (maxY - minY) * 0.2;
    const inHalf = situation.attackers.filter((point) =>
      isDeployAnchorInsideHalfCourt(point.x, point.y, this.faction),
    );
    const seeds = inHalf.length > 0 ? inHalf : situation.attackers.map((point) => ({
      x: point.x,
      y: frontY,
    }));
    if (seeds.length === 0) {
      const width = toFloat(ARENA_WIDTH);
      return [{ x: situation.castle?.x ?? width / 2, y: frontY }].filter((point) =>
        isDeployAnchorInsideHalfCourt(point.x, point.y, this.faction),
      );
    }
    const clustered = seeds.slice(0, this.difficulty === 'easy' ? 1 : 3);
    const offsets = this.difficulty === 'easy' ? [0] : [-1.6, 0, 1.6];
    return uniquePoints(clustered.flatMap((seed) => offsets.map((dx) => ({
      x: seed.x + dx,
      y: seed.y,
    }))).filter((point) => isDeployAnchorInsideHalfCourt(point.x, point.y, this.faction)));
  }

  /** 炸弹可越半场，急救优先砸打基地的堆，否则砸最密可见敌军。 */
  private bombAnchors(match: MatchState, situation: Situation): Point[] {
    if (situation.attackers.length > 0) {
      return situation.attackers.slice(0, this.difficulty === 'easy' ? 1 : 3);
    }
    const enemies = match.world.units.filter((unit) => !unit.dead && unit.faction !== this.faction);
    if (enemies.length === 0) return [{ x: toFloat(ARENA_WIDTH) / 2, y: toFloat(ARENA_HEIGHT) * 0.3 }];
    const sorted = [...enemies].sort(
      (left, right) => nearbyEnemies(match, right, this.faction) - nearbyEnemies(match, left, this.faction),
    );
    return sorted.slice(0, this.difficulty === 'easy' ? 1 : 3).map((unit) => ({
      x: toFloat(unit.pos.x),
      y: toFloat(unit.pos.y),
    }));
  }

  /** 牌型只做弱项；主分按意图在废牌、补位、贴脸、箭塔之间切换。 */
  private score(
    match: MatchState,
    cards: readonly PlayingCard[],
    formation: CardFormation,
    x: number,
    y: number,
    context: ScoreContext,
  ): number {
    const { situation, intent } = context;
    const category = detectHandCategories(cards)[0];
    const categoryScore = (category ? categoryStrength(category) : 0) * 2;
    const unitScore = formation.slots.reduce((sum, slot) => sum + unitValue(slot.typeId), 0) * 0.2;
    const roleScore = roleFillScore(formation, situation);
    const towerScore = towerDesireScore(formation, situation, intent);
    const dumpScore = dumpWasteScore(cards, situation);
    const packScore = nearbyPointEnemies(match, x, y, this.faction) * 14;
    const placement = this.placementScore(y, intent);
    const noise = this.rng.nextInt(this.difficulty === 'easy' ? 12 : 4);

    if (intent === 'emergency') {
      return packScore + unitScore * 0.5 + roleScore * 0.4 + towerScore * 0.2 + noise;
    }
    if (intent === 'dump') {
      return dumpScore + categoryScore + placement + noise;
    }
    if (intent === 'defend') {
      return towerScore + roleScore + unitScore + placement + categoryScore + noise;
    }
    return roleScore + unitScore + placement + categoryScore + towerScore * 0.3 + noise;
  }

  /** 防守靠主堡，爆兵靠河，清废牌走半场中段。 */
  private placementScore(y: number, intent: BotIntent): number {
    const { minY, maxY } = halfCourtYRange(this.faction);
    const depth = Math.max(1, maxY - minY);
    const forward = this.faction === Faction.Red ? (maxY - y) / depth : (y - minY) / depth;
    if (intent === 'defend') return (1 - forward) * 10;
    if (intent === 'wave') return forward * 8;
    return (1 - Math.abs(forward - 0.5)) * 3;
  }

  /** 出牌后冷却；爆兵连击把间隔砍半，手牌顶满时再略加快。 */
  private wait(match: MatchState, played: boolean, intent: BotIntent): void {
    let base = this.difficulty === 'easy' ? EASY_THINK_TICKS : HARD_THINK_TICKS;
    if (played && intent === 'wave') {
      if (this.waveBurstLeft <= 0) this.waveBurstLeft = this.difficulty === 'easy' ? 1 : 2;
      this.waveBurstLeft -= 1;
      base = Math.floor(base / 2);
    }
    const pressure = match.decks[this.faction].hand.length >= match.getMaxHandSize() - 1
      ? Math.floor(base / 3)
      : 0;
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

/** 不在同花/顺子 4+ 或对子骨架里的牌，压力小时优先打掉。 */
function findWasteCardIds(hand: readonly PlayingCard[]): Set<string> {
  const core = new Set<string>();
  for (const card of hand) {
    if (card.joker) core.add(card.id);
  }

  const byRank = new Map<string, PlayingCard[]>();
  const bySuit = new Map<string, PlayingCard[]>();
  for (const card of hand) {
    if (card.joker) continue;
    const ranks = byRank.get(card.rank) ?? [];
    ranks.push(card);
    byRank.set(card.rank, ranks);
    if (!card.suit) continue;
    const suited = bySuit.get(card.suit) ?? [];
    suited.push(card);
    bySuit.set(card.suit, suited);
  }
  for (const group of byRank.values()) {
    if (group.length >= 2) for (const card of group) core.add(card.id);
  }
  for (const group of bySuit.values()) {
    if (group.length >= 4) for (const card of group) core.add(card.id);
  }
  markStraightCore(hand, core);

  const waste = new Set<string>();
  for (const card of hand) {
    if (!core.has(card.id)) waste.add(card.id);
  }
  return waste;
}

/** 连续 4 个及以上不同点数视为凑顺骨架，这些牌先留着。 */
function markStraightCore(hand: readonly PlayingCard[], core: Set<string>): void {
  const byValue = new Map<number, PlayingCard[]>();
  for (const card of hand) {
    if (card.joker || card.rank === 'JOKER') continue;
    const value = STRAIGHT_VALUE[card.rank as CardRank];
    if (value === undefined) continue;
    const group = byValue.get(value) ?? [];
    group.push(card);
    byValue.set(value, group);
  }
  addConsecutiveRanks(byValue, core);
  if (byValue.has(14)) {
    const low = new Map(byValue);
    const aces = low.get(14)!;
    low.delete(14);
    low.set(1, aces);
    addConsecutiveRanks(low, core);
  }
}

function addConsecutiveRanks(byValue: Map<number, PlayingCard[]>, core: Set<string>): void {
  const values = [...byValue.keys()].sort((left, right) => left - right);
  if (values.length < 4) return;
  let start = 0;
  for (let index = 1; index <= values.length; index += 1) {
    const broken = index === values.length || values[index] !== values[index - 1]! + 1;
    if (!broken) continue;
    if (index - start >= 4) {
      for (const value of values.slice(start, index)) {
        for (const card of byValue.get(value) ?? []) core.add(card.id);
      }
    }
    start = index;
  }
}

function dumpWasteScore(cards: readonly PlayingCard[], situation: Situation): number {
  const wastePlayed = cards.filter((card) => situation.wasteCardIds.has(card.id)).length;
  const corePlayed = cards.length - wastePlayed;
  if (corePlayed > 0) return -40 - corePlayed * 10;
  return 36 + (cards.length <= 2 ? 10 : 0) - cards.length * 4;
}

/** 场上缺哪一排，就给对应槽位加分，避免再堆已经很多的那一排。 */
function roleFillScore(formation: CardFormation, situation: Situation): number {
  let front = 0;
  let back = 0;
  for (const slot of formation.slots) {
    if (isBuildingConfig(UNIT_CONFIGS[slot.typeId]) || isFuseBombTypeId(slot.typeId)) continue;
    if (isFrontlineType(slot.typeId)) front += 1;
    else back += 1;
  }
  if (front + back === 0) return 0;
  if (situation.frontCount < situation.backCount) return front * 12 - back * 6;
  if (situation.backCount < situation.frontCount) return back * 12 - front * 6;
  return Math.min(front, back) * 4;
}

function towerDesireScore(formation: CardFormation, situation: Situation, intent: BotIntent): number {
  const typeId = getFormationBuildingTypeId(formation);
  if (!typeId || !isArcherTowerId(typeId)) return 0;
  if (situation.towerCount >= MAX_PREFERRED_TOWERS) return -20;
  if (intent === 'defend') return 55;
  if (intent === 'emergency') return 8;
  return situation.towerCount === 0 ? 12 : 0;
}

function isFrontlineType(typeId: UnitTypeId): boolean {
  const config = UNIT_CONFIGS[typeId];
  if (isBuildingConfig(config) || isFuseBombTypeId(typeId)) return false;
  if (config.charge) return true;
  return config.attack.kind === 'melee' || config.attack.kind === 'melee_aoe';
}

function categoryStrength(category: string): number {
  const rank = HAND_CATEGORY_STRENGTH_ORDER.indexOf(category as HandCategory);
  return rank < 0 ? 0 : HAND_CATEGORY_STRENGTH_ORDER.length - rank;
}

function unitValue(typeId: keyof typeof UNIT_CONFIGS): number {
  const config = UNIT_CONFIGS[typeId];
  return Math.max(1, Math.round((toFloat(config.maxHp) + toFloat(config.damage) * 8) / 30));
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

function uniquePoints(points: readonly Point[]): Point[] {
  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const point of points) {
    const key = `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}
