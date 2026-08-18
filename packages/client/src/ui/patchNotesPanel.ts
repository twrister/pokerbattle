import {
  applyPatchNotes,
  clonePatchNotes,
  parsePatchNotes,
  persistPatchNotes,
  PATCH_NOTES,
  type PatchNote,
} from '../data/patchNotes.js';
import { APP_VERSION, formatLobbyVersion, IS_DEV_SERVER } from '../env.js';

export interface PatchNotesPanelHandle {
  open(): void;
  close(): void;
  dispose(): void;
}

/** 大厅内嵌更新公告弹层：正式服只读渲染；开发服可编辑并写回 patchNotes.json。 */
export function createPatchNotesPanel(): PatchNotesPanelHandle {
  const root = required<HTMLElement>('#patch-notes-dialog');
  const list = required<HTMLElement>('#patch-notes-list', root);
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-patch-notes-close]'),
  );

  const addButton = IS_DEV_SERVER ? required<HTMLButtonElement>('#btn-patch-notes-add', root) : null;
  const saveButton = IS_DEV_SERVER ? required<HTMLButtonElement>('#btn-patch-notes-save', root) : null;
  const statusEl = IS_DEV_SERVER ? required<HTMLElement>('#patch-notes-status', root) : null;

  let drafts = clonePatchNotes(PATCH_NOTES);
  let saveSeq = 0;
  const stopDragScroll = enableDragScroll(list);

  const close = (): void => {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  const open = (): void => {
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
  };

  const addNote = (): void => {
    drafts.unshift(createBlankNote());
    setStatus('已新增版本，编辑后点保存写回文件', false);
    render();
  };

  const save = (): void => {
    let parsed: PatchNote[];
    try {
      parsed = parsePatchNotes(drafts);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return;
    }
    applyPatchNotes(parsed);
    drafts = clonePatchNotes(parsed);
    const seq = ++saveSeq;
    void persistPatchNotes(parsed).then((result) => {
      if (seq !== saveSeq) return;
      if (result.ok) {
        setStatus('已保存并写回 patchNotes.json', false);
      } else {
        setStatus(`已应用到大厅（未能写回文件：${result.error}）`, true);
      }
    });
    render();
  };

  function setStatus(text: string, isError: boolean): void {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', isError);
  }

  function render(): void {
    if (IS_DEV_SERVER) {
      list.replaceChildren(...drafts.map((note, index) => renderEditorNote(note, index)));
      return;
    }
    list.replaceChildren(...PATCH_NOTES.map(renderNote));
  }

  /** 开发服单条公告：版本/日期可改，条目按行编辑，避免每敲一字就重绘。 */
  function renderEditorNote(note: PatchNote, index: number): HTMLElement {
    const article = document.createElement('article');
    article.className = 'patch-note is-editing';

    const head = document.createElement('header');
    head.className = 'patch-note-head';

    const version = document.createElement('input');
    version.className = 'patch-note-version-input';
    version.type = 'text';
    version.value = note.version;
    version.setAttribute('aria-label', `版本 ${index + 1}`);
    version.addEventListener('input', () => {
      note.version = version.value;
    });

    const date = document.createElement('input');
    date.className = 'patch-note-date-input';
    date.type = 'date';
    date.value = note.date;
    date.setAttribute('aria-label', `日期 ${index + 1}`);
    date.addEventListener('input', () => {
      note.date = date.value;
    });

    const remove = document.createElement('button');
    remove.className = 'patch-note-remove';
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      drafts.splice(index, 1);
      setStatus('已删除该版本，保存后才会写盘', false);
      render();
    });

    head.append(version, date, remove);

    const items = document.createElement('textarea');
    items.className = 'patch-note-items-input';
    items.rows = Math.max(3, note.items.length);
    items.value = note.items.join('\n');
    items.setAttribute('aria-label', `更新条目 ${index + 1}`);
    items.addEventListener('input', () => {
      note.items = items.value.split('\n');
    });

    article.append(head, items);
    return article;
  }

  for (const button of closeButtons) {
    button.addEventListener('click', close);
  }
  addButton?.addEventListener('click', addNote);
  saveButton?.addEventListener('click', save);
  render();

  return {
    open,
    close,
    dispose() {
      stopDragScroll();
      for (const button of closeButtons) {
        button.removeEventListener('click', close);
      }
      addButton?.removeEventListener('click', addNote);
      saveButton?.removeEventListener('click', save);
    },
  };
}

/** 单条版本公告：标题行 + 条目列表。 */
function renderNote(note: PatchNote): HTMLElement {
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

/** 新增版本预填当前构建号与今天日期，条目留空等策划填写。 */
function createBlankNote(): PatchNote {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return {
    version: APP_VERSION.replace(/^v/i, ''),
    date: `${now.getFullYear()}-${month}-${day}`,
    items: [''],
  };
}

/** 隐藏滚动条后用指针拖拽翻看正文；输入框留给编辑，避免和选区抢手势。 */
function enableDragScroll(element: HTMLElement): () => void {
  let pointerId: number | null = null;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('input, textarea, button, a')) return;
    if (element.scrollHeight <= element.clientHeight) return;

    pointerId = event.pointerId;
    lastY = event.clientY;
    element.classList.add('is-dragging');
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // jsdom 没有真实指针捕获，后续仍靠 pointermove 滚动
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    element.scrollTop -= event.clientY - lastY;
    lastY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    element.classList.remove('is-dragging');
    try {
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 同上：测试环境可能没有指针捕获状态
    }
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerUp);
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`更新公告缺少元素：${selector}`);
  return element;
}
