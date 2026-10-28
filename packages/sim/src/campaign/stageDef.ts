import type { HandCategory } from '../config/handCategories.js';
import type { MatchRulesDraft } from '../config/matchRules.js';
import type { UnitTypeId } from '../config/units.js';
import type { CampaignArenaId } from '../config/campaignArenas.js';

/** 关卡目标：全部满足即通关，任一失败条件触发即失败。 */
export type StageObjective =
  /** 摧毁敌方主堡。 */
  | { kind: 'destroy_base' }
  /** 对局正常结束时玩家获胜（含时间到后血量领先）。 */
  | { kind: 'win_match' }
  /** 摧毁敌方全部箭塔（含高级、三连箭塔）。 */
  | { kind: 'destroy_towers' }
  /** 存活指定秒数且己方主堡未陷落。 */
  | { kind: 'survive_seconds'; seconds: number }
  /** 累计打出某牌型指定次数。 */
  | { kind: 'play_category'; category: HandCategory; count: number }
  /** 打出任意一手牌（不分牌型，第一手出兵即达成）。 */
  | { kind: 'play_any' }
  /** 清光敌方全部可移动单位（建筑不算）。 */
  | { kind: 'clear_enemy_units' }
  /**
   * 清掉这一波：出兵窗口结束且敌方不再有可移动单位。
   * 无限防守用它替代「撑满时长」，一波打完才进下一波。
   * spawnEndSeconds 是敌方脚本最后一次出兵的时间点（秒）。
   */
  | { kind: 'clear_wave'; spawnEndSeconds: number }
  /** 限制条件：整局出牌不超过 N 手，第 N+1 手打出即失败。 */
  | { kind: 'max_plays'; count: number }
  /** 击杀指定兵种：场上该兵种的敌方单位全部阵亡（开局就没有视为未达成）。 */
  | { kind: 'destroy_unit'; typeId: UnitTypeId; label: string }
  /** 限制条件：己方主堡血量始终不低于该比例（0~1），跌破即失败。 */
  | { kind: 'base_hp_above'; ratio: number }
  /** 限制条件：禁止打出某牌型，打出即失败。 */
  | { kind: 'forbid_category'; category: HandCategory }
  /** 领取半血保护卡包（主堡跌破半血后点击卡包）。 */
  | { kind: 'claim_castle_pack' };

/** 敌方行为：无行动、固定脚本或沿用人机。 */
export type StageEnemy =
  | { kind: 'none' }
  | { kind: 'bot'; difficulty: 'easy' | 'hard' }
  | { kind: 'script'; steps: ScriptedEnemyStep[] };

/**
 * 脚本敌人的一步：到点在指定位置直接放兵。
 * 不走敌方手牌，教学关的敌方行为因此不受发牌随机影响。
 */
export interface ScriptedEnemyStep {
  /** 开局后第几秒放兵。 */
  atSeconds: number;
  typeId: UnitTypeId;
  /** 数量，缺省 1；同点位横向错开排列。 */
  count?: number;
  /** 落点，sim 平面坐标，应在敌方半场。 */
  x: number;
  y: number;
}

/** 开局预放的单位或建筑。 */
export interface StagePresetUnit {
  /** 所属阵营：0 蓝（玩家），1 红（敌方）。 */
  faction: 0 | 1;
  typeId: UnitTypeId;
  x: number;
  y: number;
  /** 开局血量比例（0~1），缺省满血；用来摆残血塔、残血兵。 */
  hpRatio?: number;
  /** 驻守：原地不动，只打射程内的目标；用来摆敌方防线。 */
  hold?: boolean;
}

/** 一个战役关卡的全部数据；纯数据，可直接写成 JSON。 */
export interface StageDef {
  id: string;
  /** 关卡序号，从 1 开始，全战役连续编号（不分章节）。 */
  index: number;
  title: string;
  /** 战役地图（海岛/丛林/要塞），缺省为对战默认图。 */
  arena?: CampaignArenaId;
  /** 关卡时长（秒），缺省 CAMPAIGN_STAGE_SECONDS；时间到目标未达成判失败。 */
  durationSeconds?: number;
  /** 双方主堡开局血量比例（0~1），缺省满血。 */
  playerCastleHpRatio?: number;
  enemyCastleHpRatio?: number;
  /** 覆盖默认对局规则的字段，未写的沿用运行时默认。 */
  rules?: Partial<MatchRulesDraft>;
  /** 玩家牌堆限定：只保留这些点数的牌，缺省为整副牌。 */
  playerRanks?: string[];
  /** 是否保留大小王，缺省保留。 */
  playerJokers?: boolean;
  /**
   * 固定手牌（按点数写入，如 ["8","8","8","8","7","7","6"]）。
   * 有值时忽略 playerRanks，直接按这些点数凑出牌堆并全发到手上；
   * 花色按固定顺序挑选，同一关卡每次开局手牌完全一致。
   * 写 "WILD" 表示要一张万能牌，最多两张（全牌堆只有两张），超出部分会被忽略。
   */
  fixedHand?: string[];
  /**
   * 卡包预留牌（按点数写，如 ["8","8","8","8","K"]）。
   * 这些牌只进牌堆、不发到手上，只有领取半血保护卡包时才会被抽到；
   * 用来让「领包补 5 张」变成可预期的教学奖励。与 fixedHand 同点时跳过重复牌。
   */
  packHand?: string[];
  /**
   * 是否播种双方主堡，缺省 true。
   * false 用于「无基地」关卡：对局不会自动收局，通关全看关卡目标。
   */
  castles?: boolean;
  /**
   * 是否保留敌方主堡，缺省 true。
   * false 用于无限防守：敌方只进攻不守家，己方主堡照常参与陷落判定。
   */
  enemyCastles?: boolean;
  /** 玩家牌堆万能牌张数（需 rules.wildCardsEnabled 为 true），缺省 2。 */
  wildCount?: number;
  /**
   * 是否周期性补牌，缺省 true。
   * false 时整局只发开局那一手牌，教学关借此强制玩家用固定手牌解题。
   */
  periodicDraw?: boolean;
  enemy: StageEnemy;
  preset?: StagePresetUnit[];
  objectives: StageObjective[];
  /** 固定随机种子，保证教学体验一致。 */
  seed: number;
}

/** 目标判定输出。 */
export type StageStatus = 'pending' | 'success' | 'fail';
