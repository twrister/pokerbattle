import { TICK_RATE } from '@pb/sim';
import type { ReplaySpeed } from '../replay/index.js';

export interface ReplayControlsOptions {
  onTogglePause: () => void;
  onSetSpeed: (speed: ReplaySpeed) => void;
  onRestart: () => void;
}

export interface ReplayControlsHandle {
  show(): void;
  hide(): void;
  setPaused(paused: boolean): void;
  setSpeed(speed: ReplaySpeed): void;
  setProgress(tick: number, endTick: number): void;
  dispose(): void;
}

/** 回放控制条：暂停、倍速、重播与进度时钟。 */
export function createReplayControls(options: ReplayControlsOptions): ReplayControlsHandle {
  const root = required<HTMLElement>('#replay-controls');
  const pauseButton = required<HTMLButtonElement>('#btn-replay-pause', root);
  const restartButton = required<HTMLButtonElement>('#btn-replay-restart', root);
  const progress = required<HTMLElement>('#replay-progress', root);
  const speedButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-replay-speed]'));

  const togglePause = (): void => options.onTogglePause();
  const restart = (): void => options.onRestart();
  const speedHandlers = speedButtons.map((button) => {
    const handler = (): void => {
      const speed = Number(button.dataset.replaySpeed);
      if (speed === 1 || speed === 2 || speed === 4) options.onSetSpeed(speed);
    };
    button.addEventListener('click', handler);
    return { button, handler };
  });

  pauseButton.addEventListener('click', togglePause);
  restartButton.addEventListener('click', restart);

  return {
    show() {
      root.classList.remove('is-hidden');
    },
    hide() {
      root.classList.add('is-hidden');
    },
    setPaused(paused) {
      pauseButton.textContent = paused ? '继续' : '暂停';
    },
    setSpeed(speed) {
      for (const button of speedButtons) {
        button.classList.toggle('is-active', Number(button.dataset.replaySpeed) === speed);
      }
    },
    setProgress(tick, endTick) {
      progress.textContent = `${formatReplayClock(tick)} / ${formatReplayClock(endTick)}`;
    },
    dispose() {
      pauseButton.removeEventListener('click', togglePause);
      restartButton.removeEventListener('click', restart);
      for (const { button, handler } of speedHandlers) {
        button.removeEventListener('click', handler);
      }
    },
  };
}

/** tick ÷ 20Hz 换成 m:ss，供控制条与测试共用。 */
export function formatReplayClock(tick: number): string {
  const total = Math.max(0, Math.floor(tick / TICK_RATE));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`回放控制条缺少元素：${selector}`);
  return element;
}
