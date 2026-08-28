import {
  TICK_RATE,
  TOWER_HP_DECAY_PER_SECOND,
  UNIT_CONFIGS,
  getUnitConfig,
  getUnitSpecialTier,
  isArcherTowerId,
  listDeathSpawnEntries,
  listHandExamplesForUnit,
  toFloat,
  type UnitConfig,
  type UnitTypeId,
} from '@pb/sim';
import { cardImageUrl } from '../cards/cardImageUrl.js';
import { SPRITE_DEFS } from '../view/unitSprites.js';
import {
  displayUnitName,
  getUnitCatalogEntries,
  type UnitCatalogCategory,
  type UnitCatalogEntry,
} from './unitCatalog.js';

type CodexFilter = 'all' | UnitCatalogCategory;

type StatKey = 'hp' | 'damage' | 'attackSpeed' | 'range' | 'moveSpeed';

export interface CodexPageOptions {
  onBack: () => void;
  /** 开发服：打开单位参数对比/编辑页。 */
  onOpenUnitStats?: () => void;
  /** 开发服：打开场景参数配置页。 */
  onOpenSceneConfig?: () => void;
}

export interface CodexPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

const CATEGORY_NAMES: Record<CodexFilter, string> = {
  all: '全部兵种',
  single: '单兵种',
  special: '高级兵种',
  other: '其他',
};

const STAT_NAMES: Record<StatKey, string> = {
  hp: '生命',
  damage: '伤害',
  attackSpeed: '攻速',
  range: '攻击距离',
  moveSpeed: '移速',
};

/** 图鉴页：用兵种配置和现有立绘生成可筛选的只读单位档案。 */
export function createCodexPage(options: CodexPageOptions): CodexPageHandle {
  const root = required<HTMLElement>('#codex');
  const backButton = required<HTMLButtonElement>('#btn-codex-back', root);
  const unitStatsButton = root.querySelector<HTMLButtonElement>('#btn-codex-unit-stats');
  const sceneConfigButton = root.querySelector<HTMLButtonElement>('#btn-codex-scene-config');
  const categoryList = required<HTMLElement>('#codex-category-list', root);
  const unitList = required<HTMLElement>('#codex-unit-list', root);
  const detail = required<HTMLElement>('#codex-detail', root);
  const units = getUnitCatalogEntries();
  const statMaxima = getStatMaxima(units);
  let category: CodexFilter = 'all';
  let selectedTypeId = units[0]?.typeId;

  const back = (): void => options.onBack();
  const openUnitStats = (): void => options.onOpenUnitStats?.();
  const openSceneConfig = (): void => options.onOpenSceneConfig?.();
  backButton.addEventListener('click', back);
  unitStatsButton?.addEventListener('click', openUnitStats);
  sceneConfigButton?.addEventListener('click', openSceneConfig);

  /** 根据当前分类与选中兵种重新渲染整页内容。 */
  function render(): void {
    const visibleUnits = units.filter((unit) => category === 'all' || unit.category === category);
    if (!visibleUnits.some((unit) => unit.typeId === selectedTypeId)) {
      selectedTypeId = visibleUnits[0]?.typeId;
    }
    renderCategories();
    renderUnits(visibleUnits);
    renderDetail(units.find((unit) => unit.typeId === selectedTypeId), statMaxima);
  }

  /** 渲染全部与分类页签，并同步当前筛选的无障碍选中状态。 */
  function renderCategories(): void {
    categoryList.replaceChildren(
      ...Object.entries(CATEGORY_NAMES).map(([id, name]) => {
        const categoryId = id as CodexFilter;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'codex-category';
        button.textContent = name;
        button.classList.toggle('is-active', categoryId === category);
        button.setAttribute('aria-pressed', String(categoryId === category));
        button.addEventListener('click', () => {
          category = categoryId;
          render();
        });
        return button;
      }),
    );
  }

  /** 渲染当前分类的左侧兵种列表。 */
  function renderUnits(visibleUnits: readonly UnitCatalogEntry[]): void {
    unitList.replaceChildren(
      ...visibleUnits.map((unit) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = codexUnitCardClassName(unit.typeId);
        const selected = unit.typeId === selectedTypeId;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', `查看${displayUnitName(unit.name)}档案`);
        const thumbScale = LIST_THUMB_SCALE[unit.typeId];
        if (thumbScale !== undefined) {
          button.dataset.thumbScale = String(thumbScale);
          button.style.setProperty('--thumb-scale', String(thumbScale));
        }
        const portrait = createCodexPortrait(unit.typeId, 'codex-unit-art');
        if (portrait) button.appendChild(portrait);
        const name = document.createElement('span');
        name.className = 'codex-unit-name';
        name.textContent = displayUnitName(unit.name);
        button.appendChild(name);
        button.addEventListener('click', () => {
          selectedTypeId = unit.typeId;
          render();
        });
        return button;
      }),
    );
  }

  /** 渲染选中兵种的属性进度、攻击方式与技能说明。 */
  function renderDetail(
    unit: UnitCatalogEntry | undefined,
    maxima: Record<StatKey, number>,
  ): void {
    detail.replaceChildren();
    if (!unit) return;

    const { typeId } = unit;
    const config = getUnitConfig(typeId);
    const header = document.createElement('header');
    header.className = 'codex-detail-header';
    const portrait = createCodexPortrait(typeId, 'codex-detail-art');
    if (portrait) header.appendChild(portrait);
    const title = document.createElement('div');
    const categoryLabel = document.createElement('p');
    categoryLabel.className = 'codex-detail-category';
    categoryLabel.textContent = CATEGORY_NAMES[unit.category];
    const heading = document.createElement('h2');
    heading.textContent = displayUnitName(unit.name);
    title.append(categoryLabel, heading);
    header.appendChild(title);

    const summary = document.createElement('p');
    summary.className = 'codex-detail-summary';
    summary.textContent = getSummary(config);

    const stats = document.createElement('dl');
    stats.className = 'codex-stats';
    for (const [key, value] of getStats(config)) {
      const term = document.createElement('dt');
      term.textContent = STAT_NAMES[key];
      const definition = document.createElement('dd');
      const bar = document.createElement('div');
      bar.className = 'codex-stat-bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', STAT_NAMES[key]);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(maxima[key]));
      bar.setAttribute('aria-valuenow', String(value));
      const fill = document.createElement('span');
      fill.style.width = `${(value / maxima[key]) * 100}%`;
      bar.appendChild(fill);
      definition.appendChild(bar);
      stats.append(term, definition);
    }

    const skill = getSkill(config);
    const skillBlock = document.createElement('section');
    skillBlock.className = 'codex-skill';
    const skillLabel = document.createElement('span');
    skillLabel.textContent = '特性';
    const skillTitle = document.createElement('strong');
    skillTitle.textContent = skill.title;
    const skillDescription = document.createElement('p');
    skillDescription.textContent = skill.description;
    skillBlock.append(skillLabel, skillTitle, skillDescription);
    detail.append(header, summary, stats, skillBlock, createHandsSection(typeId));
  }

  render();
  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      render();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      backButton.removeEventListener('click', back);
      unitStatsButton?.removeEventListener('click', openUnitStats);
      sceneConfigButton?.removeEventListener('click', openSceneConfig);
    },
  };
}

/** 2～5 档兵种铺档位色底，与卡组/局内按钮一致。 */
function codexUnitCardClassName(typeId: UnitTypeId): string {
  const tier = getUnitSpecialTier(typeId);
  return tier ? `codex-unit-card is-tier-${tier}` : 'codex-unit-card';
}

/** 左侧列表里体量偏大的兵种单独缩小，详情立绘保持原尺寸。 */
const LIST_THUMB_SCALE: Partial<Record<UnitTypeId, number>> = {
  melee_golem_small: 0.7,
  ranged_ballista: 0.7,
  small_bomb: 0.55,
};

/** 塔顶弓手数：与局内 garrison 一致，仅影响图鉴立绘。 */
function towerGarrisonCount(typeId: UnitTypeId): number {
  if (typeId === 'building_tower_triple') return 3;
  if (typeId === 'building_tower_advanced') return 2;
  return isArcherTowerId(typeId) ? 1 : 0;
}

/** 弓手槽位：1 居中、2 左右、3 前 1 后 2。 */
function towerGarrisonSlots(count: number): readonly string[] {
  if (count === 1) return ['center'];
  if (count === 2) return ['left', 'right'];
  return ['back-left', 'back-right', 'front'];
}

/** 图鉴立绘：箭塔叠弓手，其余用正面贴图。 */
function createCodexPortrait(typeId: UnitTypeId, className: string): HTMLElement | null {
  const sprite = SPRITE_DEFS[typeId];
  if (!sprite) return null;
  const garrison = towerGarrisonCount(typeId);
  if (garrison === 0) {
    const image = document.createElement('img');
    image.className = className;
    image.src = sprite.frontUrl;
    image.alt = '';
    return image;
  }
  const portrait = document.createElement('div');
  portrait.className = `codex-portrait is-tower ${className}`;
  portrait.dataset.garrison = String(garrison);
  const tower = document.createElement('img');
  tower.className = 'codex-portrait-tower';
  tower.src = sprite.frontUrl;
  tower.alt = '';
  portrait.appendChild(tower);
  const archerUrl = SPRITE_DEFS.ranged_archer?.frontUrl ?? 'units/archer-front.png';
  for (const slot of towerGarrisonSlots(garrison)) {
    const archer = document.createElement('img');
    archer.className = 'codex-portrait-archer';
    archer.dataset.slot = slot;
    archer.src = archerUrl;
    archer.alt = '';
    portrait.appendChild(archer);
  }
  return portrait;
}

/** 特性下方列出该兵种能凑出的牌型，每种牌型一组样例牌。 */
function createHandsSection(typeId: UnitTypeId): HTMLElement {
  const examples = listHandExamplesForUnit(typeId);
  const section = document.createElement('section');
  section.className = 'codex-hands';
  const label = document.createElement('span');
  label.textContent = '可组成牌型';
  section.appendChild(label);
  if (examples.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'codex-hands-empty';
    empty.textContent = '无法通过出牌获得';
    section.appendChild(empty);
    return section;
  }
  for (const example of examples) {
    const row = document.createElement('div');
    row.className = 'codex-hand';
    row.dataset.category = example.category;
    const name = document.createElement('strong');
    name.className = 'codex-hand-name';
    name.textContent = example.name;
    const cards = document.createElement('div');
    cards.className = 'codex-hand-cards';
    for (const card of example.cards) {
      const image = document.createElement('img');
      image.className = 'codex-hand-card';
      image.src = cardImageUrl(card);
      image.alt = card.label;
      cards.appendChild(image);
    }
    row.append(name, cards);
    section.appendChild(row);
  }
  return section;
}

/** 提供适合详情标题下方的简短战斗定位。 */
function getSummary(config: UnitConfig): string {
  const range = toFloat(config.range);
  if (isArcherTowerId(config.id)) return '固定防御建筑，优先攻击空中单位，部署后会持续损耗生命。';
  if (config.movementLayer === 'air') return '空中单位，可越过地面部队进行范围打击。';
  if (config.preferBuildings || config.targetsBuildingsOnly) {
    return config.preferBuildings
      ? '攻城单位，优先攻击建筑，无敌方建筑时再打最近敌人。'
      : '攻城单位，只攻击建筑，适合切开防线直取塔与城堡。';
  }
  if (config.charge) return '重装突击单位，能在合适距离发动冲锋。';
  if (range >= 4) return '远程支援单位，适合在队伍后方持续输出。';
  return '地面作战单位，适合承担前线交战任务。';
}

/** 读取用于比较的五项属性；数值仅用于计算进度，不渲染到页面。 */
function getStats(config: UnitConfig): Array<[StatKey, number]> {
  return [
    ['hp', toFloat(config.maxHp)],
    ['damage', toFloat(config.damage)],
    ['attackSpeed', TICK_RATE / toFloat(config.attackInterval)],
    ['range', toFloat(config.range)],
    ['moveSpeed', toFloat(config.moveSpeed)],
  ];
}

/** 从所有可展示兵种取每项属性最大值，保证进度条横向可比较。 */
function getStatMaxima(units: readonly UnitCatalogEntry[]): Record<StatKey, number> {
  const maxima: Record<StatKey, number> = {
    hp: 0,
    damage: 0,
    attackSpeed: 0,
    range: 0,
    moveSpeed: 0,
  };
  for (const unit of units) {
    for (const [key, value] of getStats(getUnitConfig(unit.typeId))) {
      maxima[key] = Math.max(maxima[key], value);
    }
  }
  return maxima;
}

/** 把阵亡生成条目拼成「5 个民兵、2 个弓箭手」。 */
function formatDeathSpawnText(config: UnitConfig): string {
  if (!config.deathSpawn) return '';
  return listDeathSpawnEntries(config.deathSpawn)
    .map((entry) => `${entry.count} 个${displayUnitName(UNIT_CONFIGS[entry.unitTypeId].name)}`)
    .join('、');
}

/** 依据配置中的技能块生成图鉴特性文案。 */
function getSkill(config: UnitConfig): { title: string; description: string } {
  if (config.charge) return { title: '冲锋', description: '与可移动敌人保持合适距离时发动突击，对路径上的单位造成伤害并击退，不对建筑生效。' };
  if (config.inspire) return { title: '振奋', description: '提升自身与附近友军的攻击速度与移动速度，多名国王可叠加。' };
  if (config.heal) return { title: '治疗', description: '优先治疗场上受伤的友军，不治疗机械单位；无伤员时跟随最近友军，射程内有敌人才攻击。' };
  if (config.summon) {
    return {
      title: '召唤',
      description: `周期性召唤${displayUnitName(UNIT_CONFIGS[config.summon.unitTypeId].name)}加入战斗。`,
    };
  }
  if (config.detonate) return { title: '自爆', description: '接近目标后点燃引信，对范围内敌人造成爆炸伤害。' };
  if (config.preferBuildings || config.targetsBuildingsOnly || config.deathSpawn) {
    const spawnText = formatDeathSpawnText(config);
    const siegeText = config.preferBuildings
      ? '优先攻击建筑；无敌方建筑时攻击最近敌人'
      : '只攻击建筑单位';
    return {
      title: '攻城',
      description: spawnText ? `${siegeText}；阵亡后在原地派出 ${spawnText}。` : `${siegeText}。`,
    };
  }
  if (isArcherTowerId(config.id)) {
    return {
      title: '对空优先',
      description: `优先攻击空中单位；射程内没有空中目标时再打地面。部署后每秒自动损失 ${TOWER_HP_DECAY_PER_SECOND} 点生命，生命耗尽后倒塌。`,
    };
  }
  if (config.preferAir) {
    return { title: '对空优先', description: '优先攻击空中单位；射程内没有空中目标时再打地面。' };
  }
  if (config.attack.kind === 'projectile_aoe') {
    return {
      title: '范围攻击',
      description: config.canAttackAir
        ? '弹道命中后会对落点附近敌人造成范围伤害。'
        : '弹道命中后会对落点附近地面敌人造成范围伤害，无法攻击空中单位。',
    };
  }
  if (config.attack.kind === 'melee_aoe') return { title: '横扫', description: '每次近战攻击都会伤害攻击范围内的多个敌人。' };
  return { title: '常规攻击', description: '持续攻击当前目标，适合编入阵型参与正面交战。' };
}

/** 取必需的页面节点，保证页面结构变更能尽早暴露。 */
function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`图鉴页缺少元素：${selector}`);
  return element;
}
