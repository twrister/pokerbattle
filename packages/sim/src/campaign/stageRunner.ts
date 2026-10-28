import { createPokerCards, type PlayingCard } from '../cards/deck.js';
import type { Command } from '../commands.js';
import { matchRulesWithOverrides } from '../config/matchRules.js';
import { TICK_RATE } from '../config/tuning.js';
import { Faction } from '../entity/unit.js';
import { type Fx, fromFloat } from '../math/fixed.js';
import type { MatchState } from '../match/matchState.js';
import { SoloBotController } from '../match/soloBot.js';
import { ObjectiveTracker } from './objectiveTracker.js';
import { ScriptedEnemy } from './scriptedEnemy.js';
import type { StageDef } from './stageDef.js';

/** 战役统一时长（秒）：2 分钟单段常规阶段。 */
export const CAMPAIGN_STAGE_SECONDS = 120;

/**
 * 把关卡定义应用到一局 MatchState，并统一管理敌方行为与目标判定。
 * 调用顺序：构造 MatchState → seedStartingCastles → new StageRunner(def, match)。
 */
export class StageRunner {
  readonly tracker: ObjectiveTracker;
  private readonly enemy: ScriptedEnemy | SoloBotController | null;

  constructor(
    readonly def: StageDef,
    private readonly match: MatchState,
  ) {
    // 地图最先换：后面的预放单位、建筑落点都要按新地形校验
    if (def.arena) match.setCampaignArena(def.arena);
    this.applyRulesAndDeck();
    this.applyCampaignTimeline();
    this.applyStageSwitches();
    this.applyCastleHp();
    this.placePresetUnits();
    this.tracker = new ObjectiveTracker(def, Faction.Blue, TICK_RATE * stageDurationSeconds(def));
    this.enemy = createEnemy(def);
  }

  /** 敌方指令来源，供 SimLoop.addCommandSource 挂载；无敌方行为时返回 null。 */
  decide(match: MatchState): Command | null {
    return this.enemy ? this.enemy.decide(match) : null;
  }

  /** 每个逻辑帧 step 之后调用，更新目标判定。 */
  update(): void {
    this.tracker.update(this.match);
  }

  /** 套用规则覆盖与玩家限定牌池。 */
  private applyRulesAndDeck(): void {
    const { def, match } = this;
    if (def.rules) match.applyRules(matchRulesWithOverrides(def.rules));
    // 固定手牌优先：整副牌就是这 N 张，开局全部发到手上；packHand 的牌只留在牌堆里
    if (def.fixedHand?.length) {
      const used = new Set<string>();
      const hand = cardsForHand(def.fixedHand, used);
      const reserve = def.packHand?.length ? cardsForHand(def.packHand, used) : [];
      match.setSlotDeckCards(Faction.Blue, hand, hand.length, reserve);
      return;
    }
    if (def.playerRanks || def.playerJokers === false) {
      match.setSlotDeckCards(Faction.Blue, filterPlayerCards(def));
    }
  }

  /**
   * 套用战役固定时间轴：只有一段常规阶段，时间到直接按主堡血量判胜负。
   * 必须在 applyRules 之后调用（它会按默认草稿写回时长），且不允许关卡数据覆盖。
   */
  private applyCampaignTimeline(): void {
    this.match.setPhaseDurations({
      normalTicks: TICK_RATE * stageDurationSeconds(this.def),
      doubleSpeedTicks: 0,
      finalTicks: 0,
      settlementTicks: 0,
    });
  }

  /**
   * 套用关卡的场景开关：是否周期补牌、是否要有主堡。
   * 必须在 placePresetUnits 之前——拆基地会顺带清掉占格，避免预置兵被挤出。
   */
  private applyStageSwitches(): void {
    this.match.setPeriodicDrawEnabled(this.def.periodicDraw !== false);
    if (this.def.castles === false) this.match.clearStartingCastles();
  }

  /** 按关卡写双方主堡开局血量（残血守家、一刀斩）。 */
  private applyCastleHp(): void {
    const { def, match } = this;
    if (def.playerCastleHpRatio !== undefined) match.setCastleHpRatio(Faction.Blue, def.playerCastleHpRatio);
    if (def.enemyCastleHpRatio !== undefined) match.setCastleHpRatio(Faction.Red, def.enemyCastleHpRatio);
  }

  /** 放置开局预置单位；建筑走 spawnBuilding 以同步占格，残血与驻守在生成后写入。 */
  private placePresetUnits(): void {
    const world = this.match.world;
    for (const preset of this.def.preset ?? []) {
      const faction = preset.faction === 0 ? Faction.Blue : Faction.Red;
      const unit = world.spawnUnit(faction, preset.typeId, fromFloat(preset.x), fromFloat(preset.y));
      if (preset.hpRatio !== undefined) unit.hp = scaledHp(unit.config.maxHp, preset.hpRatio);
      if (preset.hold) unit.hold = true;
    }
  }
}

/** 关卡时长（秒）：没写时用战役统一时长。 */
export function stageDurationSeconds(def: Pick<StageDef, 'durationSeconds'>): number {
  return def.durationSeconds && def.durationSeconds > 0 ? def.durationSeconds : CAMPAIGN_STAGE_SECONDS;
}

/** 按比例折算血量（定点数），至少留 1 点，避免开局就判死。 */
function scaledHp(maxHp: Fx, ratio: number): Fx {
  const clamped = Math.min(1, Math.max(0, ratio));
  return Math.max(1, Math.round(maxHp * clamped));
}

/**
 * 按关卡给定的点数挑出具体牌。
 * 花色按「手牌位置」在剩余同点数牌里轮换挑选，结果只由关卡数据决定，每次开局完全一致；
 * 点数写错或超过四种花色时直接跳过，避免关卡数据笔误把整局卡死。
 * 点数写 "WILD" 表示要一张万能牌：牌面始终按含万能牌构建，因此会按顺序取到 wild-1、wild-2。
 * used 用来跨手牌/卡包预留牌去重，保证同一张实体牌不会出现在两处。
 */
function cardsForHand(ranks: readonly string[], used: Set<string>): PlayingCard[] {
  const cards = createPokerCards({ wildCards: true });
  const picked: PlayingCard[] = [];
  ranks.forEach((rank, position) => {
    const candidates = cards.filter((item) => item.rank === rank && !used.has(item.id));
    // 按位置轮换起始花色：连续点数不会全落在同一花色，避免顺子意外变成同花顺
    const card = candidates[position % Math.max(1, candidates.length)];
    if (!card) return;
    used.add(card.id);
    picked.push(card);
  });
  return picked;
}

/** 按关卡限定生成玩家牌面：保留指定点数，可去掉大小王。 */
function filterPlayerCards(def: StageDef): PlayingCard[] {
  const wild = matchRulesWithOverrides(def.rules ?? {}).wildCardsEnabled;
  const ranks = def.playerRanks ? new Set(def.playerRanks) : null;
  return createPokerCards({ wildCards: wild }).filter((card) => {
    if (card.rank === 'JOKER') return def.playerJokers !== false;
    if (card.wild) return def.playerJokers !== false;
    return ranks ? ranks.has(card.rank) : true;
  });
}

/** 按关卡配置创建敌方控制器；人机种子取关卡固定 seed 保证可复现。 */
function createEnemy(def: StageDef): ScriptedEnemy | SoloBotController | null {
  const enemy = def.enemy;
  if (enemy.kind === 'script') return new ScriptedEnemy(enemy.steps);
  if (enemy.kind === 'bot') return new SoloBotController(enemy.difficulty, def.seed);
  return null;
}
