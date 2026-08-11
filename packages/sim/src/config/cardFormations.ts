import { type Fx, fromFloat, toFloat } from '../math/fixed.js';
import { Faction } from '../entity/unit.js';
import { UNIT_CONFIGS, UNIT_TYPE_IDS, isBuildingConfig, type UnitTypeId } from './units.js';
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
  count: number;
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

/** 一条「牌型 → 兵种搭配」配置，含可配置前后站位。 */
export interface CardFormation {
  id: string;
  name: string;
  category: HandCategory;
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
  rows: UnitTypeId[][];
  colSpacing?: number;
  rowSpacing?: number;
  /** 按钮缩略图放大；缺省 FORMATION_THUMB_SCALE。 */
  thumbScale?: number;
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
  const order: UnitTypeId[] = [];
  for (const slot of slots) {
    if (!counts.has(slot.typeId)) order.push(slot.typeId);
    counts.set(slot.typeId, (counts.get(slot.typeId) ?? 0) + 1);
  }
  return order.map((typeId) => ({ typeId, count: counts.get(typeId)! }));
}

/** 解析阵型按钮放大倍率；非法或未配置时回落默认。 */
function resolveThumbScale(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : FORMATION_THUMB_SCALE;
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
  };
}

/** 从 JSON 初始化的运行时阵型；顶层对象与各牌型数组在应用草稿时保持引用稳定。 */
export const CARD_FORMATIONS: Record<HandCategory, CardFormation[]> = formationsFromDrafts(
  rawCardFormations as CardFormationDrafts,
);
let defaultDrafts: CardFormationDrafts = dumpCardFormationDrafts();

/** 深拷贝草稿，避免编辑表单直接改动运行时配置。 */
function cloneDrafts(source: CardFormationDrafts): CardFormationDrafts {
  const out = {} as CardFormationDrafts;
  for (const category of HAND_CATEGORY_ORDER) {
    out[category] = source[category].map((entry) => ({
      id: entry.id,
      name: entry.name,
      rows: entry.rows.map((row) => [...row]),
      ...(entry.colSpacing === undefined ? {} : { colSpacing: entry.colSpacing }),
      ...(entry.rowSpacing === undefined ? {} : { rowSpacing: entry.rowSpacing }),
      ...(entry.thumbScale === undefined ? {} : { thumbScale: entry.thumbScale }),
    }));
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
      rows: formation.rows.map((row) => [...row]),
      colSpacing: formation.colSpacing,
      rowSpacing: formation.rowSpacing,
      thumbScale: formation.thumbScale,
    }));
  }
  return out;
}

/** 导出最近一次文件快照，供页面撤销未保存的编辑。 */
export function dumpDefaultCardFormationDrafts(): CardFormationDrafts {
  return cloneDrafts(defaultDrafts);
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
      if (formation.colSpacing !== undefined && (!Number.isFinite(formation.colSpacing) || formation.colSpacing <= 0)) {
        return `阵型「${id}」横向间距必须大于 0`;
      }
      if (formation.rowSpacing !== undefined && (!Number.isFinite(formation.rowSpacing) || formation.rowSpacing <= 0)) {
        return `阵型「${id}」排间距必须大于 0`;
      }
      if (formation.thumbScale !== undefined && (!Number.isFinite(formation.thumbScale) || formation.thumbScale <= 0)) {
        return `阵型「${id}」阵型放大必须大于 0`;
      }
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
export function getFormationsFor(categories: readonly HandCategory[]): CardFormation[] {
  if (categories.length === 0) return [];
  const wanted = new Set(categories);
  const seen = new Set<string>();
  const result: CardFormation[] = [];
  for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
    if (!wanted.has(category)) continue;
    for (const formation of CARD_FORMATIONS[category]) {
      if (seen.has(formation.id)) continue;
      seen.add(formation.id);
      result.push(formation);
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
