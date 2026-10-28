// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageDef } from '@pb/sim';
import { emptyProgress, recordStageClear } from '../src/campaign/progress.js';
import { createCampaignPage } from '../src/ui/campaignPage.js';

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
});
