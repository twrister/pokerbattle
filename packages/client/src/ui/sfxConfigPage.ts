import { sfx } from '../audio/sfx.js';
import {
  SFX_DEFS,
  SFX_DIR,
  SFX_GROUP_LABELS,
  SFX_GROUP_ORDER,
  SFX_META,
  type SfxGroup,
  type SfxId,
} from '../audio/sfxManifest.js';

export interface SfxConfigPageOptions {
  onBack: () => void;
}

export interface SfxConfigPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 每行一个音效；candidate 是用户已选中但还没写盘的候选文件。 */
interface RowState {
  row: HTMLElement;
  /** 单个音效的开关；关掉后局内不再播放，但试听仍然可用。 */
  toggleButton: HTMLButtonElement;
  auditionButton: HTMLButtonElement;
  pickButton: HTMLButtonElement;
  replaceButton: HTMLButtonElement;
  sizeLabel: HTMLElement;
  candidate: ArrayBuffer | null;
  candidateName: string;
  busy: boolean;
}

/** 开发服试听页的上传接口；preview/build 下不存在（404），只影响替换按钮。 */
const SFX_UPLOAD_URL = '/__pb/sfx';

/**
 * 开发服音效调整页。
 *
 * 只做三件事：试听全部音效、挑一个本地 .ogg 试听候选、确认后写回 public/sfx。
 * 写盘成功后立刻让引擎丢掉旧缓存重载，改完不用刷新页面。
 */
export function createSfxConfigPage(options: SfxConfigPageOptions): SfxConfigPageHandle {
  const root = required<HTMLElement>('#sfx-config');
  const backButton = required<HTMLButtonElement>('#btn-sfx-config-back', root);
  const listRoot = required<HTMLElement>('#sfx-config-list', root);
  const statusEl = required<HTMLElement>('#sfx-config-status', root);

  const rows = new Map<SfxId, RowState>();
  const disposers: Array<() => void> = [];

  const setStatus = (text: string, tone?: 'ok' | 'error'): void => {
    statusEl.textContent = text;
    if (tone) statusEl.dataset.tone = tone;
    else delete statusEl.dataset.tone;
  };

  /** 首次打开才建列表：页面默认隐藏，没必要进大厅就摆 26 行 DOM。 */
  const buildList = (): void => {
    if (rows.size > 0) return;
    for (const group of SFX_GROUP_ORDER) listRoot.append(buildGroup(group));
  };

  /** 生成一个分组的标题与行。 */
  function buildGroup(group: SfxGroup): HTMLElement {
    const section = document.createElement('section');
    section.className = 'sfx-config-group';
    const title = document.createElement('h2');
    title.textContent = SFX_GROUP_LABELS[group];
    section.append(title);
    for (const id of Object.keys(SFX_META) as SfxId[]) {
      if (SFX_META[id].group !== group) continue;
      section.append(buildRow(id));
    }
    return section;
  }

  /** 生成单个音效行并绑定它自己的开关与三个操作按钮。 */
  function buildRow(id: SfxId): HTMLElement {
    const def = SFX_DEFS[id];
    const row = document.createElement('div');
    row.className = 'sfx-config-row';
    row.dataset.id = id;

    const main = document.createElement('div');
    main.className = 'sfx-config-row-main';
    const label = document.createElement('span');
    label.className = 'sfx-config-row-label';
    label.textContent = SFX_META[id].label;
    const detail = document.createElement('span');
    detail.className = 'sfx-config-row-detail';
    // 让调音的人一眼看到这个音效的基础音量与并发上限
    detail.textContent = `${id} · ${def.file}.ogg · 音量 ${def.volume} · 并发 ${def.maxVoices}`;
    main.append(label, detail);

    // 开关：关掉后局内不再播放该音效，但试听仍然可用，方便对比后再决定要不要开回来
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'sfx-config-toggle';
    toggleButton.dataset.sfx = 'none';

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'sfx-config-row-size';
    sizeLabel.textContent = '—';

    const actions = document.createElement('div');
    actions.className = 'sfx-config-row-actions';
    const auditionButton = document.createElement('button');
    auditionButton.type = 'button';
    auditionButton.dataset.sfx = 'none';
    auditionButton.textContent = '试听';
    const pickButton = document.createElement('button');
    pickButton.type = 'button';
    pickButton.textContent = '选择文件';
    const replaceButton = document.createElement('button');
    replaceButton.type = 'button';
    replaceButton.textContent = '替换';
    replaceButton.disabled = true;
    replaceButton.classList.add('is-disabled');
    actions.append(auditionButton, pickButton, replaceButton);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ogg,audio/ogg';
    input.className = 'sfx-config-file';
    input.hidden = true;

    row.append(main, toggleButton, sizeLabel, actions, input);

    const state: RowState = {
      row,
      toggleButton,
      auditionButton,
      pickButton,
      replaceButton,
      sizeLabel,
      candidate: null,
      candidateName: '',
      busy: false,
    };
    rows.set(id, state);
    syncToggle(state, id);

    const onToggle = (): void => {
      // 以引擎里的状态为准取反，页面上多处入口不会各自记一份
      sfx.setEnabled(id, !sfx.isEnabled(id));
      syncToggle(state, id);
      setStatus(
        sfx.isEnabled(id) ? `已开启：${SFX_META[id].label}` : `已关闭：${SFX_META[id].label}（局内不再播放）`,
        'ok',
      );
    };
    const onAudition = (): void => void audition(id);
    const onPick = (): void => input.click();
    const onReplace = (): void => void replace(id);
    const onFile = (): void => void readCandidate(id, input);

    toggleButton.addEventListener('click', onToggle);
    auditionButton.addEventListener('click', onAudition);
    pickButton.addEventListener('click', onPick);
    replaceButton.addEventListener('click', onReplace);
    input.addEventListener('change', onFile);
    disposers.push(() => toggleButton.removeEventListener('click', onToggle));
    disposers.push(() => auditionButton.removeEventListener('click', onAudition));
    disposers.push(() => pickButton.removeEventListener('click', onPick));
    disposers.push(() => replaceButton.removeEventListener('click', onReplace));
    disposers.push(() => input.removeEventListener('change', onFile));

    return row;
  }

  /** 按引擎状态刷新开关文案与行内暗化；关闭态一眼可辨。 */
  function syncToggle(state: RowState, id: SfxId): void {
    const enabled = sfx.isEnabled(id);
    state.toggleButton.textContent = enabled ? '开' : '关';
    // aria-pressed 表示「是否开启」，与按钮文案同向；配色也由它驱动，样式统一在一个地方
    state.toggleButton.setAttribute('aria-pressed', String(enabled));
    state.toggleButton.setAttribute('aria-label', `${SFX_META[id].label} ${enabled ? '已开启，点击关闭' : '已关闭，点击开启'}`);
    state.row.classList.toggle('is-off', !enabled);
  }

  /** 试听：已选候选就听候选，否则听线上原音，方便对比。 */
  const audition = async (id: SfxId): Promise<void> => {
    const state = rows.get(id);
    if (!state || state.busy) return;
    if (state.candidate) {
      const ok = await sfx.auditionBytes(state.candidate.slice(0), id);
      setStatus(ok ? `正在试听候选：${state.candidateName}` : '候选文件无法解码，换一个 .ogg 试试', ok ? 'ok' : 'error');
      return;
    }
    const played = sfx.audition(id);
    setStatus(
      played ? `正在试听：${SFX_META[id].label}` : `${SFX_META[id].label} 尚未解码完成，稍后再点一次`,
      played ? 'ok' : 'error',
    );
  };

  /** 读入选中的文件；只做本地缓存，点「替换」才真正写盘。 */
  const readCandidate = async (id: SfxId, input: HTMLInputElement): Promise<void> => {
    const state = rows.get(id);
    const file = input.files?.[0];
    if (!state || !file) return;
    // 选完清空 value，重复选同一个文件也能触发 change
    input.value = '';
    try {
      state.candidate = await file.arrayBuffer();
      state.candidateName = file.name;
      state.pickButton.textContent = `已选：${file.name}`;
      state.auditionButton.textContent = '试听候选';
      state.replaceButton.disabled = false;
      state.replaceButton.classList.remove('is-disabled');
      setStatus(`已选 ${file.name}（${formatBytes(file.size)}），可先试听候选再替换`, 'ok');
    } catch {
      setStatus('读取文件失败，重新选一次', 'error');
    }
  };

  /** 写盘并让引擎重载；成功后清掉候选，按钮回到初始态。 */
  const replace = async (id: SfxId): Promise<void> => {
    const state = rows.get(id);
    if (!state || state.busy || !state.candidate) return;
    state.busy = true;
    state.replaceButton.disabled = true;
    state.replaceButton.classList.add('is-disabled');
    setStatus(`正在写入 ${SFX_DEFS[id].file}.ogg…`);
    try {
      await uploadSfx(id, state.candidate);
      const reloaded = await sfx.reload(id);
      state.candidate = null;
      state.candidateName = '';
      state.pickButton.textContent = '选择文件';
      state.auditionButton.textContent = '试听';
      await refreshSize(id);
      setStatus(
        reloaded
          ? `已替换 ${SFX_DEFS[id].file}.ogg，可直接试听；记得提交 public/sfx 的改动`
          : `已写入 ${SFX_DEFS[id].file}.ogg，但重新解码失败，请确认文件可用`,
        reloaded ? 'ok' : 'error',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      state.busy = false;
      // 失败时保留候选，玩家可换个文件或直接重试
      if (!state.candidate) {
        state.replaceButton.disabled = true;
        state.replaceButton.classList.add('is-disabled');
      } else {
        state.replaceButton.disabled = false;
        state.replaceButton.classList.remove('is-disabled');
      }
    }
  };

  /** 读一次线上文件体积；拿不到就显示就绪/缺失状态，不影响试听。 */
  const refreshSize = async (id: SfxId): Promise<void> => {
    const state = rows.get(id);
    if (!state) return;
    try {
      const res = await fetch(`${SFX_DIR}${SFX_DEFS[id].file}.ogg`, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) throw new Error('missing');
      const length = Number(res.headers.get('content-length') ?? '0');
      state.sizeLabel.textContent = length > 0 ? formatBytes(length) : '就绪';
    } catch {
      state.sizeLabel.textContent = sfx.hasFailed(id) ? '缺失' : '—';
    }
  };

  /** 打开时刷新体积列；串行 await 避免一次打出几十个并发请求。 */
  const refreshAllSizes = async (): Promise<void> => {
    for (const id of rows.keys()) await refreshSize(id);
  };

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);

  return {
    show() {
      buildList();
      // 重进页面时按引擎当前状态刷新一遍开关，避免显示成旧状态
      for (const [id, state] of rows) syncToggle(state, id);
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      setStatus('每行开关控制局内是否播放；关闭后仍可试听，便于对比');
      void refreshAllSizes();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      backButton.removeEventListener('click', back);
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      rows.clear();
      listRoot.replaceChildren();
    },
  };
}

/** POST 原始二进制写盘；失败时把服务端原因抛给调用方展示。 */
async function uploadSfx(id: SfxId, bytes: ArrayBuffer): Promise<void> {
  const res = await fetch(`${SFX_UPLOAD_URL}?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ogg' },
    body: bytes,
  });
  if (res.ok) return;
  if (res.status === 404) {
    // 正式服没有这个中间件，说明用错了环境
    throw new Error('当前环境不支持写盘，请用 pnpm dev 打开开发服');
  }
  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) detail = body.error;
  } catch {
    /* 非 JSON 响应：保留状态码 */
  }
  throw new Error(`替换失败：${detail}`);
}

/** 体积展示：小于 1 KB 用字节，其余保留一位小数。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`音效调整页缺少元素：${selector}`);
  return element;
}
