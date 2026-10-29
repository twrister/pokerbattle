import type { BoonDef, EndlessRunState } from '@pb/sim';

/**
 * 选项外观：boon / rare 是强化卡片（左侧色条区分稀有度），
 * gold / red / blue 是续玩入口的普通按钮，配色与大厅按钮一致。
 */
type PanelActionVariant = 'boon' | 'rare' | 'gold' | 'red' | 'blue';

/** 一个可点的选项按钮。 */
interface PanelAction {
  label: string;
  hint?: string;
  variant: PanelActionVariant;
  onClick: () => void;
}

export interface BoonPickPanelHandle {
  /**
   * 波次结束：展示三选一强化，点选后关闭并回调。
   * 叠加属性由局内 HUD 承担，弹层只留选项，避免同一组数字重复出现。
   */
  showChoices(clearedWave: number, choices: readonly BoonDef[], onPick: (boonId: string) => void): void;
  /** 入口：有进行中的挑战时让玩家选「继续」或「重新开始」。 */
  showEntry(run: EndlessRunState, onContinue: () => void, onRestart: () => void, onCancel: () => void): void;
  hide(): void;
}

/**
 * 无限防守的弹层：波次间三选一强化 + 续玩入口。
 * 外观复用结算面板的奶油卡通风（贴顶色带标题 + 粗描边厚投影），
 * DOM 动态创建挂到 body，样式见 index.html 的 .boon-panel。
 */
export function createBoonPickPanel(): BoonPickPanelHandle {
  const root = document.createElement('section');
  root.className = 'boon-panel is-hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-hidden', 'true');
  const box = document.createElement('div');
  box.className = 'boon-panel-box';
  root.append(box);
  document.body.append(root);

  /**
   * 切换挂载父节点（重复挂同一处时不动，避免每波都触发一次重排）。
   * 三选一挂进局内 HUD，才能和「本局叠加」处在同一层叠上下文里被抬到遮罩之上；
   * 续玩入口在局外，HUD 此时是隐藏的，必须挂回 body 才看得见。
   */
  const mountTo = (parent: HTMLElement): void => {
    if (root.parentElement !== parent) parent.append(root);
  };

  /**
   * 用标题、副标题和一组按钮重绘弹层并显示。
   * stats 为空时不渲染属性胶囊（三选一靠局内 HUD 看叠加）。
   */
  const render = (
    title: string,
    subtitle: string,
    stats: readonly string[],
    actions: readonly PanelAction[],
  ): void => {
    const heading = document.createElement('h2');
    heading.className = 'boon-panel-title';
    heading.textContent = title;

    const info = document.createElement('p');
    info.className = 'boon-panel-info';
    info.textContent = subtitle;

    const list = document.createElement('div');
    list.className = 'boon-panel-list';
    list.append(...actions.map(createActionButton));

    // 有属性摘要才插胶囊，否则标题直接接副标题
    if (stats.length === 0) {
      box.replaceChildren(heading, info, list);
    } else {
      const statList = document.createElement('ul');
      statList.className = 'boon-panel-stats';
      statList.append(
        ...stats.map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }),
      );
      box.replaceChildren(heading, statList, info, list);
    }
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
  };

  /** 单个选项按钮：点选先关弹层再回调，避免回调里开新局时弹层还挡着。 */
  const createActionButton = (action: PanelAction): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `boon-panel-option is-${action.variant}`;
    // 续玩入口的普通按钮直接复用大厅卡通按钮（蓝色为默认配色，无需额外类）
    if (action.variant === 'gold' || action.variant === 'red') button.classList.add('cartoon-btn', `is-btn-${action.variant}`);
    else if (action.variant === 'blue') button.classList.add('cartoon-btn');
    const name = document.createElement('strong');
    name.textContent = action.label;
    button.append(name);
    if (action.hint) {
      const hint = document.createElement('span');
      hint.textContent = action.hint;
      button.append(hint);
    }
    button.addEventListener('click', () => {
      hide();
      action.onClick();
    });
    return button;
  };

  const hide = (): void => {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  return {
    showChoices(clearedWave, choices, onPick) {
      // 挂进局内 HUD：这样弹层与「本局叠加」同处一个层叠上下文，HUD 面板能浮在遮罩上
      mountTo(inBattleHud());
      render(
        `第 ${clearedWave} 波 守住了！`,
        '选择一项强化',
        // 本局叠加已由局内 HUD 展示，这里不再重复
        [],
        choices.map((boon) => ({
          label: boon.name,
          hint: boon.description,
          variant: boon.rarity === 'rare' ? 'rare' : 'boon',
          onClick: () => onPick(boon.id),
        })),
      );
    },
    showEntry(run, onContinue, onRestart, onCancel) {
      // 续玩入口在局外，HUD 是隐藏的，挂回 body 才看得见
      mountTo(document.body);
      render('无限防守', `上次挑战停在第 ${run.wave} 波`, describeRun(run), [
        { label: `继续第 ${run.wave} 波`, variant: 'gold', onClick: onContinue },
        { label: '重新开始', hint: '放弃当前进度', variant: 'red', onClick: onRestart },
        { label: '返回', variant: 'blue', onClick: onCancel },
      ]);
    },
    hide,
  };
}

/** 取局内 HUD 作为弹层挂载点；页面被裁剪时退回 body，弹层仍可用。 */
function inBattleHud(): HTMLElement {
  return document.querySelector<HTMLElement>('#hud') ?? document.body;
}

/** 续玩入口用的继承属性摘要，逐行列出当前累计到的数值。 */
export function describeRun(state: EndlessRunState): string[] {
  const lines = [
    `主堡 ${Math.round(state.castleHpRatio * 100)}%`,
    `手牌上限 ${state.handLimit}`,
    `发牌 ${state.drawIntervalSeconds} 秒`,
    `万能牌 ${state.wildCards}`,
  ];
  if (state.regenPerWave > 0) lines.push(`每波回血 ${Math.round(state.regenPerWave * 100)}%`);
  // 上次阵亡清空的挑战没有继承单位，不显示这条
  if ((state.carriedUnits?.length ?? 0) > 0) lines.push(`继承单位 ${state.carriedUnits.length}`);
  return lines;
}
