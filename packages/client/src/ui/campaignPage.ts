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

/** 战役选关页：卡通大地图，关卡沿蜿蜒小路自下而上排布，锁定关卡禁用，已通关显示完成标记。 */
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
    const lastUnlocked = unlocked.lastIndexOf(true);
    const { points, height } = layoutStageNodes(stages.length);

    const map = document.createElement('div');
    map.className = 'campaign-map';
    map.style.setProperty('--map-h', String(height));

    const buttons = stages.map((stage, index) =>
      createStageButton(stage, points[index]!, {
        unlocked: unlocked[index]!,
        cleared: cleared[index]!,
        current: index === currentIndex,
        boss: stages.length > 1 && index === stages.length - 1,
      }),
    );
    // 叠放顺序：河流 → 山体树木 → 小路 → 关卡节点
    map.append(
      createRiverSvg(height),
      createDecorations(points, height),
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
 * 沙土小路：从地图底边进入第 1 关，再依次连到最后一关。
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
    // 两层描边：深色路肩在下，沙土路面在上
    for (const layer of ['edge', 'surface']) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `campaign-road-${layer} is-${variant}`);
      svg.append(path);
    }
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

/**
 * 横穿地图的蜿蜒河流（纯装饰）：关卡多时每隔约 5 关一条，落在两关之间，避免压住城堡。
 * 两层描边：深色河岸在下，水面在上。
 */
function createRiverSvg(height: number): SVGSVGElement {
  const svg = createMapSvg('campaign-river', height);
  const rows = Math.max(1, Math.round((height - TOP_PADDING - BOTTOM_PADDING) / ROW_HEIGHT));
  for (let row = 2; row <= rows; row += 5) {
    // 第 row 关与 row+1 关之间的纵向中点（y 自底向上）
    const y = height - BOTTOM_PADDING - (row - 0.5) * ROW_HEIGHT;
    const d = `M -40 ${y + 30} C 140 ${y - 40} 260 ${y + 60} 380 ${y + 8} S 620 ${y - 50} 760 ${y + 20}`;
    for (const layer of ['bank', 'water']) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `campaign-river-${layer}`);
      svg.append(path);
    }
  }
  return svg;
}

/** 装饰物种类：山、松树丛、灌木。 */
type DecoKind = 'mountain' | 'pine' | 'bush';

/**
 * 在每关节点的空侧摆放山体与树木，顶部再加一排远山；
 * 用关卡序号做确定性伪随机，同一份数据每次打开地图都长得一样。
 */
function createDecorations(points: readonly MapPoint[], height: number): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'campaign-deco-layer';
  layer.setAttribute('aria-hidden', 'true');

  const add = (kind: DecoKind, x: number, y: number, scale: number): void => {
    const deco = document.createElement('span');
    deco.className = `campaign-deco is-${kind}`;
    deco.style.setProperty('--x', String(Math.round(x)));
    deco.style.setProperty('--y', String(Math.round(y)));
    deco.style.setProperty('--s', scale.toFixed(2));
    layer.append(deco);
  };

  // 顶部远山：横向铺满，压住地图上沿
  for (let i = 0; i < 5; i += 1) {
    add('mountain', 40 + i * 160, 250 - (i % 2) * 30, 1.3 - (i % 2) * 0.25);
  }

  points.forEach((point, index) => {
    const rand = (salt: number): number => pseudoRandom(index * 7 + salt);
    // 节点偏左就往右边摆，偏右就往左边摆，居中时两侧边缘各摆一点
    const sides = point.x < 340 ? [1] : point.x > 380 ? [-1] : [-1, 1];
    for (const side of sides) {
      // 贴着地图左右边缘摆，给中间的小路和木牌留出空地
      const edgeX = side > 0 ? 640 + rand(1) * 50 : 80 - rand(1) * 50;
      if (index % 3 === 1) {
        add('mountain', edgeX, point.y - 10 + rand(2) * 30, 0.75 + rand(3) * 0.3);
      } else {
        add('pine', edgeX, point.y - 20 + rand(2) * 30, 0.85 + rand(3) * 0.3);
        add('pine', edgeX - side * 40, point.y + 60 + rand(4) * 20, 0.7 + rand(5) * 0.25);
      }
      add('bush', edgeX - side * 30, point.y - 120 + rand(6) * 20, 0.6 + rand(7) * 0.3);
    }
  });

  // 底部入口两旁的树林
  add('pine', 80, height - 40, 1);
  add('pine', 640, height - 60, 1.1);
  add('bush', 560, height - 20, 0.9);
  return layer;
}

/** 0~1 的确定性伪随机，只用于装饰物错落摆放。 */
function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`战役页缺少元素：${selector}`);
  return element;
}
