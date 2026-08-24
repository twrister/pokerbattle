import { UNIT_CONFIGS, UNIT_TYPE_IDS, type UnitTypeId } from './units.js';
import rawSpecialTiers from './specialTiers.json';

/** 特殊兵种档位：2 最低，5 最高。 */
export const SPECIAL_TIERS = [2, 3, 4, 5] as const;
export type SpecialTier = (typeof SPECIAL_TIERS)[number];

/** 单兵种展开阵型参数；建筑仍强制 1 个。 */
export interface SpecialUnitFormationDraft {
  /** 每条展开阵型放几个该兵种；建筑仍强制 1 个。 */
  unitCount: number;
  colSpacing?: number;
  rowSpacing?: number;
  thumbScale?: number;
}

/** 单档可编辑草稿：名单顺序 + 每兵种独立阵型参数。 */
export interface SpecialTierDraft {
  units: UnitTypeId[];
  formations: Partial<Record<UnitTypeId, SpecialUnitFormationDraft>>;
}

/** 四档草稿集合。 */
export type SpecialTierDrafts = Record<SpecialTier, SpecialTierDraft>;

/**
 * 各档特殊兵种名单，顺序即卡组页 / 局内按钮展示序。
 * apply 时原地更新，避免图鉴与着色拿到旧数组引用。
 */
export const SPECIAL_UNITS_BY_TIER: Record<SpecialTier, UnitTypeId[]> = {
  2: [],
  3: [],
  4: [],
  5: [],
};

/** 图鉴/参数页与档位表共用；apply 时原地改内容。 */
export const SPECIAL_TYPE_IDS: Set<UnitTypeId> = new Set();

const UNIT_SPECIAL_TIER = new Map<UnitTypeId, SpecialTier>();

/** 哨兵展开后的阵型 id 分隔符：`${哨兵id}__${兵种}`。 */
export const SPECIAL_TIER_ID_SEP = '__';

/** 展开后按钮缩略图倍率；兵种未配 thumbScale 时回落这里。 */
export const SPECIAL_UNIT_THUMB_SCALE: Readonly<Partial<Record<UnitTypeId, number>>> = {
  dragon: 1.3,
  fire_dragon: 1.3,
  ranged_chariot: 1.7,
  melee_golem: 1.7,
};

/** 与 cardFormations 的 FORMATION_* 默认值对齐，避免 specialTiers 反向依赖阵型模块。 */
const DEFAULT_COL_SPACING = 1.2;
const DEFAULT_ROW_SPACING = 1.4;
const DEFAULT_THUMB_SCALE = 2;

const ALLOWED_UNIT_IDS = new Set<string>(UNIT_TYPE_IDS);

/** 新增兵种时的默认阵型；大模型优先用专用缩略图倍率。 */
export function createDefaultSpecialUnitFormation(typeId: UnitTypeId): SpecialUnitFormationDraft {
  return {
    unitCount: 1,
    colSpacing: DEFAULT_COL_SPACING,
    rowSpacing: DEFAULT_ROW_SPACING,
    thumbScale: SPECIAL_UNIT_THUMB_SCALE[typeId] ?? DEFAULT_THUMB_SCALE,
  };
}

/** 深拷贝单兵种阵型参数。 */
function cloneUnitFormation(source: SpecialUnitFormationDraft): SpecialUnitFormationDraft {
  return {
    unitCount: source.unitCount,
    ...(source.colSpacing === undefined ? {} : { colSpacing: source.colSpacing }),
    ...(source.rowSpacing === undefined ? {} : { rowSpacing: source.rowSpacing }),
    ...(source.thumbScale === undefined ? {} : { thumbScale: source.thumbScale }),
  };
}

/** 深拷贝单档草稿，避免编辑与运行时互相污染。 */
function cloneSpecialTierDraft(source: SpecialTierDraft): SpecialTierDraft {
  const formations: SpecialTierDraft['formations'] = {};
  for (const typeId of Object.keys(source.formations) as UnitTypeId[]) {
    const formation = source.formations[typeId];
    if (formation) formations[typeId] = cloneUnitFormation(formation);
  }
  return {
    units: [...source.units],
    formations,
  };
}

/** 深拷贝四档草稿。 */
function cloneSpecialTierDrafts(source: SpecialTierDrafts): SpecialTierDrafts {
  return {
    2: cloneSpecialTierDraft(source[2]),
    3: cloneSpecialTierDraft(source[3]),
    4: cloneSpecialTierDraft(source[4]),
    5: cloneSpecialTierDraft(source[5]),
  };
}

/** 把可选间距/放大校验成「未填或大于 0 的有限数」。 */
function validatePositiveOptional(id: string, label: string, value: number | undefined): string | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return `${id}${label}必须大于 0`;
  return null;
}

/** 写入运行时前完整校验档位表。 */
export function validateSpecialTierDrafts(drafts: SpecialTierDrafts): string | null {
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) return '档位表必须是对象';
  const seen = new Map<string, SpecialTier>();
  for (const tier of SPECIAL_TIERS) {
    const entry = drafts[tier];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return `档位表缺少 ${tier} 档`;
    }
    if (!Array.isArray(entry.units)) return `${tier} 档兵种名单必须是数组`;
    if (!entry.formations || typeof entry.formations !== 'object' || Array.isArray(entry.formations)) {
      return `${tier} 档阵型配置必须是对象`;
    }
    const inTier = new Set<string>();
    for (const typeId of entry.units) {
      if (!ALLOWED_UNIT_IDS.has(typeId)) return `${tier} 档包含未知兵种「${String(typeId)}」`;
      if (inTier.has(typeId)) return `${tier} 档兵种「${typeId}」重复`;
      const owner = seen.get(typeId);
      if (owner !== undefined) return `兵种「${typeId}」不能同时属于 ${owner} 档和 ${tier} 档`;
      inTier.add(typeId);
      seen.set(typeId, tier);
    }
  }
  // 名单齐了再查每兵种阵型，避免跨档重复被「缺配置」抢先报错。
  for (const tier of SPECIAL_TIERS) {
    const entry = drafts[tier];
    const inTier = new Set<string>(entry.units);
    for (const typeId of entry.units) {
      const formation = entry.formations[typeId];
      if (!formation || typeof formation !== 'object' || Array.isArray(formation)) {
        return `${tier} 档缺少兵种「${typeId}」的阵型配置`;
      }
      if (!Number.isInteger(formation.unitCount) || formation.unitCount < 1) {
        return `${tier} 档「${typeId}」每阵数量必须是不小于 1 的整数`;
      }
      const spacingError =
        validatePositiveOptional(`${tier} 档「${typeId}」`, '横向间距', formation.colSpacing)
        ?? validatePositiveOptional(`${tier} 档「${typeId}」`, '排间距', formation.rowSpacing)
        ?? validatePositiveOptional(`${tier} 档「${typeId}」`, '阵型放大', formation.thumbScale);
      if (spacingError) return spacingError;
    }
    for (const key of Object.keys(entry.formations)) {
      if (!inTier.has(key)) return `${tier} 档阵型配置包含未在名单中的兵种「${key}」`;
    }
  }
  return null;
}

/** 把校验通过的草稿同步到导出的名单与反查表。 */
function syncRuntimeTables(drafts: SpecialTierDrafts): void {
  UNIT_SPECIAL_TIER.clear();
  SPECIAL_TYPE_IDS.clear();
  for (const tier of SPECIAL_TIERS) {
    const units = drafts[tier].units;
    const target = SPECIAL_UNITS_BY_TIER[tier];
    target.splice(0, target.length, ...units);
    for (const typeId of units) {
      UNIT_SPECIAL_TIER.set(typeId, tier);
      SPECIAL_TYPE_IDS.add(typeId);
    }
  }
}

const loadedDrafts = parseLoadedDrafts(rawSpecialTiers);
let sourceDrafts: SpecialTierDrafts = cloneSpecialTierDrafts(loadedDrafts);
let defaultDrafts: SpecialTierDrafts = cloneSpecialTierDrafts(loadedDrafts);
syncRuntimeTables(sourceDrafts);

/** 解析 JSON 真源；非法配置在加载期直接抛，避免带着半套档位开跑。 */
function parseLoadedDrafts(raw: unknown): SpecialTierDrafts {
  const drafts = raw as SpecialTierDrafts;
  const error = validateSpecialTierDrafts(drafts);
  if (error) throw new Error(error);
  return cloneSpecialTierDrafts(drafts);
}

/** 是否为合法的特殊兵种档位。 */
export function isSpecialTier(value: unknown): value is SpecialTier {
  return value === 2 || value === 3 || value === 4 || value === 5;
}

/** 兵种所属档位；普通兵 / 英雄 / 炸弹没有档位。 */
export function getUnitSpecialTier(typeId: UnitTypeId): SpecialTier | undefined {
  return UNIT_SPECIAL_TIER.get(typeId);
}

/** 按展示顺序取出该档全部兵种。 */
export function listUnitsBySpecialTier(tier: SpecialTier): readonly UnitTypeId[] {
  return SPECIAL_UNITS_BY_TIER[tier];
}

/** 取出该档当前草稿副本，供页面编辑与名单读取。 */
export function getSpecialTierDraft(tier: SpecialTier): SpecialTierDraft {
  return cloneSpecialTierDraft(sourceDrafts[tier]);
}

/** 取出某兵种当前阵型参数副本，供哨兵展开与预览。 */
export function getSpecialUnitFormation(typeId: UnitTypeId): SpecialUnitFormationDraft | undefined {
  const tier = UNIT_SPECIAL_TIER.get(typeId);
  if (tier === undefined) return undefined;
  const formation = sourceDrafts[tier].formations[typeId];
  return formation ? cloneUnitFormation(formation) : undefined;
}

/** 卡组页哨兵列表文案，如「4档：双射手箭塔 / 飞龙 / 投弹车」。 */
export function formatSpecialTierLabel(tier: SpecialTier): string {
  const names = listUnitsBySpecialTier(tier).map((typeId) => UNIT_CONFIGS[typeId]?.name ?? typeId);
  return names.length > 0 ? `${tier}档：${names.join(' / ')}` : `${tier}档`;
}

/** 由哨兵 id 与兵种拼出展开后的运行时阵型 id。 */
export function specialTierExpandedId(sentinelId: string, typeId: UnitTypeId): string {
  return `${sentinelId}${SPECIAL_TIER_ID_SEP}${typeId}`;
}

/** 导出当前档位草稿，供档位表页编辑和写回 JSON。 */
export function dumpSpecialTierDrafts(): SpecialTierDrafts {
  return cloneSpecialTierDrafts(sourceDrafts);
}

/** 导出最近一次文件快照，供页面撤销未保存的编辑。 */
export function dumpDefaultSpecialTierDrafts(): SpecialTierDrafts {
  return cloneSpecialTierDrafts(defaultDrafts);
}

/** 校验通过后原地更新运行时档位表。 */
export function applySpecialTierDrafts(drafts: SpecialTierDrafts): void {
  const error = validateSpecialTierDrafts(drafts);
  if (error) throw new Error(error);
  sourceDrafts = cloneSpecialTierDrafts(drafts);
  syncRuntimeTables(sourceDrafts);
}

/** 恢复到最近一次成功保存（或初始加载）的档位快照。 */
export function resetSpecialTiersToDefault(): void {
  applySpecialTierDrafts(defaultDrafts);
}

/** 成功写回 JSON 后，把当前档位表设为后续重置基准。 */
export function captureSpecialTiersAsDefault(): void {
  defaultDrafts = dumpSpecialTierDrafts();
}
