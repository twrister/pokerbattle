import { createArenaSignature, type ReplayRecord } from '../replay/index.js';

export interface ReplayListPageOptions {
  onBack: () => void;
  onPlay: (record: ReplayRecord) => void;
  listReplays: () => ReplayRecord[];
}

export interface ReplayListPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 本地联机录像列表：点一行进入回放。 */
export function createReplayListPage(options: ReplayListPageOptions): ReplayListPageHandle {
  const root = required<HTMLElement>('#replay-list');
  const backButton = required<HTMLButtonElement>('#btn-replay-list-back', root);
  const list = required<HTMLElement>('#replay-list-items', root);
  const status = required<HTMLElement>('#replay-list-status', root);

  const render = (): void => {
    const records = options.listReplays();
    list.replaceChildren();
    status.textContent = '';
    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'replay-list-empty';
      empty.textContent = '暂无对战记录';
      list.append(empty);
      return;
    }
    for (const record of records) {
      list.append(renderRow(record, options.onPlay));
    }
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

function renderRow(record: ReplayRecord, onPlay: (record: ReplayRecord) => void): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'replay-list-row';
  row.setAttribute('role', 'listitem');

  const stale = record.arenaSignature !== createArenaSignature(record.matchMode);
  if (stale) row.classList.add('is-stale');

  const time = document.createElement('div');
  time.className = 'replay-list-time';
  time.textContent = formatRecordedAt(record.recordedAt);

  const title = document.createElement('div');
  title.className = 'replay-list-title';
  title.textContent = `${record.matchMode} · ${formatSides(record)}`;

  const meta = document.createElement('div');
  meta.className = 'replay-list-meta';
  const outcome = formatOutcome(record);
  meta.textContent = stale ? `${outcome} · 场景已变更` : outcome;

  row.append(time, title, meta);
  row.addEventListener('click', () => onPlay(record));
  return row;
}

function formatSides(record: ReplayRecord): string {
  const self = joinNames(record.context.localName, record.context.teammateName);
  const opp = joinNames(record.context.opponentName, record.context.extraOpponentName);
  return `${self} vs ${opp}`;
}

function joinNames(primary: string, extra?: string): string {
  return extra ? `${primary} / ${extra}` : primary;
}

function formatOutcome(record: ReplayRecord): string {
  const winner = record.result.winner;
  const outcome =
    winner === null ? '平局' : winner === record.context.localFaction ? '胜利' : '失败';
  return `${outcome} · ${formatReason(record.result.reason)}`;
}

function formatReason(reason: ReplayRecord['result']['reason']): string {
  if (reason === 'base_destroyed') return '摧毁主堡';
  if (reason === 'simultaneous_destroyed') return '同时陷落';
  return '时间耗尽';
}

function formatRecordedAt(recordedAt: number): string {
  const date = new Date(recordedAt);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`回放列表缺少元素：${selector}`);
  return element;
}
