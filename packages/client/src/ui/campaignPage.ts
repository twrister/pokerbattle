import { CAMPAIGN_ARENA_PRESETS, type StageDef } from '@pb/sim';
import { isStageUnlocked, type CampaignProgress } from '../campaign/progress.js';
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
/** 相邻关卡的纵向间距。 */
const ROW_HEIGHT = 220;
/** 最上面一关之上留给悬浮标题栏与山脉装饰的高度。 */
const TOP_PADDING = 300;
/** 第 1 关之下留给木牌与入口小路的高度。 */
const BOTTOM_PADDING = 190;
/** 节点横坐标按序号循环，走出左中右的「之」字路线。 */
const ZIGZAG_X = [200, 360, 520, 360] as const;

export interface MapPoint {
  x: number;
  y: number;
}

export interface StageNodeLayout {
  /** 每关节点（城堡底座）在地图上的坐标，下标与关卡顺序一致。 */
  points: MapPoint[];
  /** 地图总高（设计单位）。 */
  height: number;
}

/**
 * 计算关卡节点在地图上的位置：第 1 关在最底部，往上每关固定行距，
 * 横向在左中右之间摆动。y 以地图顶边为 0 向下增长。
 */
export function layoutStageNodes(count: number): StageNodeLayout {
  const height = TOP_PADDING + Math.max(0, count - 1) * ROW_HEIGHT + BOTTOM_PADDING;
  const points = Array.from({ length: count }, (_, index) => ({
    x: ZIGZAG_X[index % ZIGZAG_X.length]!,
    y: height - BOTTOM_PADDING - index * ROW_HEIGHT,
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 战役选关页：扁平地图，关卡沿蜿蜒小路自下而上排布，锁定关卡禁用，已通关显示完成标记。 */
export function createCampaignPage(options: CampaignPageOptions): CampaignPageHandle {
  const root = required<HTMLElement>('#campaign');
  const backButton = required<HTMLButtonElement>('#btn-campaign-back', root);
  const list = required<HTMLElement>('#campaign-list', root);
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
    const { points, height } = layoutStageNodes(nodeCount);

    const map = document.createElement('div');
    map.className = 'campaign-map';
    map.style.setProperty('--map-h', String(height));

    const buttons = stages.map((stage, index) =>
      createStageButton(stage, points[index]!, {
        unlocked: unlocked[index]!,
        cleared: cleared[index]!,
        current: index === currentIndex,
        // 有无限防守节点时，大城堡留给它
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

  /** 把节点滚动到列表可视区竖直居中。 */
  const centerOn = (element: HTMLElement): void => {
    const listRect = list.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const offset = rect.top + rect.height / 2 - listRect.top;
    list.scrollTop = list.scrollTop + offset - list.clientHeight / 2;
  };

  /** 单个关卡节点：城堡贴图 + 木牌（序号 + 标题 + 地图名）+ 完成徽章；锁定时禁用点击。 */
  const createStageButton = (
    stage: StageDef,
    point: MapPoint,
    state: { unlocked: boolean; cleared: boolean; current: boolean; boss: boolean },
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'campaign-stage';
    button.disabled = !state.unlocked;
    button.dataset.stageId = stage.id;
    button.classList.toggle('is-cleared', state.cleared);
    button.classList.toggle('is-current', state.current);
    button.classList.toggle('is-locked', !state.unlocked);
    button.classList.toggle('is-boss', state.boss);
    button.setAttribute('role', 'listitem');
    button.style.setProperty('--x', String(point.x));
    button.style.setProperty('--y', String(point.y));

    // 普通关用箭塔，最后一关用主堡当「大城堡」，与局内建筑风格一致
    const castle = document.createElement('img');
    castle.className = 'campaign-stage-castle';
    castle.src = state.boss ? 'buildings/base_red.png' : 'buildings/tower_red.png';
    castle.alt = '';
    castle.draggable = false;
    castle.setAttribute('aria-hidden', 'true');

    const plate = document.createElement('span');
    plate.className = 'campaign-stage-plate';

    const index = document.createElement('span');
    index.className = 'campaign-stage-index';
    index.textContent = state.unlocked ? String(stage.index) : '锁';

    const title = document.createElement('span');
    title.className = 'campaign-stage-title';
    title.textContent = stage.title;
    if (stage.arena) {
      const arena = document.createElement('span');
      arena.className = 'campaign-stage-arena';
      arena.textContent = CAMPAIGN_ARENA_PRESETS[stage.arena].name;
      title.append(arena);
    }
    plate.append(index, title);

    // 文字供读屏使用，视觉上由 CSS 渲染成对勾徽章
    const status = document.createElement('span');
    status.className = 'campaign-stage-status';
    status.textContent = state.cleared ? '✓ 已完成' : '';

    button.append(castle, plate, status);
    button.addEventListener('click', () => options.onStartStage(stage.id));
    return button;
  };

  /** 无限防守节点：复用关卡节点样式的大城堡，木牌写最佳波数；没有 stageId。 */
  const createEndlessButton = (
    entry: CampaignEndlessEntry,
    point: MapPoint,
    unlocked: boolean,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'campaign-stage campaign-endless is-boss';
    button.disabled = !unlocked;
    button.classList.toggle('is-locked', !unlocked);
    button.setAttribute('role', 'listitem');
    button.style.setProperty('--x', String(point.x));
    button.style.setProperty('--y', String(point.y));

    const castle = document.createElement('img');
    castle.className = 'campaign-stage-castle';
    castle.src = 'buildings/base.png';
    castle.alt = '';
    castle.draggable = false;
    castle.setAttribute('aria-hidden', 'true');

    const plate = document.createElement('span');
    plate.className = 'campaign-stage-plate';
    const index = document.createElement('span');
    index.className = 'campaign-stage-index';
    index.textContent = unlocked ? '∞' : '锁';
    const title = document.createElement('span');
    title.className = 'campaign-stage-title';
    title.textContent = '无限防守';
    const best = entry.getBestWave();
    const sub = document.createElement('span');
    sub.className = 'campaign-stage-arena';
    sub.textContent = best ? `最佳 ${best} 波` : '守住一波又一波';
    title.append(sub);
    plate.append(index, title);

    button.append(castle, plate);
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
      backButton.removeEventListener('click', options.onBack);
    },
  };
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

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`战役页缺少元素：${selector}`);
  return element;
}
