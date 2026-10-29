// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageDef } from '@pb/sim';
import { emptyProgress, recordStageClear } from '../src/campaign/progress.js';
import {
  MIN_ROW_HEIGHT,
  buildRoadPath,
  campaignStageGoalText,
  createCampaignPage,
  layoutStageNodes,
} from '../src/ui/campaignPage.js';

/** 构造最小关卡，只填页面会读到的字段。 */
function stage(id: string, index: number, arena?: StageDef['arena']): StageDef {
  return {
    id,
    index,
    ...(arena ? { arena } : {}),
    title: `关${id}`,
    seed: 1,
    enemy: { kind: 'none' },
    objectives: [{ kind: 'win_match' }],
  };
}

/** 读取节点星星徽章状态：金星 / 空星 / 无。 */
function starState(button: HTMLElement): 'earned' | 'empty' | 'none' {
  const star = button.querySelector('.campaign-stage-star');
  if (!star) return 'none';
  return star.classList.contains('is-earned') ? 'earned' : 'empty';
}

beforeEach(() => {
  document.body.innerHTML = `
    <main id="campaign" class="is-hidden">
      <button id="btn-campaign-back"></button>
      <span id="campaign-stars"></span>
      <div id="campaign-list"></div>
    </main>`;
});

describe('战役选关页', () => {
  const stages = [stage('a', 1), stage('b', 2), stage('c', 3, 'fortress')];

  it('不分章节连续排列，仅第一关与已通关后继关卡可点', () => {
    const progress = recordStageClear(emptyProgress(), { stageId: 'a', seconds: 30 });
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => progress,
    });
    page.show();

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.campaign-stage')];
    expect(buttons.map((button) => button.disabled)).toEqual([false, false, true]);
    expect(document.querySelectorAll('.campaign-chapter')).toHaveLength(0);
    // 解锁关卡显示连续序号，锁定关卡显示锁；带地图的关卡附地图名
    expect(buttons.map((button) => button.querySelector('.campaign-stage-index')!.textContent)).toEqual([
      '1',
      '2',
      '锁',
    ]);
    // 卡片只保留标题，不再有标签与目标小字
    expect(document.querySelector('.campaign-stage-arena')).toBeNull();
    expect(document.querySelector('.campaign-stage-goal')).toBeNull();
    // 已通关为金星，已解锁未通关为空星，锁定关不显示星星
    expect(buttons.map((button) => starState(button))).toEqual(['earned', 'empty', 'none']);
    expect(buttons[0]!.classList.contains('is-cleared')).toBe(true);
    // 标题栏只显示星数总和
    expect(document.querySelector('#campaign-stars')!.textContent).toBe('★ 1');
    // 节点不再使用任何城堡贴图
    expect(document.querySelector('.campaign-stage-castle')).toBeNull();
    expect(document.querySelector('.campaign-stage img')).toBeNull();
  });

  it('点击解锁关卡触发 onStartStage，锁定关卡不触发', () => {
    const onStartStage = vi.fn();
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage,
      getStages: () => stages,
      getProgress: () => emptyProgress(),
    });
    page.show();
    const buttons = document.querySelectorAll<HTMLButtonElement>('.campaign-stage');
    buttons[0]!.click();
    buttons[1]!.click();
    expect(onStartStage).toHaveBeenCalledTimes(1);
    expect(onStartStage).toHaveBeenCalledWith('a');
  });

  it('开启 unlockAllStages 后全部关卡可点并显示真实序号', () => {
    const onStartStage = vi.fn();
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage,
      getStages: () => stages,
      getProgress: () => emptyProgress(),
      unlockAllStages: true,
    });
    page.show();

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.campaign-stage')];
    expect(buttons.map((button) => button.disabled)).toEqual([false, false, false]);
    expect(buttons.map((button) => button.querySelector('.campaign-stage-index')!.textContent)).toEqual([
      '1',
      '2',
      '3',
    ]);
    // 全解锁不代表已通关，未打过的关卡只显示空星
    expect(buttons.map((button) => starState(button))).toEqual(['empty', 'empty', 'empty']);
    expect(document.querySelector('#campaign-stars')!.textContent).toBe('★ 0');

    buttons[2]!.click();
    expect(onStartStage).toHaveBeenCalledWith('c');
  });

  it('第一个已解锁未通关的关卡标记为当前关，锁定关带 is-locked、最后一关为 Boss', () => {
    const progress = recordStageClear(emptyProgress(), { stageId: 'a', seconds: 30 });
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => progress,
    });
    page.show();

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.campaign-stage')];
    expect(buttons.map((button) => button.classList.contains('is-current'))).toEqual([false, true, false]);
    expect(buttons.map((button) => button.classList.contains('is-locked'))).toEqual([false, false, true]);
    expect(buttons.map((button) => button.classList.contains('is-boss'))).toEqual([false, false, true]);
  });

  it('全部通关时没有当前关', () => {
    let progress = emptyProgress();
    for (const id of ['a', 'b', 'c']) progress = recordStageClear(progress, { stageId: id, seconds: 30 });
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => progress,
    });
    page.show();
    expect(document.querySelectorAll('.campaign-stage.is-current')).toHaveLength(0);
  });

  it('节点按序号设置 --x/--y，第 1 关在地图最下方，地图内有沙土路 SVG', () => {
    const progress = recordStageClear(emptyProgress(), { stageId: 'a', seconds: 30 });
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => progress,
    });
    page.show();

    const map = document.querySelector<HTMLElement>('#campaign-list > .campaign-map')!;
    expect(map).not.toBeNull();
    const ys = [...map.querySelectorAll<HTMLButtonElement>('.campaign-stage')].map((button) =>
      Number(button.style.getPropertyValue('--y')),
    );
    // y 以地图顶边为 0 向下增长：序号越大越靠上
    expect(ys[0]!).toBeGreaterThan(ys[1]!);
    expect(ys[1]!).toBeGreaterThan(ys[2]!);
    expect(Number(map.style.getPropertyValue('--map-h'))).toBeGreaterThan(ys[0]!);

    // 已解锁段与锁定段各一条路径
    expect(map.querySelectorAll('svg.campaign-road path.is-open')).toHaveLength(1);
    expect(map.querySelectorAll('svg.campaign-road path.is-locked')).toHaveLength(1);
    expect(map.querySelector('svg.campaign-road path')!.getAttribute('d')).toMatch(/^M /);
  });

  it('dispose 后不再响应返回按钮', () => {
    const onBack = vi.fn();
    const page = createCampaignPage({
      onBack,
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => emptyProgress(),
    });
    page.dispose();
    document.querySelector<HTMLButtonElement>('#btn-campaign-back')!.click();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('无限防守节点跟在最后一关之后，最后一关通关才解锁', () => {
    const onStart = vi.fn();
    let progress = emptyProgress();
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => progress,
      endless: { getBestWave: () => 7, onStart },
    });
    page.show();
    let endless = document.querySelector<HTMLButtonElement>('.campaign-endless')!;
    expect(endless.disabled).toBe(true);
    // 终点大节点让给无限防守
    expect(document.querySelectorAll('.campaign-stage.is-boss')).toHaveLength(1);
    expect(endless.querySelector('.campaign-stage-title')!.textContent).toBe('无限防守');

    for (const id of ['a', 'b', 'c']) progress = recordStageClear(progress, { stageId: id, seconds: 10 });
    page.show();
    endless = document.querySelector<HTMLButtonElement>('.campaign-endless')!;
    expect(endless.disabled).toBe(false);
    endless.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('标题星数包含无限防守守住波数', () => {
    let progress = emptyProgress();
    for (const id of ['a', 'b']) progress = recordStageClear(progress, { stageId: id, seconds: 10 });
    const page = createCampaignPage({
      onBack: vi.fn(),
      onStartStage: vi.fn(),
      getStages: () => stages,
      getProgress: () => progress,
      endless: { getBestWave: () => 5, onStart: vi.fn() },
    });
    page.show();
    // 2 关通关星 + 无限防守最佳 5 波
    expect(document.querySelector('#campaign-stars')!.textContent).toBe('★ 7');
    expect(document.querySelector('#campaign-stars')!.getAttribute('aria-label')).toBe('共获得 7 颗星');
  });
});

describe('战役目标摘要', () => {
  it('两条以内拼成一行，超出部分用 +N 概括，限制条件排在最后', () => {
    expect(campaignStageGoalText([{ kind: 'win_match' }])).toBe('赢下这一局');
    expect(campaignStageGoalText([{ kind: 'play_any' }, { kind: 'destroy_towers' }])).toBe(
      '打出任意兵种 · 摧毁敌方箭塔',
    );
    // 先给通关条件，限制条件（最多出几手）被挤到 +N 里，不抢主目标的版面
    expect(
      campaignStageGoalText([
        { kind: 'max_plays', count: 3 },
        { kind: 'destroy_unit', typeId: 'melee_grunt', label: '步兵' },
        { kind: 'destroy_towers' },
      ]),
    ).toBe('击毁步兵 · 摧毁敌方箭塔 +1');
  });
});

describe('战役地图布局', () => {
  it('layoutStageNodes 自下而上等距排布，节点统一在左列', () => {
    const { points, height } = layoutStageNodes(5);
    expect(points).toHaveLength(5);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i - 1]!.y - points[i]!.y).toBe(points[0]!.y - points[1]!.y);
    }
    expect(points[0]!.y).toBeLessThan(height);
    expect(points[4]!.y).toBeGreaterThan(0);
    expect(new Set(points.map((point) => point.x)).size).toBe(1);
    points.forEach((point) => {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(720);
    });
  });

  it('传入可视高度时压缩行距一屏放下，行距不低于下限', () => {
    const { points, height } = layoutStageNodes(9, 1100);
    expect(height).toBe(1100);
    const row = points[0]!.y - points[1]!.y;
    expect(row).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
    expect(points[8]!.y).toBeGreaterThan(0);
    // 可视高度太小时退回最小行距，地图超出视口改为滚动
    const tight = layoutStageNodes(9, 400);
    expect(tight.points[0]!.y - tight.points[1]!.y).toBe(MIN_ROW_HEIGHT);
    expect(tight.height).toBeGreaterThan(400);
  });

  it('buildRoadPath 每段一条三次贝塞尔，少于两点返回空串', () => {
    expect(buildRoadPath([])).toBe('');
    expect(buildRoadPath([{ x: 1, y: 2 }])).toBe('');
    const d = buildRoadPath([
      { x: 200, y: 600 },
      { x: 360, y: 400 },
      { x: 520, y: 200 },
    ]);
    expect(d.startsWith('M 200 600')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
    expect(d.endsWith('520 200')).toBe(true);
  });
});
