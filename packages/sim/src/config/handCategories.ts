/**
 * 牌型 id、强度序与中文名。
 *
 * 单独成文件是为了打断循环依赖：阵型配置（cardFormations）依赖牌面匹配
 * （cardMapping），而牌面匹配又要知道牌型强度序。把这份纯常量下沉后，
 * 三边都只依赖本文件，不再互相绕圈。
 */

/** 发牌限制可识别的全部牌型 id。 */
export type HandCategory =
  | 'single'
  | 'pair'
  | 'rocket'
  | 'triple'
  | 'straight3'
  | 'bomb'
  | 'two_pair'
  | 'straight4'
  | 'full_house'
  | 'straight5'
  | 'flush'
  | 'straight_flush';

/** 牌型强度降序：同花顺最强，单张最弱；出牌比对与阵型并集按此顺序。 */
export const HAND_CATEGORY_STRENGTH_ORDER: readonly HandCategory[] = [
  'straight_flush',
  'bomb',
  'rocket',
  'flush',
  'full_house',
  'straight5',
  'two_pair',
  'triple',
  'straight4',
  'straight3',
  'pair',
  'single',
] as const;

/** 卡组页选项顺序：单张在上，同花顺在下，由强度序反转派生。 */
export const HAND_CATEGORY_ORDER: readonly HandCategory[] = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();

/** 牌型中文名，供 UI 与调试展示。 */
export const HAND_CATEGORY_NAMES: Readonly<Record<HandCategory, string>> = {
  single: '单张',
  pair: '对子',
  rocket: '王炸',
  triple: '三张',
  straight3: '三顺',
  bomb: '炸弹',
  two_pair: '连对',
  straight4: '四顺',
  full_house: '葫芦',
  straight5: '五顺',
  flush: '同花',
  straight_flush: '同花顺',
};
