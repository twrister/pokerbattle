import { type Fx, fromFloat, toFloat } from '../math/fixed.js';
import type { CardRank, PlayingCard } from '../cards/deck.js';
import { Faction } from '../entity/unit.js';
import { UNIT_CONFIGS, UNIT_TYPE_IDS, isBuildingConfig, type UnitTypeId } from './units.js';
import {
  SPECIAL_UNIT_THUMB_SCALE,
  formatSpecialTierLabel,
  getSpecialUnitFormation,
  getUnitSpecialTier,
  isSpecialTier,
  listUnitsBySpecialTier,
  specialTierExpandedId,
  type SpecialTier,
} from './specialTiers.js';
import {
  FORMATION_MATCH_RANKS,
  FUSE_BOMB_DAMAGE_RANKS,
  getPreviewCardsForFormation,
  resolveMappedRows,
  type FuseBombDamageRank,
  type MappedFormationUnit,
} from './cardMapping.js';
import rawCardFormations from './cardFormations.json';

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

/** 同排相邻兵种的默认横向间距（格）。 */
export const FORMATION_COL_SPACING = 1.2;
/** 相邻排的默认前后间距（格）；row 越大越靠后。 */
export const FORMATION_ROW_SPACING = 1.4;
/** 阵型按钮缩略图默认放大倍率；只影响按钮处兵种显示。 */
export const FORMATION_THUMB_SCALE = 2;

/** 搭配中的单个兵种条目（由 rows 汇总，供 UI 统计）。 */
export interface FormationUnitEntry {
  typeId: UnitTypeId;
  count: number;
}

/** 图鉴「可组成牌型」一行：一种牌型配一组样例牌。 */
export interface UnitHandExample {
  category: HandCategory;
  name: string;
  cards: PlayingCard[];
}

/**
 * 阵型中的一个落位点。
 * row=0 为最前排（朝向敌方），col 为该排内从左到右的下标。
 */
export interface FormationSlot {
  typeId: UnitTypeId;
  row: number;
  col: number;
}

/** 牌面匹配：决定哪些点数可使用该兵种搭配。 */
export type FormationMatchRule =
  | { kind: 'any' }
  | { kind: 'numbers' }
  | { kind: 'ranks'; ranks: CardRank[] }
  /** 只看出现 3 次的点数（葫芦的三条），对子点数不参与匹配。 */
  | { kind: 'tripleRanks'; ranks: CardRank[] }
  /**
   * 按「指定点数出现张数」分档，min/max 至少填一个。
   * 同花用它把「含 2+ 张 J～A」与其余手牌拆开，避免 any 与高档重叠。
   */
  | { kind: 'rankCount'; ranks: CardRank[]; min?: number; max?: number }
  | { kind: 'joker'; joker: 'black' | 'red' };

/** 一条「牌型 → 兵种搭配」配置，含可配置前后站位。 */
export interface CardFormation {
  id: string;
  name: string;
  category: HandCategory;
  /** 哪些牌面可使用本搭配。 */
  match: FormationMatchRule;
  /** rows[0] = 前排，rows[n] = 更靠后；每行从左到右。 */
  rows: UnitTypeId[][];
  /** 展开后的落位列表，与 rows 一一对应。 */
  slots: FormationSlot[];
  /** 按 typeId 汇总的兵种数量，便于 UI 展示。 */
  units: FormationUnitEntry[];
  /** 可选覆盖默认间距；缺省用全局 FORMATION_*_SPACING。 */
  colSpacing: number;
  rowSpacing: number;
  /** 按钮缩略图兵种放大倍率；缺省用 FORMATION_THUMB_SCALE。 */
  thumbScale: number;
  /** 引信炸弹按点数覆盖伤害；缺档回落单位配置。 */
  rankDamage?: Partial<Record<FuseBombDamageRank, number>>;
  /** 火箭等无点数炸弹的固定伤害；缺省回落单位配置。 */
  damage?: number;
  /** 引信炸弹爆炸半径（格）；缺省回落单位配置。 */
  aoeRadius?: number;
}

/** 解析后的世界坐标出生点（浮点格坐标，出兵前再 fromFloat）。 */
export interface FormationSpawnPoint {
  typeId: UnitTypeId;
  x: number;
  y: number;
  row: number;
  col: number;
}

/** 写入 JSON 与配置页面使用的可编辑阵型草稿。 */
export interface FormationDraft {
  id: string;
  name: string;
  match: FormationMatchRule;
  rows: UnitTypeId[][];
  colSpacing?: number;
  rowSpacing?: number;
  /** 按钮缩略图放大；缺省 FORMATION_THUMB_SCALE。 */
  thumbScale?: number;
  /**
   * 情况级特殊兵种档位映射。
   * 有值时本条是哨兵：rows 可空，加载时展开为该档全部单兵种阵型。
   */
  specialTier?: SpecialTier;
  /** 引信炸弹按点数覆盖伤害；缺档回落单位配置。 */
  rankDamage?: Partial<Record<FuseBombDamageRank, number>>;
  /** 火箭等无点数炸弹的固定伤害；缺省回落单位配置。 */
  damage?: number;
  /** 引信炸弹爆炸半径（格）；缺省回落单位配置。 */
  aoeRadius?: number;
}

/** 所有牌型下的阵型草稿集合。 */
export type CardFormationDrafts = Record<HandCategory, FormationDraft[]>;

/** 把 rows 展成带行列下标的 slots。 */
function slotsFromRows(rows: readonly (readonly UnitTypeId[])[]): FormationSlot[] {
  const slots: FormationSlot[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((typeId, colIndex) => {
      slots.push({ typeId, row: rowIndex, col: colIndex });
    });
  });
  return slots;
}

/** 按出现顺序汇总各兵种数量。 */
function unitsFromSlots(slots: readonly FormationSlot[]): FormationUnitEntry[] {
  const counts = new Map<UnitTypeId, number>();
  const order: FormationUnitEntry[] = [];
  for (const slot of slots) {
    if (!counts.has(slot.typeId)) order.push({ typeId: slot.typeId, count: 0 });
    counts.set(slot.typeId, (counts.get(slot.typeId) ?? 0) + 1);
  }
  return order.map((entry) => ({ ...entry, count: counts.get(entry.typeId)! }));
}

/** 解析阵型按钮放大倍率；非法或未配置时回落默认。 */
function resolveThumbScale(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : FORMATION_THUMB_SCALE;
}

/** 深拷贝牌面匹配规则，避免编辑草稿互相污染。 */
function cloneMatchRule(match: FormationMatchRule): FormationMatchRule {
  if (match.kind === 'ranks') return { kind: 'ranks', ranks: [...match.ranks] };
  if (match.kind === 'tripleRanks') return { kind: 'tripleRanks', ranks: [...match.ranks] };
  if (match.kind === 'rankCount') return cloneRankCountMatch(match);
  if (match.kind === 'joker') return { kind: 'joker', joker: match.joker };
  return { kind: match.kind };
}

/** 拷贝点数张数规则，只带上已配置的 min/max。 */
function cloneRankCountMatch(
  match: Extract<FormationMatchRule, { kind: 'rankCount' }>,
): Extract<FormationMatchRule, { kind: 'rankCount' }> {
  return {
    kind: 'rankCount',
    ranks: [...match.ranks],
    ...(match.min === undefined ? {} : { min: match.min }),
    ...(match.max === undefined ? {} : { max: match.max }),
  };
}

/** 卡组页按 match 分组后的一条「情况」。 */
export interface FormationMatchGroup {
  key: string;
  label: string;
  match: FormationMatchRule;
  /** 该组在原 drafts 数组中的下标，保持首次出现顺序。 */
  indices: number[];
}

/** 把 ranks 收到点数表顺序，避免同一组因勾选顺序不同被拆开。 */
function sortMatchRanks(ranks: readonly CardRank[]): CardRank[] {
  return FORMATION_MATCH_RANKS.filter((rank) => ranks.includes(rank));
}

/** 标签区间按牌力 2…A，避免 A 排最前把 2～10 拆开。 */
const POKER_LABEL_RANK_ORDER: readonly CardRank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
];

/** 把连续点数收成 2～10 / J～A 这类区间，方便情况列阅读。 */
function formatRankRanges(ranks: readonly CardRank[]): string {
  const ordered = POKER_LABEL_RANK_ORDER.filter((rank) => ranks.includes(rank));
  if (ordered.length === 0) return '';
  const ranges: string[] = [];
  let start = ordered[0]!;
  let prev = start;
  const flush = (end: CardRank): void => {
    ranges.push(start === end ? start : `${start}～${end}`);
  };
  for (let index = 1; index < ordered.length; index += 1) {
    const rank = ordered[index]!;
    if (POKER_LABEL_RANK_ORDER.indexOf(rank) === POKER_LABEL_RANK_ORDER.indexOf(prev) + 1) {
      prev = rank;
      continue;
    }
    flush(prev);
    start = rank;
    prev = rank;
  }
  flush(prev);
  return ranges.join('、');
}

/** 把 match 收成稳定键，供情况列去重。 */
export function matchRuleKey(match: FormationMatchRule): string {
  switch (match.kind) {
    case 'any':
      return 'any';
    case 'numbers':
      return 'numbers';
    case 'joker':
      return `joker:${match.joker}`;
    case 'ranks':
      return `ranks:${sortMatchRanks(match.ranks).join(',')}`;
    case 'tripleRanks':
      return `tripleRanks:${sortMatchRanks(match.ranks).join(',')}`;
    case 'rankCount':
      return `rankCount:${sortMatchRanks(match.ranks).join(',')}:${match.min ?? ''}:${match.max ?? ''}`;
  }
}

/** 情况列展示名，与配置页 match 编辑器文案对齐。 */
export function formatMatchRuleLabel(match: FormationMatchRule): string {
  switch (match.kind) {
    case 'any':
      return '任意';
    case 'numbers':
      return '数字牌 2～10';
    case 'joker':
      return match.joker === 'black' ? '小王' : '大王';
    case 'ranks':
      // 展示沿用配置顺序（如 Q-K-A），不要按点数表重排成 A-Q-K。
      return match.ranks.join('-');
    case 'tripleRanks': {
      const ranges = formatRankRanges(match.ranks);
      return ranges ? `三条 ${ranges}` : '三条';
    }
    case 'rankCount':
      return formatRankCountLabel(match);
  }
}

/** 点数张数规则的情况列文案，如「含 2+ 张 J～A」。 */
function formatRankCountLabel(match: Extract<FormationMatchRule, { kind: 'rankCount' }>): string {
  const ranges = formatRankRanges(match.ranks);
  const rankText = ranges || '指定点数';
  const { min, max } = match;
  if (min !== undefined && max !== undefined) {
    return min === max ? `含 ${min} 张 ${rankText}` : `含 ${min}～${max} 张 ${rankText}`;
  }
  if (min !== undefined) return `含 ${min}+ 张 ${rankText}`;
  if (max !== undefined) return max === 0 ? `不含 ${rankText}` : `含 0～${max} 张 ${rankText}`;
  return `含 ${rankText}`;
}

/** 按首次出现顺序把阵型草稿收成情况组。 */
export function groupFormationsByMatch(drafts: readonly FormationDraft[]): FormationMatchGroup[] {
  const groups: FormationMatchGroup[] = [];
  const byKey = new Map<string, FormationMatchGroup>();
  drafts.forEach((draft, index) => {
    const key = matchRuleKey(draft.match);
    const existing = byKey.get(key);
    if (existing) {
      existing.indices.push(index);
      return;
    }
    const group: FormationMatchGroup = {
      key,
      label: formatMatchRuleLabel(draft.match),
      match: cloneMatchRule(draft.match),
      indices: [index],
    };
    byKey.set(key, group);
    groups.push(group);
  });
  return groups;
}

/** 拷贝引信炸弹伤害与半径字段；缺省不写入，避免普通阵型带上空对象。 */
function cloneBombDamageFields(
  source: Pick<FormationDraft, 'rankDamage' | 'damage' | 'aoeRadius'>,
): Pick<FormationDraft, 'rankDamage' | 'damage' | 'aoeRadius'> {
  const out: Pick<FormationDraft, 'rankDamage' | 'damage' | 'aoeRadius'> = {};
  if (source.rankDamage !== undefined) out.rankDamage = { ...source.rankDamage };
  if (source.damage !== undefined) out.damage = source.damage;
  if (source.aoeRadius !== undefined) out.aoeRadius = source.aoeRadius;
  return out;
}

/** 是否为情况级档位映射哨兵。 */
export function isSpecialTierDraft(
  draft: Pick<FormationDraft, 'specialTier'>,
): draft is FormationDraft & { specialTier: SpecialTier } {
  return isSpecialTier(draft.specialTier);
}

/** 卡组页阵型列表文案：哨兵显示整档兵种，手写阵型用配置名。 */
export function formatFormationDraftListLabel(draft: FormationDraft): string {
  if (isSpecialTierDraft(draft)) return formatSpecialTierLabel(draft.specialTier);
  return draft.name || draft.id;
}

/** 阵型全部槽位为同一兵种时返回该 id。 */
function exclusiveFormationTypeId(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): UnitTypeId | undefined {
  const slots = formation.rows.flat();
  const typeId = slots[0];
  if (!typeId || slots.some((id) => id !== typeId)) return undefined;
  return typeId;
}

/**
 * 单兵种阵型的特殊档位；混编或非特殊兵种为 undefined。
 * 颜色看展开后的独占兵种，因此同花顺双石头人也会是 5 档。
 */
export function getFormationSpecialTier(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): SpecialTier | undefined {
  const typeId = exclusiveFormationTypeId(formation);
  return typeId ? getUnitSpecialTier(typeId) : undefined;
}

/**
 * 按兵种当前档位参数生成一条展开阵型；建筑始终单槽，避免撞上「建筑只能单独成阵」。
 * 预览页与哨兵展开共用，避免两处各自拼 rows。
 */
export function createSpecialUnitCardFormation(
  category: HandCategory,
  draft: Pick<FormationDraft, 'id' | 'match'>,
  typeId: UnitTypeId,
): CardFormation {
  const params = getSpecialUnitFormation(typeId);
  const building = isBuildingConfig(UNIT_CONFIGS[typeId]);
  const count = building ? 1 : (params?.unitCount ?? 1);
  return createCardFormation(category, {
    id: specialTierExpandedId(draft.id, typeId),
    name: UNIT_CONFIGS[typeId]?.name ?? typeId,
    match: draft.match,
    rows: [Array.from({ length: count }, () => typeId)],
    ...(params?.colSpacing === undefined ? {} : { colSpacing: params.colSpacing }),
    ...(params?.rowSpacing === undefined ? {} : { rowSpacing: params.rowSpacing }),
    thumbScale: params?.thumbScale ?? SPECIAL_UNIT_THUMB_SCALE[typeId],
  });
}

/**
 * 把一条 compact 草稿变成运行时阵型：档位哨兵按名单展开，其余保持手写 rows。
 * 数量/间距/放大读该兵种独立配置。
 */
export function expandFormationDraft(category: HandCategory, draft: FormationDraft): CardFormation[] {
  if (!isSpecialTierDraft(draft)) {
    return [createCardFormation(category, draft)];
  }
  return listUnitsBySpecialTier(draft.specialTier).map((typeId) =>
    createSpecialUnitCardFormation(category, draft, typeId),
  );
}

/** 从 compact 草稿展开运行时阵型。 */
function formationsFromDrafts(drafts: CardFormationDrafts): Record<HandCategory, CardFormation[]> {
  const out = {} as Record<HandCategory, CardFormation[]>;
  for (const category of HAND_CATEGORY_ORDER) {
    out[category] = (drafts[category] ?? []).flatMap((entry) => expandFormationDraft(category, entry));
  }
  return out;
}

/** 将单条草稿派生成预览可用的阵型，不会写入运行时配置。 */
export function createCardFormation(category: HandCategory, draft: FormationDraft): CardFormation {
  const rows = (draft.rows ?? []).map((row) => [...row]);
  const slots = slotsFromRows(rows);
  return {
    id: draft.id,
    name: draft.name,
    category,
    match: cloneMatchRule(draft.match),
    rows,
    slots,
    units: unitsFromSlots(slots),
    colSpacing:
      Number.isFinite(draft.colSpacing) && (draft.colSpacing as number) > 0
        ? (draft.colSpacing as number)
        : FORMATION_COL_SPACING,
    rowSpacing:
      Number.isFinite(draft.rowSpacing) && (draft.rowSpacing as number) > 0
        ? (draft.rowSpacing as number)
        : FORMATION_ROW_SPACING,
    thumbScale: resolveThumbScale(draft.thumbScale),
    ...cloneBombDamageFields(draft),
  };
}

/**
 * 将静态方案模板按实际牌面展开为可出兵阵型。
 * 全部牌型均以配置的 match / rows 为准；不适用的方案返回 null。
 */
export function resolveCardFormation(
  formation: CardFormation,
  cards: readonly PlayingCard[],
): CardFormation | null {
  const mappedRows = resolveMappedRows(formation.rows, formation.match, cards);
  if (!mappedRows) return null;
  return formationFromMappedRows(formation, mappedRows);
}

/** 将规则展开结果转换为阵型运行时结构。 */
function formationFromMappedRows(
  source: CardFormation,
  mappedRows: readonly (readonly MappedFormationUnit[])[],
): CardFormation {
  const rows = mappedRows.map((row) => row.map((unit) => unit.typeId));
  const slots = mappedRows.flatMap((row, rowIndex) =>
    row.map((unit, col) => ({ typeId: unit.typeId, row: rowIndex, col })),
  );
  return { ...source, rows, slots, units: unitsFromSlots(slots) };
}

/** compact 草稿真源：dump 必须回这条，否则哨兵会被拆成多条手写阵型。 */
let sourceDrafts: CardFormationDrafts = cloneDrafts(rawCardFormations as CardFormationDrafts);

/** 从 JSON 初始化的运行时阵型；顶层对象与各牌型数组在应用草稿时保持引用稳定。 */
export const CARD_FORMATIONS: Record<HandCategory, CardFormation[]> = formationsFromDrafts(sourceDrafts);
let defaultDrafts: CardFormationDrafts = cloneDrafts(sourceDrafts);

/** 深拷贝单条草稿，避免复制/编辑时源与副本互相污染。 */
export function cloneFormationDraft(source: FormationDraft): FormationDraft {
  return {
    id: source.id,
    name: source.name,
    match: cloneMatchRule(source.match),
    rows: (source.rows ?? []).map((row) => [...row]),
    ...(source.colSpacing === undefined ? {} : { colSpacing: source.colSpacing }),
    ...(source.rowSpacing === undefined ? {} : { rowSpacing: source.rowSpacing }),
    ...(source.thumbScale === undefined ? {} : { thumbScale: source.thumbScale }),
    ...(isSpecialTier(source.specialTier) ? { specialTier: source.specialTier } : {}),
    ...cloneBombDamageFields(source),
  };
}

/**
 * 为新建阵型分配尚未占用的 `${category}_custom_N`。
 * 不能按当前列表长度编号：内置命名阵型会占名额，删改后再新增会撞上已有 custom id。
 */
export function allocateNewFormationIdentity(
  category: HandCategory,
  existingIds: ReadonlySet<string>,
): { id: string; number: number } {
  const prefix = `${category}_custom_`;
  let number = 1;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    number = Math.max(number, Number(suffix) + 1);
  }
  while (existingIds.has(`${prefix}${number}`)) number += 1;
  return { id: `${prefix}${number}`, number };
}

/**
 * 为副本分配尚未占用的 id / 名称。
 * 连续复制同一谱系时剥掉已有 `_copy` / `副本` 后缀再递增，避免 `foo_copy_copy`。
 */
export function allocateCopiedFormationIdentity(
  source: FormationDraft,
  existingIds: ReadonlySet<string>,
  existingNames: readonly string[],
): { id: string; name: string } {
  const names = new Set(existingNames);
  return {
    id: nextCopiedLabel(copyIdBase(source.id), '_copy', (n) => `_copy${n}`, (id) => existingIds.has(id)),
    name: nextCopiedLabel(
      copyNameBase(source.name),
      ' 副本',
      (n) => ` 副本${n}`,
      (name) => names.has(name),
    ),
  };
}

/** 去掉复制产生的 `_copy` / `_copy2` 后缀，得到可用于再分配的基 id。 */
function copyIdBase(id: string): string {
  return id.replace(/_copy\d*$/, '') || id;
}

/** 去掉复制产生的 `副本` / `副本2` 后缀，得到可用于再分配的基名称。 */
function copyNameBase(name: string): string {
  return name.replace(/ 副本\d*$/, '') || name;
}

/** 先试 `base+firstSuffix`，占用后再试 numbered(2)、numbered(3)… */
function nextCopiedLabel(
  base: string,
  firstSuffix: string,
  numbered: (n: number) => string,
  taken: (candidate: string) => boolean,
): string {
  const first = `${base}${firstSuffix}`;
  if (!taken(first)) return first;
  for (let n = 2; n < Number.MAX_SAFE_INTEGER; n++) {
    const candidate = `${base}${numbered(n)}`;
    if (!taken(candidate)) return candidate;
  }
  return first;
}

/** 深拷贝草稿，避免编辑表单直接改动运行时配置。 */
function cloneDrafts(source: CardFormationDrafts): CardFormationDrafts {
  const out = {} as CardFormationDrafts;
  for (const category of HAND_CATEGORY_ORDER) {
    out[category] = source[category].map(cloneFormationDraft);
  }
  return out;
}

/** 导出 compact 草稿（含哨兵），供卡组页编辑和写回 JSON。 */
export function dumpCardFormationDrafts(): CardFormationDrafts {
  return cloneDrafts(sourceDrafts);
}

/** 导出最近一次文件快照，供页面撤销未保存的编辑。 */
export function dumpDefaultCardFormationDrafts(): CardFormationDrafts {
  return cloneDrafts(defaultDrafts);
}

/** 校验牌面匹配规则；缺字段或非法 kind/ranks 时返回错误文案。 */
function validateMatchRule(id: string, match: FormationMatchRule | undefined): string | null {
  if (!match || typeof match !== 'object') return `阵型「${id}」缺少牌面匹配配置`;
  const allowedRanks = new Set<string>(FORMATION_MATCH_RANKS);
  switch (match.kind) {
    case 'any':
    case 'numbers':
      return null;
    case 'joker':
      if (match.joker !== 'black' && match.joker !== 'red') {
        return `阵型「${id}」王牌匹配必须是 black 或 red`;
      }
      return null;
    case 'ranks':
    case 'tripleRanks':
    case 'rankCount': {
      if (!Array.isArray(match.ranks) || match.ranks.length === 0) {
        return `阵型「${id}」点数匹配不能为空`;
      }
      const seen = new Set<string>();
      for (const rank of match.ranks) {
        if (!allowedRanks.has(rank)) return `阵型「${id}」包含未知点数「${String(rank)}」`;
        if (seen.has(rank)) return `阵型「${id}」点数「${rank}」重复`;
        seen.add(rank);
      }
      if (match.kind === 'rankCount') {
        return validateRankCountBounds(id, match.min, match.max);
      }
      return null;
    }
    default:
      return `阵型「${id}」牌面匹配类型无效`;
  }
}

/** 点数张数规则必须带合法下限或上限，且下限不能大于上限。 */
function validateRankCountBounds(id: string, min: number | undefined, max: number | undefined): string | null {
  if (min === undefined && max === undefined) {
    return `阵型「${id}」点数张数至少要设置下限或上限`;
  }
  if (min !== undefined && (!Number.isInteger(min) || min < 0)) {
    return `阵型「${id}」点数张数下限必须是不小于 0 的整数`;
  }
  if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
    return `阵型「${id}」点数张数上限必须是不小于 0 的整数`;
  }
  if (min !== undefined && max !== undefined && min > max) {
    return `阵型「${id}」点数张数下限不能大于上限`;
  }
  return null;
}

/** 校验引信炸弹伤害表与爆炸半径；未配置时跳过，非法键或负数拒绝。 */
function validateBombDamageFields(
  id: string,
  formation: Pick<FormationDraft, 'rankDamage' | 'damage' | 'aoeRadius'>,
): string | null {
  if (formation.damage !== undefined) {
    if (!Number.isFinite(formation.damage) || formation.damage < 0) {
      return `阵型「${id}」炸弹伤害必须是不小于 0 的数字`;
    }
  }
  if (formation.aoeRadius !== undefined) {
    if (!Number.isFinite(formation.aoeRadius) || formation.aoeRadius < 0) {
      return `阵型「${id}」爆炸半径必须是不小于 0 的数字`;
    }
  }
  if (formation.rankDamage === undefined) return null;
  if (!formation.rankDamage || typeof formation.rankDamage !== 'object' || Array.isArray(formation.rankDamage)) {
    return `阵型「${id}」点数伤害必须是对象`;
  }
  const allowedRanks = new Set<string>(FUSE_BOMB_DAMAGE_RANKS);
  for (const [rank, value] of Object.entries(formation.rankDamage)) {
    if (!allowedRanks.has(rank)) return `阵型「${id}」点数伤害包含未知档位「${rank}」`;
    if (!Number.isFinite(value) || (value as number) < 0) {
      return `阵型「${id}」档位「${rank}」伤害必须是不小于 0 的数字`;
    }
  }
  return null;
}

/** 在写入运行时前完整校验草稿，避免半套配置影响对局。 */
export function validateCardFormationDrafts(drafts: CardFormationDrafts): string | null {
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) return '配置必须是对象';
  const allowedTypes = new Set<string>(UNIT_TYPE_IDS);
  const ids = new Set<string>();
  const sentinelMatchKeys = new Set<string>();
  for (const category of HAND_CATEGORY_ORDER) {
    const formations = drafts[category];
    if (!Array.isArray(formations)) return `牌型「${HAND_CATEGORY_NAMES[category]}」缺少阵型列表`;
    for (const formation of formations) {
      if (!formation || typeof formation !== 'object') return `牌型「${HAND_CATEGORY_NAMES[category]}」存在无效阵型`;
      const id = formation.id?.trim();
      if (!id) return '阵型 ID 不能为空';
      if (ids.has(id)) return `阵型 ID「${id}」重复`;
      ids.add(id);
      if (!formation.name?.trim()) return `阵型「${id}」名称不能为空`;
      const matchError = validateMatchRule(id, formation.match);
      if (matchError) return matchError;
      if (formation.specialTier !== undefined && !isSpecialTier(formation.specialTier)) {
        return `阵型「${id}」档位映射必须是 2、3、4 或 5`;
      }
      if (isSpecialTierDraft(formation)) {
        const sentinelKey = `${category}:${matchRuleKey(formation.match)}`;
        if (sentinelMatchKeys.has(sentinelKey)) {
          return `牌型「${HAND_CATEGORY_NAMES[category]}」同一情况只能有一条档位映射`;
        }
        sentinelMatchKeys.add(sentinelKey);
        for (const typeId of listUnitsBySpecialTier(formation.specialTier)) {
          const expandedId = specialTierExpandedId(id, typeId);
          if (ids.has(expandedId)) return `阵型 ID「${expandedId}」重复`;
          ids.add(expandedId);
        }
      } else {
        if (!Array.isArray(formation.rows) || formation.rows.length === 0) {
          return `阵型「${id}」至少需要一排兵种`;
        }
        for (const row of formation.rows) {
          if (!Array.isArray(row) || row.length === 0) return `阵型「${id}」不能存在空排`;
          for (const typeId of row) {
            if (!allowedTypes.has(typeId)) return `阵型「${id}」包含未知兵种「${String(typeId)}」`;
          }
        }
        // 建筑只能单独成阵：恰好 1 个槽位且该槽是建筑，不可与兵种混编
        const buildingError = validateBuildingOnlyRows(formation.rows, id);
        if (buildingError) return buildingError;
        const fuseBombs = formation.rows.flat().filter(isFuseBombTypeId);
        if (fuseBombs.length > 0 && !isFuseBombFormation(formation)) {
          return `阵型「${id}」引信炸弹只能单独配置`;
        }
      }
      if (formation.colSpacing !== undefined && (!Number.isFinite(formation.colSpacing) || formation.colSpacing <= 0)) {
        return `阵型「${id}」横向间距必须大于 0`;
      }
      if (formation.rowSpacing !== undefined && (!Number.isFinite(formation.rowSpacing) || formation.rowSpacing <= 0)) {
        return `阵型「${id}」排间距必须大于 0`;
      }
      if (formation.thumbScale !== undefined && (!Number.isFinite(formation.thumbScale) || formation.thumbScale <= 0)) {
        return `阵型「${id}」阵型放大必须大于 0`;
      }
      const bombDamageError = validateBombDamageFields(id, formation);
      if (bombDamageError) return bombDamageError;
    }
  }
  return null;
}

/**
 * 建筑阵型约束：不含建筑则通过；含建筑则必须恰好一个建筑槽、无其它单位。
 * 供校验与编辑器复用。
 */
export function validateBuildingOnlyRows(
  rows: readonly (readonly UnitTypeId[])[],
  formationId = '',
): string | null {
  const flat = rows.flat();
  const buildingCount = flat.filter((typeId) => isBuildingConfig(UNIT_CONFIGS[typeId])).length;
  if (buildingCount === 0) return null;
  if (flat.length === 1 && buildingCount === 1) return null;
  const label = formationId ? `阵型「${formationId}」` : '该阵型';
  return `${label}若包含建筑，则只能配置单个建筑（不可与其它单位混编）`;
}

/** 阵型只含一种兵种时返回该兵种标签；混编或未配置则空串。 */
export function getExclusiveFormationUnitTag(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): string {
  const slots = formation.rows.flat();
  const typeId = slots[0];
  if (!typeId || slots.some((id) => id !== typeId)) return '';
  return UNIT_CONFIGS[typeId]?.tag.trim() ?? '';
}

/** 是否为合法的单建筑阵型（恰好一个建筑槽）。 */
export function isBuildingOnlyFormation(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): boolean {
  return validateBuildingOnlyRows(formation.rows) === null
    && formation.rows.flat().length === 1
    && isBuildingConfig(UNIT_CONFIGS[formation.rows.flat()[0]!]);
}

/** 单建筑阵型的建筑 typeId；非单建筑阵型返回 null。 */
export function getFormationBuildingTypeId(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): UnitTypeId | null {
  if (!isBuildingOnlyFormation(formation)) return null;
  return formation.rows.flat()[0]!;
}

/** 是否为投放用的引信炸弹兵种（巨型/小炸弹）。 */
export function isFuseBombTypeId(typeId: UnitTypeId): typeId is 'giant_bomb' | 'small_bomb' {
  return typeId === 'giant_bomb' || typeId === 'small_bomb';
}

/** 引信炸弹只能单独释放，走主堡抛物线投放，不生成常规单位。 */
export function isFuseBombFormation(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): boolean {
  const slots = formation.rows.flat();
  return slots.length === 1 && isFuseBombTypeId(slots[0]!);
}

/** 单槽引信炸弹阵型的兵种 id；非此类阵型返回 null。 */
export function getFuseBombTypeId(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): 'giant_bomb' | 'small_bomb' | null {
  if (!isFuseBombFormation(formation)) return null;
  return formation.rows.flat()[0] as 'giant_bomb' | 'small_bomb';
}

/** @deprecated 使用 isFuseBombFormation；仅判定巨型炸弹单槽阵型。 */
export function isGiantBombFormation(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): boolean {
  return getFuseBombTypeId(formation) === 'giant_bomb';
}

/** 校验通过后原地更新运行时阵型，使已引用 CARD_FORMATIONS 的 UI 即刻读到新数据。 */
export function applyCardFormationDrafts(drafts: CardFormationDrafts): void {
  const error = validateCardFormationDrafts(drafts);
  if (error) throw new Error(error);
  sourceDrafts = cloneDrafts(drafts);
  const next = formationsFromDrafts(sourceDrafts);
  for (const category of HAND_CATEGORY_ORDER) {
    CARD_FORMATIONS[category].splice(0, CARD_FORMATIONS[category].length, ...next[category]);
  }
}

/** 恢复到最近一次成功保存（或初始加载）的配置快照。 */
export function resetCardFormationsToDefault(): void {
  applyCardFormationDrafts(defaultDrafts);
}

/** 成功写回 JSON 后，把当前配置设为后续重置基准。 */
export function captureCardFormationsAsDefault(): void {
  defaultDrafts = dumpCardFormationDrafts();
}

/** 按 id 查找阵型；出牌指令展开与校验共用。 */
export function findFormationById(formationId: string): CardFormation | undefined {
  for (const category of HAND_CATEGORY_ORDER) {
    for (const formation of CARD_FORMATIONS[category]) {
      if (formation.id === formationId) return formation;
    }
  }
  return undefined;
}

/**
 * 按牌型强度顺序取命中牌型的搭配并集，并以 id 去重。
 * 同一搭配不会因多重牌型命中而重复出现。
 */
export function getFormationsFor(
  categories: readonly HandCategory[],
  cards?: readonly PlayingCard[],
): CardFormation[] {
  if (categories.length === 0) return [];
  // 实际出牌只允许使用命中牌型中最强的一种，避免同花顺同时展示五顺/同花方案。
  const wanted = new Set(cards ? categories.slice(0, 1) : categories);
  const seen = new Set<string>();
  const result: CardFormation[] = [];
  for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
    if (!wanted.has(category)) continue;
    for (const formation of CARD_FORMATIONS[category]) {
      if (seen.has(formation.id)) continue;
      const resolved = cards ? resolveCardFormation(formation, cards) : formation;
      if (!resolved) continue;
      seen.add(formation.id);
      result.push(resolved);
    }
  }
  return result;
}

/**
 * 图鉴反向索引：每种能出该兵种的牌型只取一组样例。
 * 优先用「只含该兵种」的阵型，避免混编样例误导。
 */
export function listHandExamplesForUnit(typeId: UnitTypeId): UnitHandExample[] {
  const examples: UnitHandExample[] = [];
  for (const category of HAND_CATEGORY_ORDER) {
    const matches = CARD_FORMATIONS[category].filter((formation) =>
      formation.units.some((unit) => unit.typeId === typeId),
    );
    if (matches.length === 0) continue;
    const preferred = matches.find((formation) => formation.units.length === 1) ?? matches[0]!;
    examples.push({
      category,
      name: HAND_CATEGORY_NAMES[category],
      cards: getPreviewCardsForFormation(category, preferred),
    });
  }
  return examples;
}

/**
 * 把阵型 rows 解成世界坐标落点。
 * 约定：row=0 朝向敌方；Blue 面向 +Y，Red 面向 -Y，左右随朝向镜像。
 * anchor 为阵型几何中心。
 */
export function resolveFormationSpawns(
  formation: CardFormation,
  faction: Faction,
  anchorX: number,
  anchorY: number,
): FormationSpawnPoint[] {
  const colSpacing = formation.colSpacing;
  const rowSpacing = formation.rowSpacing;
  const maxRow = Math.max(0, ...formation.slots.map((slot) => slot.row));
  // 前排在局部 +forward，后排递减；整阵以中心为锚点，避免整体偏前/偏后。
  const forwardCenter = (maxRow * rowSpacing) / 2;
  const facingForward = faction === Faction.Blue ? 1 : -1;
  const facingRight = faction === Faction.Blue ? 1 : -1;

  return formation.slots.map((slot) => {
    const rowWidth = formation.rows[slot.row]?.length ?? 1;
    const localRight = (slot.col - (rowWidth - 1) / 2) * colSpacing;
    const localForward = forwardCenter - slot.row * rowSpacing;
    return {
      typeId: slot.typeId,
      x: anchorX + facingRight * localRight,
      y: anchorY + facingForward * localForward,
      row: slot.row,
      col: slot.col,
    };
  });
}

/** 定点版落点解析，供直接喂给 spawnCommand。 */
export function resolveFormationSpawnsFx(
  formation: CardFormation,
  faction: Faction,
  anchorX: Fx,
  anchorY: Fx,
): Array<{ typeId: UnitTypeId; x: Fx; y: Fx; row: number; col: number }> {
  return resolveFormationSpawns(formation, faction, toFloat(anchorX), toFloat(anchorY)).map(
    (point) => ({
      typeId: point.typeId,
      x: fromFloat(point.x),
      y: fromFloat(point.y),
      row: point.row,
      col: point.col,
    }),
  );
}
