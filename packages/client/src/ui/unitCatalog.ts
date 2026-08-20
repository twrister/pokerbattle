import {
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  isBuildingConfig,
  type UnitTypeId,
} from '@pb/sim';

export type UnitCatalogCategory = 'single' | 'special' | 'summoned';

export interface UnitCatalogEntry {
  category: UnitCatalogCategory;
  typeId: UnitTypeId;
  name: string;
}

/** 特殊兵种：战车、连弩车、巨型/小炸弹、巨龙、基地、防御塔。 */
const SPECIAL_TYPE_IDS = new Set<UnitTypeId>([
  'ranged_chariot',
  'ranged_ballista',
  'giant_bomb',
  'small_bomb',
  'dragon',
  'building_base',
  'building_tower',
  'building_tower_advanced',
  'building_tower_triple',
]);

/**
 * 图鉴/参数页展示顺序：单兵种按策划指定排列，其后是特殊兵种与召唤物。
 * 未列入的单位排在同分类末尾，避免新增兵种时被遗漏。
 */
const DISPLAY_ORDER: readonly UnitTypeId[] = [
  'melee_grunt',
  'ranged_archer',
  'melee_guard',
  'melee_golem',
  'hero_queen',
  'hero_king',
  'melee_cavalry',
  'hero_mage',
  'hero_archmage',
  'ranged_chariot',
  'ranged_ballista',
  'giant_bomb',
  'small_bomb',
  'dragon',
  'building_base',
  'building_tower',
  'building_tower_advanced',
  'building_tower_triple',
  'summoned_skeleton',
  'summoned_bomber',
];

/** 按图鉴页签归类：召唤物看前缀，战车/连弩车/巨龙/基地/防御塔归特殊，其余可移动单位归单兵种。 */
export function getUnitCatalogCategory(typeId: UnitTypeId): UnitCatalogCategory {
  if (typeId.startsWith('summoned_')) return 'summoned';
  if (SPECIAL_TYPE_IDS.has(typeId)) return 'special';
  return 'single';
}

/** 图鉴排序键：优先用展示序，未知 ID 靠后且保持相对稳定。 */
function getDisplayOrder(typeId: UnitTypeId): number {
  const index = DISPLAY_ORDER.indexOf(typeId);
  return index === -1 ? DISPLAY_ORDER.length : index;
}

/** 将模拟层配置转为可展示条目；建筑默认排除，特殊列表中的基地/防御塔例外。 */
export function getUnitCatalogEntries(): UnitCatalogEntry[] {
  return UNIT_TYPE_IDS.filter((typeId) => {
    if (SPECIAL_TYPE_IDS.has(typeId)) return true;
    return !isBuildingConfig(UNIT_CONFIGS[typeId]);
  })
    .map((typeId) => ({
      typeId,
      name: UNIT_CONFIGS[typeId].name,
      category: getUnitCatalogCategory(typeId),
    }))
    .sort((a, b) => getDisplayOrder(a.typeId) - getDisplayOrder(b.typeId));
}

/** 删除名称中的括号标签，避免卡片与详情重复展示类别或技能。 */
export function displayUnitName(name: string): string {
  return name.replace(/（.*?）/g, '');
}
