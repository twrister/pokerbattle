import {
  TICK_RATE,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  isBuildingConfig,
  toFloat,
  type UnitConfig,
  type UnitTypeId,
} from '@pb/sim';
import { SPRITE_DEFS } from '../view/unitSprites.js';

type CodexCategory = 'regular' | 'hero' | 'summoned';
type CodexFilter = 'all' | CodexCategory;

interface CodexUnit {
  category: CodexCategory;
  config: UnitConfig;
  typeId: UnitTypeId;
}

type StatKey = 'hp' | 'damage' | 'attackSpeed' | 'range' | 'moveSpeed';

export interface CodexPageOptions {
  onBack: () => void;
}

export interface CodexPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

const CATEGORY_NAMES: Record<CodexFilter, string> = {
  all: '全部兵种',
  regular: '常规兵种',
  hero: '英雄',
  summoned: '召唤物',
};

const STAT_NAMES: Record<StatKey, string> = {
  hp: '生命',
  damage: '伤害',
  attackSpeed: '攻速',
  range: '攻击距离',
  moveSpeed: '移速',
};

/** 以单位 ID 的固定前缀归类，避免依赖展示名称中的括号文本。 */
function getCategory(typeId: UnitTypeId): CodexCategory {
  if (typeId.startsWith('hero_')) return 'hero';
  if (typeId.startsWith('summoned_')) return 'summoned';
  return 'regular';
}

/** 将模拟层配置转为图鉴可展示条目，并排除不可移动的建筑。 */
function getCodexUnits(): CodexUnit[] {
  return UNIT_TYPE_IDS.filter((typeId) => !isBuildingConfig(UNIT_CONFIGS[typeId])).map((typeId) => ({
    typeId,
    config: UNIT_CONFIGS[typeId],
    category: getCategory(typeId),
  }));
}

/** 图鉴页：用兵种配置和现有立绘生成可筛选的只读单位档案。 */
export function createCodexPage(options: CodexPageOptions): CodexPageHandle {
  const root = required<HTMLElement>('#codex');
  const backButton = required<HTMLButtonElement>('#btn-codex-back', root);
  const categoryList = required<HTMLElement>('#codex-category-list', root);
  const unitList = required<HTMLElement>('#codex-unit-list', root);
  const detail = required<HTMLElement>('#codex-detail', root);
  const units = getCodexUnits();
  const statMaxima = getStatMaxima(units);
  let category: CodexFilter = 'all';
  let selectedTypeId = units[0]?.typeId;

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);

  /** 根据当前分类和选中兵种重新渲染整页内容。 */
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

  /** 渲染当前分类的兵种立绘卡片。 */
  function renderUnits(visibleUnits: readonly CodexUnit[]): void {
    unitList.replaceChildren(
      ...visibleUnits.map((unit) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'codex-unit-card';
        const selected = unit.typeId === selectedTypeId;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', `查看${displayName(unit.config.name)}档案`);
        const sprite = SPRITE_DEFS[unit.typeId];
        if (sprite) {
          const image = document.createElement('img');
          image.className = 'codex-unit-art';
          image.src = sprite.frontUrl;
          image.alt = '';
          button.appendChild(image);
        }
        const name = document.createElement('span');
        name.className = 'codex-unit-name';
        name.textContent = displayName(unit.config.name);
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
  function renderDetail(unit: CodexUnit | undefined, maxima: Record<StatKey, number>): void {
    detail.replaceChildren();
    if (!unit) return;

    const { config, typeId } = unit;
    const sprite = SPRITE_DEFS[typeId];
    const header = document.createElement('header');
    header.className = 'codex-detail-header';
    if (sprite) {
      const image = document.createElement('img');
      image.className = 'codex-detail-art';
      image.src = sprite.frontUrl;
      image.alt = '';
      header.appendChild(image);
    }
    const title = document.createElement('div');
    const categoryLabel = document.createElement('p');
    categoryLabel.className = 'codex-detail-category';
    categoryLabel.textContent = CATEGORY_NAMES[unit.category];
    const heading = document.createElement('h2');
    heading.textContent = displayName(config.name);
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
    detail.append(header, summary, stats, skillBlock);
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
    },
  };
}

/** 删除名称中的括号标签，避免卡片与详情重复展示类别或技能。 */
function displayName(name: string): string {
  return name.replace(/（.*?）/g, '');
}

/** 提供适合详情标题下方的简短战斗定位。 */
function getSummary(config: UnitConfig): string {
  const range = toFloat(config.range);
  if (config.movementLayer === 'air') return '空中单位，可越过地面部队进行范围打击。';
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

/** 从所有可展示兵种取每项属性的最大值，保证进度条横向可比较。 */
function getStatMaxima(units: readonly CodexUnit[]): Record<StatKey, number> {
  const maxima: Record<StatKey, number> = {
    hp: 0,
    damage: 0,
    attackSpeed: 0,
    range: 0,
    moveSpeed: 0,
  };
  for (const unit of units) {
    for (const [key, value] of getStats(unit.config)) {
      maxima[key] = Math.max(maxima[key], value);
    }
  }
  return maxima;
}

/** 依据配置中的技能块生成图鉴特性文案。 */
function getSkill(config: UnitConfig): { title: string; description: string } {
  if (config.charge) return { title: '冲锋', description: '与目标保持合适距离时发动突击，对路径上的敌人造成伤害并击退。' };
  if (config.inspire) return { title: '振奋', description: '提升附近友军的攻击速度与移动速度。' };
  if (config.heal) return { title: '治疗', description: '周期性治疗范围内受伤的友军。' };
  if (config.summon) {
    return {
      title: '召唤',
      description: `周期性召唤${displayName(UNIT_CONFIGS[config.summon.unitTypeId].name)}加入战斗。`,
    };
  }
  if (config.detonate) return { title: '自爆', description: '接近目标后点燃引信，对范围内敌人造成爆炸伤害。' };
  if (config.attack.kind === 'projectile_aoe') return { title: '范围攻击', description: '弹道命中后会对落点附近敌人造成范围伤害。' };
  if (config.attack.kind === 'melee_aoe') return { title: '横扫', description: '每次近战攻击都会伤害攻击范围内的多个敌人。' };
  return { title: '常规攻击', description: '持续攻击当前目标，适合编入阵型参与正面交战。' };
}

/** 取必需的页面节点，保证页面结构变更能尽早暴露。 */
function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`图鉴页缺少元素：${selector}`);
  return element;
}
