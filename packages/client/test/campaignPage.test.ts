// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageDef } from '@pb/sim';
import { emptyProgress, recordStageClear } from '../src/campaign/progress.js';
import { createCampaignPage } from '../src/ui/campaignPage.js';

/** 构造最小关卡，只填页面会读到的字段。 */
function stage(id: string, chapter: number, index: number): StageDef {
  return {
    id,
    chapter,
    index,
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
  const stages = [stage('a', 1, 1), stage('b', 1, 2), stage('c', 2, 1)];

  it('按章节分组，仅第一关与已通关后继关卡可点', () => {
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
    expect(document.querySelectorAll('.campaign-chapter')).toHaveLength(2);
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
});
