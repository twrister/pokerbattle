/**
 * 音效资源目录。
 *
 * 大部分来自 Kenney（CC0，可商用、无需署名），爆炸/弓箭/界面点击/投掷炸弹/法术/治疗/胜负结算
 * 已换成项目自制素材，详见 public/sfx/LICENSE.txt。放在 public/sfx 下用相对路径加载，
 * 与 cards/units 贴图一致——正式服部署在子路径时绝对根路径会 404。
 */

export const SFX_DIR = 'sfx/';

/** 播放用的音效枚举；缺资源时静默跳过，不影响游戏跑通。 */
export type SfxId =
  | 'ui_click'
  | 'ui_confirm'
  | 'ui_back'
  | 'ui_error'
  | 'ui_open'
  | 'ui_close'
  | 'ui_announce'
  | 'card_select'
  | 'card_play'
  | 'card_draw'
  | 'pack_open'
  | 'pack_claim'
  | 'spawn'
  | 'melee'
  | 'arrow'
  | 'magic'
  | 'bomb_toss'
  | 'explode'
  | 'explode_big'
  | 'hit'
  | 'hit_big'
  | 'death'
  | 'building_down'
  | 'heal'
  | 'result_win'
  | 'result_lose'
  | 'result_draw';

/** 单个音效的播放参数。 */
export interface SfxDef {
  /** 相对 public 的文件名（不带扩展名）。 */
  file: string;
  /** 基础音量 0~1，混音时再乘主音量。 */
  volume: number;
  /** 同一音效的最短重触发间隔；0 表示不限制。 */
  minIntervalMs: number;
  /** 同时可以并发的实例上限，避免大规模交火时声音糊成一团。 */
  maxVoices: number;
  /** 音高抖动幅度；>0 时每次随机在 [1-抖, 1+抖] 之间移调，减少重复感。 */
  pitchJitter?: number;
}

export const SFX_DEFS: Readonly<Record<SfxId, SfxDef>> = {
  // UI 交互：短、克制，连续点击也只留一声
  ui_click: { file: 'ui_click', volume: 0.34, minIntervalMs: 45, maxVoices: 2 },
  ui_confirm: { file: 'ui_confirm', volume: 0.42, minIntervalMs: 120, maxVoices: 2 },
  ui_back: { file: 'ui_back', volume: 0.38, minIntervalMs: 120, maxVoices: 2 },
  ui_error: { file: 'ui_error', volume: 0.4, minIntervalMs: 240, maxVoices: 2 },
  ui_open: { file: 'ui_open', volume: 0.34, minIntervalMs: 120, maxVoices: 2 },
  ui_close: { file: 'ui_close', volume: 0.3, minIntervalMs: 120, maxVoices: 2 },
  ui_announce: { file: 'ui_announce', volume: 0.4, minIntervalMs: 200, maxVoices: 2 },

  // 手牌与卡包
  card_select: { file: 'card_select', volume: 0.3, minIntervalMs: 55, maxVoices: 2, pitchJitter: 0.05 },
  card_play: { file: 'card_play', volume: 0.45, minIntervalMs: 90, maxVoices: 3 },
  card_draw: { file: 'card_draw', volume: 0.26, minIntervalMs: 120, maxVoices: 2, pitchJitter: 0.06 },
  pack_open: { file: 'pack_open', volume: 0.45, minIntervalMs: 200, maxVoices: 1 },
  pack_claim: { file: 'pack_claim', volume: 0.45, minIntervalMs: 200, maxVoices: 2 },

  // 战斗：投送与各类武器
  spawn: { file: 'spawn', volume: 0.32, minIntervalMs: 260, maxVoices: 2, pitchJitter: 0.08 },
  melee: { file: 'melee', volume: 0.24, minIntervalMs: 170, maxVoices: 2, pitchJitter: 0.1 },
  arrow: { file: 'arrow', volume: 0.2, minIntervalMs: 190, maxVoices: 2, pitchJitter: 0.12 },
  magic: { file: 'magic', volume: 0.22, minIntervalMs: 200, maxVoices: 2, pitchJitter: 0.1 },
  bomb_toss: { file: 'bomb_toss', volume: 0.3, minIntervalMs: 180, maxVoices: 2, pitchJitter: 0.08 },
  explode: { file: 'explode', volume: 0.42, minIntervalMs: 140, maxVoices: 2, pitchJitter: 0.06 },
  explode_big: { file: 'explode_big', volume: 0.55, minIntervalMs: 180, maxVoices: 2 },
  hit: { file: 'hit', volume: 0.18, minIntervalMs: 150, maxVoices: 2, pitchJitter: 0.12 },
  hit_big: { file: 'hit_big', volume: 0.3, minIntervalMs: 200, maxVoices: 2, pitchJitter: 0.08 },
  death: { file: 'death', volume: 0.24, minIntervalMs: 180, maxVoices: 2, pitchJitter: 0.1 },
  building_down: { file: 'building_down', volume: 0.42, minIntervalMs: 300, maxVoices: 1 },
  heal: { file: 'heal', volume: 0.28, minIntervalMs: 260, maxVoices: 2, pitchJitter: 0.06 },

  // 结算
  result_win: { file: 'result_win', volume: 0.5, minIntervalMs: 1000, maxVoices: 1 },
  result_lose: { file: 'result_lose', volume: 0.45, minIntervalMs: 1000, maxVoices: 1 },
  result_draw: { file: 'result_draw', volume: 0.45, minIntervalMs: 1000, maxVoices: 1 },
};

/** 静音开关的存储键；与账号无关，跟随浏览器。 */
export const SFX_MUTED_STORAGE_KEY = 'pb.sfx.muted';

/** 被单独关掉的音效 id 列表存储键，值为 JSON 数组；与账号无关，跟随浏览器。 */
export const SFX_DISABLED_STORAGE_KEY = 'pb.sfx.disabled';

/**
 * 音效分组。
 * 开发服试听页按这个顺序分块，列表才不会把界面音和爆炸声混在一起。
 */
export type SfxGroup = 'ui' | 'card' | 'battle' | 'result';

/** 分组展示文案，顺序即页面里的块顺序。 */
export const SFX_GROUP_ORDER: readonly SfxGroup[] = ['ui', 'card', 'battle', 'result'];

export const SFX_GROUP_LABELS: Readonly<Record<SfxGroup, string>> = {
  ui: '界面交互',
  card: '手牌与卡包',
  battle: '战斗',
  result: '结算',
};

/** 试听页展示用的音效元信息。 */
export interface SfxMeta {
  /** 中文名；给不熟悉 id 的人看的。 */
  label: string;
  group: SfxGroup;
}

/** 与 SFX_DEFS 同键，用 Record 保证新增音效时这里不会漏项。 */
export const SFX_META: Readonly<Record<SfxId, SfxMeta>> = {
  ui_click: { label: '按钮点击', group: 'ui' },
  ui_confirm: { label: '确认', group: 'ui' },
  ui_back: { label: '返回', group: 'ui' },
  ui_error: { label: '错误提示', group: 'ui' },
  ui_open: { label: '打开弹层', group: 'ui' },
  ui_close: { label: '关闭弹层', group: 'ui' },
  ui_announce: { label: '公告播报', group: 'ui' },

  card_select: { label: '选牌', group: 'card' },
  card_play: { label: '出牌', group: 'card' },
  card_draw: { label: '抽牌', group: 'card' },
  pack_open: { label: '开卡包', group: 'card' },
  pack_claim: { label: '领取卡包', group: 'card' },

  spawn: { label: '投送兵种', group: 'battle' },
  melee: { label: '近战攻击', group: 'battle' },
  arrow: { label: '箭矢', group: 'battle' },
  magic: { label: '法术', group: 'battle' },
  bomb_toss: { label: '投掷炸弹', group: 'battle' },
  explode: { label: '爆炸', group: 'battle' },
  explode_big: { label: '大型爆炸', group: 'battle' },
  hit: { label: '受击', group: 'battle' },
  hit_big: { label: '重击', group: 'battle' },
  death: { label: '单位死亡', group: 'battle' },
  building_down: { label: '建筑倒塌', group: 'battle' },
  heal: { label: '治疗', group: 'battle' },

  result_win: { label: '胜利结算', group: 'result' },
  result_lose: { label: '失败结算', group: 'result' },
  result_draw: { label: '平局结算', group: 'result' },
};
