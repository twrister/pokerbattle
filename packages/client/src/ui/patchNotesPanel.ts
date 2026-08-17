import { PATCH_NOTES } from '../data/patchNotes.js';
import { formatLobbyVersion } from '../env.js';

export interface PatchNotesPanelHandle {
  open(): void;
  close(): void;
  dispose(): void;
}

/** 大厅内嵌更新公告弹层：静态数据渲染一次，开关只切显隐。 */
export function createPatchNotesPanel(): PatchNotesPanelHandle {
  const root = required<HTMLElement>('#patch-notes-dialog');
  const list = required<HTMLElement>('#patch-notes-list', root);
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-patch-notes-close]'),
  );

  list.replaceChildren(...PATCH_NOTES.map(renderNote));

  const close = (): void => {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  const open = (): void => {
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
  };

  for (const button of closeButtons) {
    button.addEventListener('click', close);
  }

  return {
    open,
    close,
    dispose() {
      for (const button of closeButtons) {
        button.removeEventListener('click', close);
      }
    },
  };
}

/** 单条版本公告：标题行 + 条目列表。 */
function renderNote(note: (typeof PATCH_NOTES)[number]): HTMLElement {
  const article = document.createElement('article');
  article.className = 'patch-note';

  const head = document.createElement('header');
  head.className = 'patch-note-head';

  const version = document.createElement('strong');
  version.className = 'patch-note-version';
  version.textContent = formatLobbyVersion(note.version);

  const date = document.createElement('time');
  date.className = 'patch-note-date';
  date.dateTime = note.date;
  date.textContent = note.date;

  head.append(version, date);

  const items = document.createElement('ul');
  items.className = 'patch-note-items';
  for (const text of note.items) {
    const item = document.createElement('li');
    item.textContent = text;
    items.append(item);
  }

  article.append(head, items);
  return article;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`更新公告缺少元素：${selector}`);
  return element;
}
