import type { BoonDef, EndlessRunState } from '@pb/sim';

/** 一个可点的选项按钮。 */
interface PanelAction {
  label: string;
  hint?: string;
  rare?: boolean;
  onClick: () => void;
}

export interface BoonPickPanelHandle {
  /** 波次结束：展示继承属性与三选一强化，点选后关闭并回调。 */
  showChoices(state: EndlessRunState, clearedWave: number, choices: readonly BoonDef[], onPick: (boonId: string) => void): void;
  /** 入口：有进行中的挑战时让玩家选「继续」或「重新开始」。 */
  showEntry(run: EndlessRunState, onContinue: () => void, onRestart: () => void, onCancel: () => void): void;
  hide(): void;
}

/**
 * 无限防守的弹层：波次间三选一强化 + 续玩入口。
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

  /** 用标题、说明和一组按钮重绘弹层并显示。 */
  const render = (title: string, lines: readonly string[], actions: readonly PanelAction[]): void => {
    const heading = document.createElement('h2');
    heading.className = 'boon-panel-title';
    heading.textContent = title;
    const info = document.createElement('p');
    info.className = 'boon-panel-info';
    info.textContent = lines.join('　');
    const list = document.createElement('div');
    list.className = 'boon-panel-list';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'boon-panel-option';
      button.classList.toggle('is-rare', action.rare === true);
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
      list.append(button);
    }
    box.replaceChildren(heading, info, list);
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
  };

  const hide = (): void => {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  return {
    showChoices(state, clearedWave, choices, onPick) {
      render(
        `第 ${clearedWave} 波 守住了！`,
        [...describeRun(state), '选择一项强化'],
        choices.map((boon) => ({
          label: boon.name,
          hint: boon.description,
          rare: boon.rarity === 'rare',
          onClick: () => onPick(boon.id),
        })),
      );
    },
    showEntry(run, onContinue, onRestart, onCancel) {
      render('无限防守', [`上次挑战停在第 ${run.wave} 波`, ...describeRun(run)], [
        { label: `继续第 ${run.wave} 波`, onClick: onContinue },
        { label: '重新开始', hint: '放弃当前进度', onClick: onRestart },
        { label: '返回', onClick: onCancel },
      ]);
    },
    hide,
  };
}

/** 继承属性摘要，供弹层说明行展示。 */
export function describeRun(state: EndlessRunState): string[] {
  const lines = [
    `主堡 ${Math.round(state.castleHpRatio * 100)}%`,
    `手牌上限 ${state.handLimit}`,
    `发牌 ${state.drawIntervalSeconds} 秒`,
    `万能牌 ${state.wildCards}`,
  ];
  if (state.regenPerWave > 0) lines.push(`每波回血 ${Math.round(state.regenPerWave * 100)}%`);
  return lines;
}
