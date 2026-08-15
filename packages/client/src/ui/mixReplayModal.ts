import { mixTicksToSeconds, type MixGameRecord } from '@pb/sim';
import { createMixReplayView, type MixReplayHandle, type MixReplayState } from '../view/mixReplayView.js';

export interface MixReplayModalHandle {
  open(record: MixGameRecord): void;
  close(): void;
  dispose(): void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;

/**
 * 搭配对比回放弹窗：绑定预置 DOM，打开时才创建 WebGL 场景。
 */
export function createMixReplayModal(root: ParentNode = document): MixReplayModalHandle {
  const overlay = required<HTMLElement>('#hand-mix-replay', root);
  const title = required<HTMLElement>('#hand-mix-replay-title', overlay);
  const meta = required<HTMLElement>('#hand-mix-replay-meta', overlay);
  const canvas = required<HTMLElement>('#hand-mix-replay-canvas', overlay);
  const aliveLabel = required<HTMLElement>('#hand-mix-replay-alive', overlay);
  const timeLabel = required<HTMLElement>('#hand-mix-replay-time', overlay);
  const barA = required<HTMLElement>('#hand-mix-replay-bar-a', overlay);
  const barB = required<HTMLElement>('#hand-mix-replay-bar-b', overlay);
  const labelA = required<HTMLElement>('#hand-mix-replay-label-a', overlay);
  const labelB = required<HTMLElement>('#hand-mix-replay-label-b', overlay);
  const playButton = required<HTMLButtonElement>('#btn-hand-mix-replay-play', overlay);
  const speedSelect = required<HTMLSelectElement>('#hand-mix-replay-speed', overlay);
  const seekInput = required<HTMLInputElement>('#hand-mix-replay-seek', overlay);
  const closeButton = required<HTMLButtonElement>('#btn-hand-mix-replay-close', overlay);

  let view: MixReplayHandle | null = null;
  let seeking = false;

  const onPlay = (): void => {
    if (!view) return;
    if (playButton.dataset.playing === '1') view.pause();
    else view.play();
  };
  const onSpeed = (): void => {
    const value = Number(speedSelect.value);
    view?.setSpeed(SPEED_OPTIONS.includes(value as (typeof SPEED_OPTIONS)[number]) ? value : 1);
  };
  const onSeekInput = (): void => {
    seeking = true;
    view?.pause();
  };
  const onSeekChange = (): void => {
    const tick = Number(seekInput.value);
    if (Number.isInteger(tick)) view?.seek(tick);
    seeking = false;
  };
  const onClose = (): void => close();
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !overlay.classList.contains('is-hidden')) {
      event.preventDefault();
      close();
    }
  };
  const onBackdrop = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.replayClose === '1') close();
  };

  playButton.addEventListener('click', onPlay);
  speedSelect.addEventListener('change', onSpeed);
  seekInput.addEventListener('input', onSeekInput);
  seekInput.addEventListener('change', onSeekChange);
  closeButton.addEventListener('click', onClose);
  overlay.addEventListener('click', onBackdrop);
  window.addEventListener('keydown', onKeydown);

  /** 把回放状态同步到播放按钮、血条、时间和进度条。 */
  function syncHud(state: MixReplayState): void {
    playButton.dataset.playing = state.playing ? '1' : '0';
    playButton.textContent = state.playing ? '暂停' : state.finished ? '重播' : '播放';
    aliveLabel.textContent = `存活 A ${state.aliveA} · B ${state.aliveB}`;
    applyHpBar(barA, labelA, state.hpFracA);
    applyHpBar(barB, labelB, state.hpFracB);
    timeLabel.textContent = `${mixTicksToSeconds(state.tick).toFixed(1)} / ${mixTicksToSeconds(state.totalTicks).toFixed(1)} 秒`;
    seekInput.max = String(state.totalTicks);
    if (!seeking) seekInput.value = String(state.tick);
  }

  function open(record: MixGameRecord): void {
    close();
    title.textContent = '对局回放';
    meta.textContent = `${winnerLabel(record)} · ${mixTicksToSeconds(record.ticks).toFixed(1)} 秒 · 种子 ${record.seed}`;
    overlay.classList.remove('is-hidden');
    overlay.setAttribute('aria-hidden', 'false');
    view = createMixReplayView(canvas, { onState: syncHud });
    view.load(record.replay, { totalTicks: Math.max(1, record.ticks) });
    view.setSpeed(Number(speedSelect.value) || 1);
    view.resize();
    view.play();
  }

  function close(): void {
    overlay.classList.add('is-hidden');
    overlay.setAttribute('aria-hidden', 'true');
    view?.dispose();
    view = null;
    canvas.replaceChildren();
    playButton.dataset.playing = '0';
    playButton.textContent = '播放';
  }

  function dispose(): void {
    close();
    playButton.removeEventListener('click', onPlay);
    speedSelect.removeEventListener('change', onSpeed);
    seekInput.removeEventListener('input', onSeekInput);
    seekInput.removeEventListener('change', onSeekChange);
    closeButton.removeEventListener('click', onClose);
    overlay.removeEventListener('click', onBackdrop);
    window.removeEventListener('keydown', onKeydown);
  }

  return { open, close, dispose };
}

function winnerLabel(record: MixGameRecord): string {
  if (record.winner === 'a') return 'A 胜';
  if (record.winner === 'b') return 'B 胜';
  return record.timeout ? '超时平局' : '平局';
}

function applyHpBar(bar: HTMLElement, label: HTMLElement, frac: number): void {
  const clamped = Math.max(0, Math.min(1, frac));
  const pct = `${(clamped * 100).toFixed(1)}%`;
  bar.style.width = `${(clamped * 100).toFixed(2)}%`;
  label.textContent = pct;
  const track = bar.parentElement;
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    track.setAttribute('aria-valuetext', pct);
  }
}

function required<T extends Element>(selector: string, parent: ParentNode): T {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`缺少节点 ${selector}`);
  return el as T;
}
