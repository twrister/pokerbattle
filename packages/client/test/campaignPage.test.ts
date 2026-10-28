// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageDef } from '@pb/sim';
import { emptyProgress, recordStageClear } from '../src/campaign/progress.js';
import { buildRoadPath, createCampaignPage, layoutStageNodes } from '../src/ui/campaignPage.js';

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

beforeEach(() => {
  document.body.innerHTML = `
    <main id="campaign" class="is-hidden">
      <button id="btn-campaign-back"></button>
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
    expect(buttons[2]!.querySelector('.campaign-stage-arena')?.textContent).toBe('要塞');
    // 只有已通关的关卡带完成标记，且不再显示副标题与星级
    expect(buttons.map((button) => button.querySelector('.campaign-stage-status')!.textContent)).toEqual([
      '✓ 已完成',
      '',
      '',
    ]);
    expect(buttons[0]!.classList.contains('is-cleared')).toBe(true);
    expect(document.querySelector('.campaign-stage-goal')).toBeNull();
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
    // 全解锁不代表已通关，未打过的关卡不应显示完成标记
    expect(buttons.map((button) => button.querySelector('.campaign-stage-status')!.textContent)).toEqual(['', '', '']);

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
    // 普通关用箭塔贴图，最后一关用主堡
    expect(buttons[0]!.querySelector<HTMLImageElement>('.campaign-stage-castle')!.getAttribute('src')).toBe(
      'buildings/tower_red.png',
    );
    expect(buttons[2]!.querySelector<HTMLImageElement>('.campaign-stage-castle')!.getAttribute('src')).toBe(
      'buildings/base_red.png',
    );
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

    // 已解锁段与锁定段各一组路肩 + 路面
    expect(map.querySelectorAll('svg.campaign-road path.is-open')).toHaveLength(2);
    expect(map.querySelectorAll('svg.campaign-road path.is-locked')).toHaveLength(2);
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
});

describe('战役地图布局', () => {
  it('layoutStageNodes 自下而上等距排布，横向之字摆动', () => {
    const { points, height } = layoutStageNodes(5);
    expect(points).toHaveLength(5);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i - 1]!.y - points[i]!.y).toBe(points[0]!.y - points[1]!.y);
    }
    expect(points[0]!.y).toBeLessThan(height);
    expect(points[4]!.y).toBeGreaterThan(0);
    expect(new Set(points.map((point) => point.x)).size).toBeGreaterThan(1);
    points.forEach((point) => {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(720);
    });
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
