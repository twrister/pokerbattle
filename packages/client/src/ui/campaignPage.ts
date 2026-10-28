import { CAMPAIGN_ARENA_PRESETS, type StageDef } from '@pb/sim';
import { isStageUnlocked, type CampaignProgress } from '../campaign/progress.js';

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

/** 战役选关页：关卡按序号连续排列，锁定关卡禁用，已通关显示完成标记。 */
export function createCampaignPage(options: CampaignPageOptions): CampaignPageHandle {
  const root = required<HTMLElement>('#campaign');
  const backButton = required<HTMLButtonElement>('#btn-campaign-back', root);
  const list = required<HTMLElement>('#campaign-list', root);

  /** 某关是否可点：开发服全解锁，正式服按进度逐关推进。 */
  const isUnlocked = (progress: CampaignProgress, orderedIds: readonly string[], stageId: string): boolean =>
    options.unlockAllStages === true || isStageUnlocked(progress, orderedIds, stageId);

  /** 重新读取进度并渲染整个列表。 */
  const render = (): void => {
    const stages = options.getStages();
    const progress = options.getProgress();
    const orderedIds = stages.map((stage) => stage.id);
    // 不分章节：全部关卡按序号连续排成一列
    list.replaceChildren(
      ...stages.map((stage) => createStageButton(stage, progress, isUnlocked(progress, orderedIds, stage.id))),
    );
  };

  /** 单个关卡卡片：序号 + 标题（带地图名）+ 完成标记；锁定时禁用点击。 */
  const createStageButton = (
    stage: StageDef,
    progress: CampaignProgress,
    unlocked: boolean,
  ): HTMLButtonElement => {
    const cleared = Boolean(progress.stages[stage.id]);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'campaign-stage cartoon-btn';
    button.disabled = !unlocked;
    button.dataset.stageId = stage.id;
    button.classList.toggle('is-cleared', cleared);
    button.setAttribute('role', 'listitem');

    const index = document.createElement('span');
    index.className = 'campaign-stage-index';
    index.textContent = unlocked ? String(stage.index) : '锁';

    const title = document.createElement('span');
    title.className = 'campaign-stage-title';
    title.textContent = stage.title;
    if (stage.arena) {
      const arena = document.createElement('span');
      arena.className = 'campaign-stage-arena';
      arena.textContent = CAMPAIGN_ARENA_PRESETS[stage.arena].name;
      title.append(arena);
    }

    const status = document.createElement('span');
    status.className = 'campaign-stage-status';
    status.textContent = cleared ? '✓ 已完成' : '';

    button.append(index, title, status);
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
    },
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`战役页缺少元素：${selector}`);
  return element;
}
