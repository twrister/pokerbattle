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

/** 地图上的一个关卡坐标，单位为 720 设计宽（与 --hu 对齐）。 */
export interface MapPoint {
  x: number;
  y: number;
}

/** 地图设计宽，与舞台 720 设计宽一致，SVG viewBox 与节点坐标共用。 */
export const MAP_WIDTH = 720;
/** 相邻关卡的纵向间距。 */
const ROW_GAP = 230;
/** 地图顶部留白：给悬浮标题栏让位。 */
const TOP_PAD = 260;
/** 地图底部留白：第 1 关木牌下方还留一段草地。 */
const BOTTOM_PAD = 200;
/** 关卡横向「之」字摆动的落点序列。 */
const ZIGZAG_X = [200, 400, 540, 360, 180, 320, 520] as const;

/**
 * 计算每关在地图上的位置：第 1 关在最底部，逐关向上，横向按「之」字摆动。
 * @returns 各关坐标（与入参顺序一致）与地图总高
 */
export function layoutStageNodes(count: number): { points: MapPoint[]; height: number } {
  const height = TOP_PAD + BOTTOM_PAD + Math.max(0, count - 1) * ROW_GAP;
  const points = Array.from({ length: count }, (_, i) => ({
    x: ZIGZAG_X[i % ZIGZAG_X.length]!,
    y: height - BOTTOM_PAD - i * ROW_GAP,
  }));
  return { points, height };
}

/**
 * 把一串节点连成平滑的 SVG 路径：相邻两点间用竖向切线的三次贝塞尔，
 * 走出参考图那种蜿蜒小路的感觉。少于两点返回空串。
 */
export function buildRoadPath(points: readonly MapPoint[]): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  let prev = first!;
  for (const point of rest) {
    const midY = (prev.y + point.y) / 2;
    d += ` C ${prev.x} ${midY}, ${point.x} ${midY}, ${point.x} ${point.y}`;
    prev = point;
  }
  return d;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 战役选关页：卡通大地图，关卡沿小路自下而上排布；锁定关禁用，已通关带对勾。 */
export function createCampaignPage(options: CampaignPageOptions): CampaignPageHandle {
  const root = required<HTMLElement>('#campaign');
  const backButton = required<HTMLButtonElement>('#btn-campaign-back', root);
  const list = required<HTMLElement>('#campaign-list', root);
  const disposeDrag = enableDragScroll(list);

  /** 某关是否可点：开发服全解锁，正式服按进度逐关推进。 */
  const isUnlocked = (progress: CampaignProgress, orderedIds: readonly string[], stageId: string): boolean =>
    options.unlockAllStages === true || isStageUnlocked(progress, orderedIds, stageId);

  /** 重新读取进度并渲染整张地图，然后把当前关滚到视野中央。 */
  const render = (): void => {
    const stages = options.getStages();
    const progress = options.getProgress();
    const orderedIds = stages.map((stage) => stage.id);
    const { points, height } = layoutStageNodes(stages.length);
    const unlocked = stages.map((stage) => isUnlocked(progress, orderedIds, stage.id));
    // 当前关：第一个已解锁但未通关的关卡；全部通关时没有
    const currentIndex = stages.findIndex((stage, i) => unlocked[i] && !progress.stages[stage.id]);
    // 最后一个已解锁关之前的路段算「已走过」
    const reachedCount = unlocked.lastIndexOf(true) + 1;

    const map = document.createElement('div');
    map.className = 'campaign-map';
    map.style.setProperty('--map-h', String(height));
    map.append(
      createDecorLayer(),
      createRoad(points, reachedCount, height),
      ...stages.map((stage, i) =>
        createStageButton(stage, progress, {
          unlocked: unlocked[i]!,
          current: i === currentIndex,
          boss: i === stages.length - 1,
          point: points[i]!,
        }),
      ),
    );
    list.replaceChildren(map);

    const focus = list.querySelector<HTMLElement>('.campaign-stage.is-current')
      ?? list.querySelector<HTMLElement>('.campaign-stage');
    // jsdom 没有 scrollIntoView，可选调用即可
    requestAnimationFrame(() => focus?.scrollIntoView?.({ block: 'center' }));
  };

  /** 单个关卡节点：城堡贴图 + 状态徽章 + 底部木牌（序号、标题、地图名）。 */
  const createStageButton = (
    stage: StageDef,
    progress: CampaignProgress,
    state: { unlocked: boolean; current: boolean; boss: boolean; point: MapPoint },
  ): HTMLButtonElement => {
    const cleared = Boolean(progress.stages[stage.id]);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'campaign-stage';
    button.disabled = !state.unlocked;
    button.dataset.stageId = stage.id;
    button.classList.toggle('is-cleared', cleared);
    button.classList.toggle('is-current', state.current);
    button.classList.toggle('is-locked', !state.unlocked);
    button.classList.toggle('is-boss', state.boss);
    button.style.setProperty('--x', String(state.point.x));
    button.style.setProperty('--y', String(state.point.y));
    button.setAttribute('role', 'listitem');

    const castle = document.createElement('img');
    castle.className = 'campaign-stage-castle';
    castle.src = state.boss ? 'buildings/base_red.png' : 'buildings/tower_red.png';
    castle.alt = '';
    castle.draggable = false;

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

    const sign = document.createElement('span');
    sign.className = 'campaign-stage-sign';
    sign.append(index, title);

    const status = document.createElement('span');
    status.className = 'campaign-stage-status';
    status.textContent = cleared ? '✓ 已完成' : '';

    button.append(castle, status, sign);
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
      backButton.removeEventListener('click', options.onBack);
      disposeDrag();
    },
  };
}

/** 沙土小路：底层描边 + 已走过实色段 + 未解锁虚线段，三条 path 叠出厚度。 */
function createRoad(points: readonly MapPoint[], reachedCount: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'campaign-road');
  svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const addPath = (className: string, d: string): void => {
    if (!d) return;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    svg.append(path);
  };
  addPath('campaign-road-edge', buildRoadPath(points));
  addPath('campaign-road-reached', buildRoadPath(points.slice(0, reachedCount)));
  addPath('campaign-road-locked', buildRoadPath(points.slice(Math.max(0, reachedCount - 1))));
  return svg;
}

/** 地图装饰层：山体、松树、河流全用 CSS 绘制，只做氛围不吃点击。 */
function createDecorLayer(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'campaign-decor';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<i class="decor-river"></i><i class="decor-mountains is-left"></i>'
    + '<i class="decor-mountains is-right"></i><i class="decor-trees is-left"></i><i class="decor-trees is-right"></i>';
  return layer;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`战役页缺少元素：${selector}`);
  return element;
}
