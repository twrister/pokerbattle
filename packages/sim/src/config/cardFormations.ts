import { type Fx, fromFloat, toFloat } from '../math/fixed.js';
import type { CardRank, PlayingCard } from '../cards/deck.js';
import { Faction } from '../entity/unit.js';
import { UNIT_CONFIGS, UNIT_TYPE_IDS, isBuildingConfig, type UnitTypeId } from './units.js';
import {
  FORMATION_MATCH_RANKS,
  FUSE_BOMB_DAMAGE_RANKS,
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
  | 'straight4'
  | 'two_pair'
  | 'full_house'
  | 'straight5'
  | 'flush'
  | 'straight_flush';

/** 卡组页选项顺序：单张在上，同花顺在下。 */
export const HAND_CATEGORY_ORDER: readonly HandCategory[] = [
  'single',
  'pair',
  'straight3',
  'triple',
  'straight4',
  'two_pair',
  'straight5',
  'flush',
  'full_house',
  'rocket',
  'bomb',
  'straight_flush',
] as const;

/** 牌型强度降序：同花顺最强，单张最弱；出牌比对与阵型并集按此顺序。 */
export const HAND_CATEGORY_STRENGTH_ORDER: readonly HandCategory[] = [
  'straight_flush',
  'bomb',
  'rocket',
  'full_house',
  'flush',
  'straight5',
  'straight4',
  'two_pair',
  'triple',
  'straight3',
  'pair',
  'single',
] as const;

/** 牌型中文名，供 UI 与调试展示。 */
export const HAND_CATEGORY_NAMES: Readonly<Record<HandCategory, string>> = {
  single: '单张',
  pair: '对子',
  rocket: '王炸',
  triple: '三张',
  straight3: '三顺',
  bomb: '炸弹',
  straight4: '四顺',
  two_pair: '连对',
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
  level: number;
  count: number;
}

/**
 * 阵型中的一个落位点。
 * row=0 为最前排（朝向敌方），col 为该排内从左到右的下标。
 */
export interface FormationSlot {
  typeId: UnitTypeId;
  level: number;
  row: number;
  col: number;
}

/** 牌面匹配：决定哪些点数可使用该兵种搭配。 */
export type FormationMatchRule =
  | { kind: 'any' }
  | { kind: 'numbers' }
  | { kind: 'ranks'; ranks: CardRank[] }
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
}

/** 解析后的世界坐标出生点（浮点格坐标，出兵前再 fromFloat）。 */
export interface FormationSpawnPoint {
  typeId: UnitTypeId;
  level: number;
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
  /** 引信炸弹按点数覆盖伤害；缺档回落单位配置。 */
  rankDamage?: Partial<Record<FuseBombDamageRank, number>>;
  /** 火箭等无点数炸弹的固定伤害；缺省回落单位配置。 */
  damage?: number;
}

/** 所有牌型下的阵型草稿集合。 */
export type CardFormationDrafts = Record<HandCategory, FormationDraft[]>;

/** 把 rows 展成带行列下标的 slots。 */
function slotsFromRows(rows: readonly (readonly UnitTypeId[])[]): FormationSlot[] {
  const slots: FormationSlot[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((typeId, colIndex) => {
      slots.push({ typeId, level: 1, row: rowIndex, col: colIndex });
    });
  });
  return slots;
}

/** 按出现顺序汇总各兵种数量。 */
function unitsFromSlots(slots: readonly FormationSlot[]): FormationUnitEntry[] {
  const counts = new Map<string, number>();
  const order: FormationUnitEntry[] = [];
  for (const slot of slots) {
    const key = `${slot.typeId}:${slot.level}`;
    if (!counts.has(key)) order.push({ typeId: slot.typeId, level: slot.level, count: 0 });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((entry) => ({ ...entry, count: counts.get(`${entry.typeId}:${entry.level}`)! }));
}

/** 解析阵型按钮放大倍率；非法或未配置时回落默认。 */
function resolveThumbScale(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : FORMATION_THUMB_SCALE;
}

/** 深拷贝牌面匹配规则，避免编辑草稿互相污染。 */
function cloneMatchRule(match: FormationMatchRule): FormationMatchRule {
  if (match.kind === 'ranks') return { kind: 'ranks', ranks: [...match.ranks] };
  if (match.kind === 'joker') return { kind: 'joker', joker: match.joker };
  return { kind: match.kind };
}

/** 拷贝引信炸弹伤害字段；缺省不写入，避免普通阵型带上空对象。 */
function cloneBombDamageFields(
  source: Pick<FormationDraft, 'rankDamage' | 'damage'>,
): Pick<FormationDraft, 'rankDamage' | 'damage'> {
  const out: Pick<FormationDraft, 'rankDamage' | 'damage'> = {};
  if (source.rankDamage !== undefined) out.rankDamage = { ...source.rankDamage };
  if (source.damage !== undefined) out.damage = source.damage;
  return out;
}

/** 从 JSON 加载并回填 category / slots / units。 */
function formationsFromDrafts(drafts: CardFormationDrafts): Record<HandCategory, CardFormation[]> {
  const out = {} as Record<HandCategory, CardFormation[]>;
  for (const category of HAND_CATEGORY_ORDER) {
    const entries = drafts[category] ?? [];
    out[category] = entries.map((entry) => {
      const rows = entry.rows.map((row) => [...row]);
      const slots = slotsFromRows(rows);
      return {
        id: entry.id,
        name: entry.name,
        category,
        match: cloneMatchRule(entry.match),
        rows,
        slots,
        units: unitsFromSlots(slots),
        colSpacing:
          Number.isFinite(entry.colSpacing) && (entry.colSpacing as number) > 0
            ? (entry.colSpacing as number)
            : FORMATION_COL_SPACING,
        rowSpacing:
          Number.isFinite(entry.rowSpacing) && (entry.rowSpacing as number) > 0
            ? (entry.rowSpacing as number)
            : FORMATION_ROW_SPACING,
        thumbScale: resolveThumbScale(entry.thumbScale),
        ...cloneBombDamageFields(entry),
      };
    });
  }
  return out;
}

/** 将单条草稿派生成预览可用的阵型，不会写入运行时配置。 */
export function createCardFormation(category: HandCategory, draft: FormationDraft): CardFormation {
  const rows = draft.rows.map((row) => [...row]);
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
    row.map((unit, col) => ({ typeId: unit.typeId, level: unit.level, row: rowIndex, col })),
  );
  return { ...source, rows, slots, units: unitsFromSlots(slots) };
}

/** 从 JSON 初始化的运行时阵型；顶层对象与各牌型数组在应用草稿时保持引用稳定。 */
export const CARD_FORMATIONS: Record<HandCategory, CardFormation[]> = formationsFromDrafts(
  rawCardFormations as CardFormationDrafts,
);
let defaultDrafts: CardFormationDrafts = dumpCardFormationDrafts();

/** 深拷贝单条草稿，避免复制/编辑时源与副本互相污染。 */
export function cloneFormationDraft(source: FormationDraft): FormationDraft {
  return {
    id: source.id,
    name: source.name,
    match: cloneMatchRule(source.match),
    rows: source.rows.map((row) => [...row]),
    ...(source.colSpacing === undefined ? {} : { colSpacing: source.colSpacing }),
    ...(source.rowSpacing === undefined ? {} : { rowSpacing: source.rowSpacing }),
    ...(source.thumbScale === undefined ? {} : { thumbScale: source.thumbScale }),
    ...cloneBombDamageFields(source),
  };
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

/** 将运行时阵型导出为可安全编辑和写入 JSON 的草稿。 */
export function dumpCardFormationDrafts(): CardFormationDrafts {
  const out = {} as CardFormationDrafts;
  for (const category of HAND_CATEGORY_ORDER) {
    out[category] = CARD_FORMATIONS[category].map((formation) => ({
      id: formation.id,
      name: formation.name,
      match: cloneMatchRule(formation.match),
      rows: formation.rows.map((row) => [...row]),
      colSpacing: formation.colSpacing,
      rowSpacing: formation.rowSpacing,
      thumbScale: formation.thumbScale,
      ...cloneBombDamageFields(formation),
    }));
  }
  return out;
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
    case 'ranks': {
      if (!Array.isArray(match.ranks) || match.ranks.length === 0) {
        return `阵型「${id}」点数匹配不能为空`;
      }
      const seen = new Set<string>();
      for (const rank of match.ranks) {
        if (!allowedRanks.has(rank)) return `阵型「${id}」包含未知点数「${String(rank)}」`;
        if (seen.has(rank)) return `阵型「${id}」点数「${rank}」重复`;
        seen.add(rank);
      }
      return null;
    }
    default:
      return `阵型「${id}」牌面匹配类型无效`;
  }
}

/** 校验引信炸弹伤害表；未配置时跳过，非法键或负数拒绝。 */
function validateBombDamageFields(
  id: string,
  formation: Pick<FormationDraft, 'rankDamage' | 'damage'>,
): string | null {
  if (formation.damage !== undefined) {
    if (!Number.isFinite(formation.damage) || formation.damage < 0) {
      return `阵型「${id}」炸弹伤害必须是不小于 0 的数字`;
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
  const next = formationsFromDrafts(cloneDrafts(drafts));
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
      level: slot.level,
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
): Array<{ typeId: UnitTypeId; level: number; x: Fx; y: Fx; row: number; col: number }> {
  return resolveFormationSpawns(formation, faction, toFloat(anchorX), toFloat(anchorY)).map(
    (point) => ({
      typeId: point.typeId,
      level: point.level,
      x: fromFloat(point.x),
      y: fromFloat(point.y),
      row: point.row,
      col: point.col,
    }),
  );
}
