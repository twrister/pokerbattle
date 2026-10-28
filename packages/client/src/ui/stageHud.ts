export interface StageHudHandle {
  /** 开局展示目标卡片；title 缺省为「通关条件」，无限防守写「第 N 波」。 */
  start(title?: string): void;
  /** 每帧刷新目标进度。 */
  update(progress: ReadonlyArray<{ text: string; done: boolean }>): void;
  hide(): void;
}

/**
 * 战役局内目标卡片（左上角通关条件）。
 * 关卡不再有任何文字提示，教学只靠手牌弱引导的虚拟手指演示操作。
 */
export function createStageHud(): StageHudHandle {
  const hud = required<HTMLElement>('#stage-hud');
  const objectives = required<HTMLUListElement>('#stage-hud-objectives');
  const titleEl = required<HTMLElement>('#stage-hud-title');

  let lastObjectiveSignature = '';

  return {
    start(title = '通关条件') {
      lastObjectiveSignature = '';
      titleEl.textContent = title;
      hud.classList.remove('is-hidden');
    },
    update(progress) {
      // 只在文案或完成态变化时重建列表，避免每帧改 DOM
      const signature = progress.map((item) => `${item.done ? 1 : 0}${item.text}`).join('|');
      if (signature === lastObjectiveSignature) return;
      lastObjectiveSignature = signature;
      objectives.replaceChildren(
        ...progress.map((item) => {
          const li = document.createElement('li');
          li.textContent = item.text;
          li.classList.toggle('is-done', item.done);
          return li;
        }),
      );
    },
    hide() {
      hud.classList.add('is-hidden');
    },
  };
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`关卡 HUD 缺少元素：${selector}`);
  return element;
}
