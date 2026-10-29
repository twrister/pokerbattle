import { CAMPAIGN_ARENA_PRESETS, describeStageObjective, type StageDef, type StageObjective } from '@pb/sim';
import {
  countCampaignStars,
  isStageUnlocked,
  totalCampaignStars,
  type CampaignProgress,
} from '../campaign/progress.js';
import { enableDragScroll } from './dragScroll.js';

export interface CampaignPageOptions {
  onBack: () => void;
  /** 玩家点了已解锁的关卡。 */
  onStartStage: (stageId: string) => void;
  /** 按战役顺序给出全部关卡。 */
  getStages: () => readonly StageDef[];
  getProgress: () => CampaignProgress;
  /** 是否忽略进度解锁全部关卡；开发服开启，便于直接验证任意关卡。 */
  unlockAllStages?: boolean;
  /** 无限防守入口；提供时在最后一关之后追加一个节点，最后一关通关后解锁。 */
  endless?: CampaignEndlessEntry;
}

/** 战役地图末尾的无限防守节点。 */
export interface CampaignEndlessEntry {
  /** 历史最佳波数；没有记录为 null。 */
  getBestWave: () => number | null;
  onStart: () => void;
}

export interface CampaignPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 地图坐标统一用 720 设计宽单位，与 CSS 的 --hu 对齐。 */
export const CAMPAIGN_MAP_WIDTH = 720;
/** 关卡节点只占左右两列，卡片放在节点的另一侧，中间留给小路。 */
const NODE_X_LEFT = 190;
const NODE_X_RIGHT = 530;
/** 相邻关卡的默认纵向间距；按视口自适应时作为上限。 */
const ROW_HEIGHT = 200;
/** 自适应行距的下限：相邻两行的信息卡横向有交叠，行距不能小于卡片高度。 */
export const MIN_ROW_HEIGHT = 110;
/** 最上面一关之上留白，刚好让出悬浮标题栏。 */
const TOP_PADDING = 150;
/** 第 1 关之下留白，露出入口小路。 */
const BOTTOM_PADDING = 70;
/** 卡片最多显示几条目标，多出的用「+N」概括。 */
const GOAL_TEXT_LIMIT = 2;

export interface MapPoint {
  x: number;
  y: number;
}

export interface StageNodeLayout {
  /** 每关节点在地图上的坐标，下标与关卡顺序一致。 */
  points: MapPoint[];
  /** 地图总高（设计单位）。 */
  height: number;
}

/**
 * 计算关卡节点在地图上的位置：第 1 关在最底部，往上每关固定行距，
 * 横向在左右两列之间摆动。y 以地图顶边为 0 向下增长。
 * @param fitHeight 可视高度（设计单位）；传入时压缩行距让全部关卡一屏放下，
 *   行距夹在 [MIN_ROW_HEIGHT, ROW_HEIGHT]，关卡过多放不下时退回滚动
 */
export function layoutStageNodes(count: number, fitHeight?: number): StageNodeLayout {
  const gaps = Math.max(0, count - 1);
  const rowHeight = fitHeight !== undefined && gaps > 0
    ? clamp((fitHeight - TOP_PADDING - BOTTOM_PADDING) / gaps, MIN_ROW_HEIGHT, ROW_HEIGHT)
    : ROW_HEIGHT;
  const content = TOP_PADDING + gaps * rowHeight + BOTTOM_PADDING;
  // 关卡少、行距已到上限时，地图仍铺满视口，节点贴底
  const height = fitHeight !== undefined ? Math.max(content, fitHeight) : content;
  const points = Array.from({ length: count }, (_, index) => ({
    x: index % 2 === 0 ? NODE_X_LEFT : NODE_X_RIGHT,
    y: height - BOTTOM_PADDING - index * rowHeight,
  }));
  return { points, height };
}

/**
 * 把一串点连成平滑小路：相邻两点之间用三次贝塞尔曲线，
 * 控制点沿竖直方向拉出半个行距，让道路在节点处竖直进出、中间弯折。
 * @returns SVG path 的 d 属性；少于两个点时返回空串
 */
export function buildRoadPath(points: readonly MapPoint[]): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  const commands = [`M ${first!.x} ${first!.y}`];
  let prev = first!;
  for (const point of rest) {
    const bend = (prev.y - point.y) / 2;
    commands.push(`C ${prev.x} ${prev.y - bend} ${point.x} ${point.y + bend} ${point.x} ${point.y}`);
    prev = point;
  }
  return commands.join(' ');
}

/** 限制类目标（会不会扣分），排在通关条件之后，读者先看到「要做什么」。 */
const CONSTRAINT_KINDS: ReadonlySet<StageObjective['kind']> = new Set([
  'max_plays',
  'forbid_category',
  'base_hp_above',
]);

/**
 * 关卡目标摘要：先把通关条件、再排限制条件，最多两行，其余用「+N」概括。
 * 文案与局内目标面板同源，关卡改目标时两处一起变。
 */
export function campaignStageGoalText(objectives: readonly StageObjective[]): string {
  const goals = objectives.filter((objective) => !CONSTRAINT_KINDS.has(objective.kind));
  const constraints = objectives.filter((objective) => CONSTRAINT_KINDS.has(objective.kind));
  const texts = [...goals, ...constraints].map(describeStageObjective);
  if (texts.length <= GOAL_TEXT_LIMIT) return texts.join(' · ');
  return `${texts.slice(0, GOAL_TEXT_LIMIT).join(' · ')} +${texts.length - GOAL_TEXT_LIMIT}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 战役选关页：与大厅同一套扁平风，关卡节点沿蜿蜒小路自下而上排布，锁定时禁用点击。 */
export function createCampaignPage(options: CampaignPageOptions): CampaignPageHandle {
  const root = required<HTMLElement>('#campaign');
  const backButton = required<HTMLButtonElement>('#btn-campaign-back', root);
  const list = required<HTMLElement>('#campaign-list', root);
  const starsEl = required<HTMLElement>('#campaign-stars', root);
  // 地图隐藏了滚动条，按住拖动即可上下浏览；拖拽收尾的误触 click 会被吞掉
  const disposeDragScroll = enableDragScroll(list);
  let scrollFrame = 0;

  /** 某关是否可点：开发服全解锁，正式服按进度逐关推进。 */
  const isUnlocked = (progress: CampaignProgress, orderedIds: readonly string[], stageId: string): boolean =>
    options.unlockAllStages === true || isStageUnlocked(progress, orderedIds, stageId);

  /** 重新读取进度并渲染整张地图。 */
  const render = (): void => {
    const stages = options.getStages();
    const progress = options.getProgress();
    const orderedIds = stages.map((stage) => stage.id);
    const unlocked = stages.map((stage) => isUnlocked(progress, orderedIds, stage.id));
    const cleared = stages.map((stage) => Boolean(progress.stages[stage.id]));
    // 当前关：第一个已解锁但未通关的关卡；全部通关则没有
    const currentIndex = stages.findIndex((_, index) => unlocked[index] && !cleared[index]);
    const endless = options.endless;
    // 无限防守跟在最后一关后面：最后一关通关（或开发服全解锁）才开放
    const endlessUnlocked = Boolean(endless)
      && (options.unlockAllStages === true || (cleared.length > 0 && cleared[cleared.length - 1] === true));
    const nodeCount = stages.length + (endless ? 1 : 0);
    const lastUnlocked = endlessUnlocked ? stages.length : unlocked.lastIndexOf(true);
    const { points, height } = layoutStageNodes(nodeCount, fitHeight());
    // 标题只显示星星总数：关卡首通星 + 无限防守守住波数
    renderStars(
      totalCampaignStars(
        countCampaignStars(progress, orderedIds),
        endless?.getBestWave() ?? null,
      ),
    );

    const map = document.createElement('div');
    map.className = 'campaign-map';
    map.style.setProperty('--map-h', String(height));

    const buttons = stages.map((stage, index) =>
      createStageButton(stage, points[index]!, {
        unlocked: unlocked[index]!,
        cleared: cleared[index]!,
        current: index === currentIndex,
        // 有无限防守节点时，大号终点节点留给它
        boss: !endless && stages.length > 1 && index === stages.length - 1,
      }),
    );
    if (endless) buttons.push(createEndlessButton(endless, points[stages.length]!, endlessUnlocked));
    // 叠放顺序：小路 → 关卡节点
    map.append(
      createRoadSvg(points, height, lastUnlocked),
      ...buttons,
    );
    list.replaceChildren(map);

    // 打开时把当前关（没有则最后一个已解锁关）滚到视口中间
    const focus = buttons[currentIndex >= 0 ? currentIndex : Math.max(0, lastUnlocked)];
    if (focus) {
      centerOn(focus);
      // 首帧布局可能尚未稳定（字体/贴图），下一帧再校正一次
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => centerOn(focus));
    }
  };

  /** 列表可视高度换算成 720 设计单位；尚未布局（宽为 0）时返回 undefined，退回固定行距。 */
  const fitHeight = (): number | undefined => {
    const width = list.clientWidth;
    if (width <= 0 || list.clientHeight <= 0) return undefined;
    return list.clientHeight / (width / CAMPAIGN_MAP_WIDTH);
  };

  /** 标题栏星数胶囊：只显示总星数（关卡星 + 无限防守星）。 */
  const renderStars = (total: number): void => {
    starsEl.textContent = `★ ${total}`;
    starsEl.setAttribute('aria-label', `共获得 ${total} 颗星`);
  };

  /** 视口尺寸变化时按新高度重排，保证仍然一屏放下。 */
  const onResize = (): void => {
    if (!root.classList.contains('is-hidden')) render();
  };
  window.addEventListener('resize', onResize);

  /** 把节点滚动到列表可视区竖直居中。 */
  const centerOn = (element: HTMLElement): void => {
    const listRect = list.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const offset = rect.top + rect.height / 2 - listRect.top;
    list.scrollTop = list.scrollTop + offset - list.clientHeight / 2;
  };

  /** 卡片朝向：节点在左半区时卡片挂到右边，反之挂左边，避免压住小路与对侧节点。 */
  const cardSide = (point: MapPoint): 'left' | 'right' => (point.x < CAMPAIGN_MAP_WIDTH / 2 ? 'right' : 'left');

  /** 单关节点：圆形序号徽章钉在小路上，奶油信息卡写标题、地图/限时与目标。 */
  const createStageButton = (
    stage: StageDef,
    point: MapPoint,
    state: { unlocked: boolean; cleared: boolean; current: boolean; boss: boolean },
  ): HTMLButtonElement => {
    const button = createStageButtonShell(point, cardSide(point));
    button.disabled = !state.unlocked;
    button.dataset.stageId = stage.id;
    button.classList.toggle('is-cleared', state.cleared);
    button.classList.toggle('is-current', state.current);
    button.classList.toggle('is-locked', !state.unlocked);
    button.classList.toggle('is-boss', state.boss);

    button.append(createNode(state.unlocked ? String(stage.index) : '锁'));

    const plate = createPlate(stage.title);
    // 地图名跟着关卡走；限时只在关卡单独指定时显示，默认时长不占版面
    if (stage.arena) plate.meta.append(createPill(CAMPAIGN_ARENA_PRESETS[stage.arena].name));
    if (stage.durationSeconds) plate.meta.append(createPill(`限时 ${stage.durationSeconds} 秒`));
    plate.root.append(plate.meta, createGoal(campaignStageGoalText(stage.objectives)));
    button.append(plate.root);

    // 星星徽章：已通关为金星，已解锁未通关为灰色空星预告，锁定关不显示
    if (state.cleared) button.append(createStar(true));
    else if (state.unlocked) button.append(createStar(false));

    button.addEventListener('click', () => options.onStartStage(stage.id));
    return button;
  };

  /** 无限防守节点：复用关卡节点样式的大号终点节点，卡片写最佳波数；没有 stageId。 */
  const createEndlessButton = (
    entry: CampaignEndlessEntry,
    point: MapPoint,
    unlocked: boolean,
  ): HTMLButtonElement => {
    const button = createStageButtonShell(point, cardSide(point));
    button.disabled = !unlocked;
    button.classList.add('campaign-endless', 'is-boss');
    button.classList.toggle('is-locked', !unlocked);

    button.append(createNode(unlocked ? '∞' : '锁'));

    const plate = createPlate('无限防守');
    const best = entry.getBestWave();
    plate.meta.append(createPill(best ? `最佳 ${best} 波` : '一波接一波'));
    plate.root.append(plate.meta, createGoal('撑过每一波进攻，直到防线崩溃'));
    button.append(plate.root);

    button.addEventListener('click', () => entry.onStart());
    return button;
  };

  backButton.addEventListener('click', options.onBack);

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
      cancelAnimationFrame(scrollFrame);
      disposeDragScroll();
      window.removeEventListener('resize', onResize);
      backButton.removeEventListener('click', options.onBack);
    },
  };
}

/** 节点按钮外壳：定位到 (--x, --y)，并声明卡片挂哪一侧。 */
function createStageButtonShell(point: MapPoint, side: 'left' | 'right'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'campaign-stage';
  button.dataset.card = side;
  button.setAttribute('role', 'listitem');
  button.style.setProperty('--x', String(point.x));
  button.style.setProperty('--y', String(point.y));
  return button;
}

/** 圆形序号徽章；锁定关文案为「锁」，视觉上由 CSS 画成锁形。 */
function createNode(label: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = 'campaign-stage-index';
  node.textContent = label;
  return node;
}

/** 奶油信息卡：标题在上，标签与目标依次排下去。 */
function createPlate(title: string): {
  root: HTMLSpanElement;
  meta: HTMLSpanElement;
} {
  const root = document.createElement('span');
  root.className = 'campaign-stage-plate';

  const titleEl = document.createElement('span');
  titleEl.className = 'campaign-stage-title';
  titleEl.textContent = title;

  const meta = document.createElement('span');
  meta.className = 'campaign-stage-meta';

  root.append(titleEl);
  return { root, meta };
}

/** 卡片上的小圆角标签：地图名、限时、最佳波数。 */
function createPill(text: string): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.className = 'campaign-stage-arena';
  pill.textContent = text;
  return pill;
}

/** 卡片上的目标摘要，最多两行，超出由 CSS 省略。 */
function createGoal(text: string): HTMLSpanElement {
  const goal = document.createElement('span');
  goal.className = 'campaign-stage-goal';
  goal.textContent = text;
  return goal;
}

/** 星星徽章：钉在节点右上角，earned 为金星，否则为灰色空星；读屏文案说明是否已得星。 */
function createStar(earned: boolean): HTMLSpanElement {
  const star = document.createElement('span');
  star.className = 'campaign-stage-star';
  star.classList.toggle('is-earned', earned);
  star.textContent = '★';
  star.setAttribute('aria-label', earned ? '已获得 1 星' : '通关可得 1 星');
  return star;
}

/**
 * 路径：从地图底边进入第 1 关，再依次连到最后一关。
 * 拆成「已解锁段」（到最后一个已解锁关为止）和「锁定段」两组，分别着色。
 */
function createRoadSvg(points: readonly MapPoint[], height: number, lastUnlocked: number): SVGSVGElement {
  const svg = createMapSvg('campaign-road', height);
  if (points.length === 0) return svg;

  // 入口：从地图底边竖直接到第 1 关
  const entry = { x: points[0]!.x, y: height + 40 };
  const route = [entry, ...points];
  // route 比 points 多一个入口点，已解锁段包含入口到 lastUnlocked 关
  const splitAt = Math.max(0, lastUnlocked) + 1;
  const unlockedRoute = route.slice(0, splitAt + 1);
  const lockedRoute = route.slice(splitAt);

  const addRoad = (pointsOnRoad: readonly MapPoint[], variant: 'open' | 'locked'): void => {
    const d = buildRoadPath(pointsOnRoad);
    if (!d) return;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `campaign-road-surface is-${variant}`);
    svg.append(path);
  };
  addRoad(lockedRoute, 'locked');
  addRoad(unlockedRoute, 'open');
  return svg;
}

/** 与地图等大的 SVG 画布：viewBox 用 720 设计宽，铺满后与按 --x/--y 定位的节点天然对齐。 */
function createMapSvg(className: string, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${CAMPAIGN_MAP_WIDTH} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** 把数值夹到 [min, max]。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`战役页缺少元素：${selector}`);
  return element;
}
