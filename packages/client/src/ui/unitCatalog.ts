import {
  SPECIAL_TYPE_IDS,
  SPECIAL_UNITS_BY_TIER,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  getUnitSpecialTier,
  isBuildingConfig,
  type UnitTypeId,
} from '@pb/sim';

export type UnitCatalogCategory = 'single' | 'special' | 'other';

export interface UnitCatalogEntry {
  category: UnitCatalogCategory;
  typeId: UnitTypeId;
  name: string;
}

/** 其他：巨型/小炸弹、基地，以及召唤物。 */
const OTHER_TYPE_IDS = new Set<UnitTypeId>([
  'giant_bomb',
  'small_bomb',
  'building_base',
]);

/**
 * 图鉴/参数页展示顺序：单兵种按策划指定排列，其后是高级兵种（2→5 档）与其他。
 * 未列入的单位排在同分类末尾，避免新增兵种时被遗漏。
 */
const DISPLAY_ORDER: readonly UnitTypeId[] = [
  'melee_grunt',
  'ranged_archer',
  'melee_guard',
  'hero_queen',
  'hero_king',
  'melee_cavalry',
  'hero_mage',
  'hero_archmage',
  'melee_golem',
  'melee_golem_small',
  'ranged_chariot',
  'ranged_ballista',
  'melee_charge_wagon',
  'dragon',
  'fire_dragon',
  'building_tower',
  'building_tower_advanced',
  'building_tower_triple',
  'giant_bomb',
  'small_bomb',
  'building_base',
  'summoned_skeleton',
  'summoned_bomber',
];

/** 按图鉴页签归类：炸弹/基地/召唤物归其他；高级兵种走档位表 SPECIAL_TYPE_IDS。 */
export function getUnitCatalogCategory(typeId: UnitTypeId): UnitCatalogCategory {
  if (typeId.startsWith('summoned_') || OTHER_TYPE_IDS.has(typeId)) return 'other';
  if (SPECIAL_TYPE_IDS.has(typeId)) return 'special';
  return 'single';
}

const CATEGORY_ORDER: Record<UnitCatalogCategory, number> = {
  single: 0,
  special: 1,
  other: 2,
};

/** 图鉴排序键：优先用展示序，未知 ID 靠后且保持相对稳定。 */
function getDisplayOrder(typeId: UnitTypeId): number {
  const index = DISPLAY_ORDER.indexOf(typeId);
  return index === -1 ? DISPLAY_ORDER.length : index;
}

/**
 * 高级兵种按档位由低到高，同档沿用档位表名单顺序。
 * 档位表改动后图鉴自动跟上，避免再手改 DISPLAY_ORDER。
 */
function getSpecialSortKey(typeId: UnitTypeId): number {
  const tier = getUnitSpecialTier(typeId);
  if (tier === undefined) return Number.MAX_SAFE_INTEGER;
  const indexInTier = SPECIAL_UNITS_BY_TIER[tier].indexOf(typeId);
  return tier * 100 + (indexInTier === -1 ? 99 : indexInTier);
}

/** 分类优先，高级兵种再按档位由低到高，其余走展示序。 */
function compareCatalogEntries(a: UnitCatalogEntry, b: UnitCatalogEntry): number {
  const categoryDelta = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (categoryDelta !== 0) return categoryDelta;
  if (a.category === 'special') return getSpecialSortKey(a.typeId) - getSpecialSortKey(b.typeId);
  return getDisplayOrder(a.typeId) - getDisplayOrder(b.typeId);
}

/** 将模拟层配置转为可展示条目；建筑默认排除，高级/其他列表中的基地/防御塔例外。 */
export function getUnitCatalogEntries(): UnitCatalogEntry[] {
  return UNIT_TYPE_IDS.filter((typeId) => {
    if (SPECIAL_TYPE_IDS.has(typeId) || OTHER_TYPE_IDS.has(typeId)) return true;
    return !isBuildingConfig(UNIT_CONFIGS[typeId]);
  })
    .map((typeId) => ({
      typeId,
      name: UNIT_CONFIGS[typeId].name,
      category: getUnitCatalogCategory(typeId),
    }))
    .sort(compareCatalogEntries);
}

/** 删除名称中的括号标签，避免卡片与详情重复展示类别或技能。 */
export function displayUnitName(name: string): string {
  return name.replace(/（.*?）/g, '');
}
