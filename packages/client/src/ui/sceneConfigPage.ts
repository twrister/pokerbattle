import {
  applyArenaConfigDraft,
  captureArenaConfigAsDefault,
  dumpArenaConfigDraft,
  dumpDefaultArenaConfigDraft,
  resetArenaConfigToDefault,
  resolveSideBasePositions,
  validateArenaConfigDraft,
  type MatchMode,
  type ArenaCameraMode,
  type ArenaColorsDraft,
  type ArenaConfigDraft,
} from '@pb/sim';
import { syncArenaCoords } from '../view/coords.js';
import { createScenePreview } from '../view/scenePreview.js';

export interface SceneConfigPageOptions {
  onBack: () => void;
  /** 保存或局内实时 apply 后回调（重建当前战场镜头/地形）。 */
  onApplied?: () => void;
}

export interface SceneConfigPageHandle {
  show(): void;
  /** 战场入口：盖在 HUD 上，不切换 AppScreen。 */
  showAsOverlay(): void;
  hide(): void;
  setOnApplied(onApplied: () => void): void;
  dispose(): void;
}

const COLOR_FIELDS: ReadonlyArray<{ key: keyof ArenaColorsDraft; label: string }> = [
  { key: 'background', label: '背景' },
  { key: 'ground', label: '地面' },
  { key: 'river', label: '河道' },
  { key: 'bridge', label: '桥面' },
  { key: 'grid', label: '网格' },
  { key: 'border', label: '边框' },
];

/** 图鉴入口的场景配置页：左侧 3D 预览，右侧表单，保存写回 arena.json。 */
export function createSceneConfigPage(options: SceneConfigPageOptions): SceneConfigPageHandle {
  const root = required<HTMLElement>('#scene-config');
  const backButton = required<HTMLButtonElement>('#btn-scene-config-back', root);
  const saveButton = required<HTMLButtonElement>('#btn-scene-config-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-scene-config-reset', root);
  const statusEl = required<HTMLElement>('#scene-config-status', root);
  const previewRoot = required<HTMLElement>('#scene-config-preview', root);
  const formRoot = required<HTMLElement>('#scene-config-form', root);

  let editMode: MatchMode = '1v1';
  let drafts = dumpArenaConfigDraft(editMode);
  let saveSeq = 0;
  const mode1v1 = required<HTMLButtonElement>('#btn-scene-mode-1v1', root);
  const mode2v2 = required<HTMLButtonElement>('#btn-scene-mode-2v2', root);
  let overlayMode = false;
  let onApplied = options.onApplied ?? (() => {});
  let preview: ReturnType<typeof createScenePreview> | null = null;

  const back = (): void => {
    if (overlayMode) {
      hide();
      return;
    }
    options.onBack();
  };
  backButton.addEventListener('click', back);
  saveButton.addEventListener('click', () => void save());
  resetButton.addEventListener('click', reset);
  mode1v1.addEventListener('click', () => switchEditMode('1v1'));
  mode2v2.addEventListener('click', () => switchEditMode('2v2'));
  formRoot.addEventListener('input', onFormChange);
  formRoot.addEventListener('change', onFormChange);

  /** 首次打开再创建 WebGL 预览，避免进游戏就占一块上下文。 */
  function ensurePreview(): NonNullable<typeof preview> {
    if (!preview) preview = createScenePreview(previewRoot);
    return preview;
  }

  function onFormChange(): void {
    readFormIntoDraft();
    const error = validateArenaConfigDraft(drafts);
    if (error) {
      setStatus(error, true);
      return;
    }
    if (overlayMode) {
      applyLiveToBattle();
      return;
    }
    setStatus('未保存的修改会立刻反映在预览中', false);
    ensurePreview().applyDraft(drafts);
  }

  function show(): void {
    showInternal(false);
  }

  /** 战场入口：右侧表单，左侧露出对局画面方便对照镜头。 */
  function showAsOverlay(): void {
    showInternal(true);
  }

  function showInternal(asOverlay: boolean): void {
    overlayMode = asOverlay;
    drafts = dumpArenaConfigDraft(editMode);
    writeFormFromDraft();
    syncModeButtons();
    root.classList.toggle('is-overlay', asOverlay);
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
    backButton.textContent = asOverlay ? '关闭' : '返回图鉴';
    if (asOverlay) {
      setStatus('改动会立刻应用到当前对局；保存才写回文件。场地尺寸下一局寻路才同步。', false);
      return;
    }
    setStatus('改完点保存写回配置文件', false);
    const view = ensurePreview();
    view.resize();
    view.applyDraft(drafts);
  }

  function hide(): void {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
    root.classList.remove('is-overlay');
    overlayMode = false;
    backButton.textContent = '返回图鉴';
  }

  /** 局内改表单时立刻 apply 并重建战场镜头/颜色，不写盘。 */
  function applyLiveToBattle(): void {
    try {
      applyArenaConfigDraft(drafts, editMode);
      syncArenaCoords();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
      return;
    }
    onApplied();
    setStatus('已应用到当前对局（未写盘）', false);
  }

  /** 应用到运行时并尝试写回 arena.json。 */
  async function save(): Promise<void> {
    readFormIntoDraft();
    const error = validateArenaConfigDraft(drafts);
    if (error) {
      setStatus(error, true);
      return;
    }
    try {
      applyArenaConfigDraft(drafts, editMode);
      syncArenaCoords();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
      return;
    }
    const seq = ++saveSeq;
    const result = await persistArenaConfig(drafts, editMode);
    if (seq !== saveSeq) return;
    if (result.ok) {
      captureArenaConfigAsDefault(editMode);
      drafts = dumpArenaConfigDraft(editMode);
      const fileName = editMode === '2v2' ? 'arena2v2.json' : 'arena.json';
      setStatus(overlayMode ? `已保存并写回 ${fileName}，当前对局已更新` : `已保存并写回 ${fileName}`, false);
    } else {
      setStatus(`已应用到运行时（未能写回文件：${result.error}）`, true);
    }
    if (overlayMode) onApplied();
    else ensurePreview().applyDraft(drafts);
  }

  function reset(): void {
    resetArenaConfigToDefault(editMode);
    syncArenaCoords();
    drafts = dumpDefaultArenaConfigDraft(editMode);
    writeFormFromDraft();
    if (overlayMode) {
      onApplied();
      setStatus('已恢复快照并应用到当前对局', false);
      return;
    }
    ensurePreview().applyDraft(drafts);
    setStatus('已恢复为最近一次配置文件快照', false);
  }

  function switchEditMode(mode: MatchMode): void {
    if (mode === editMode) return;
    editMode = mode;
    drafts = dumpArenaConfigDraft(mode);
    writeFormFromDraft();
    syncModeButtons();
    if (overlayMode) {
      applyLiveToBattle();
      return;
    }
    ensurePreview().applyDraft(drafts);
    setStatus(mode === '2v2' ? '正在编辑 2v2 场景' : '正在编辑 1v1 场景', false);
  }

  function syncModeButtons(): void {
    mode1v1.classList.toggle('is-active', editMode === '1v1');
    mode2v2.classList.toggle('is-active', editMode === '2v2');
  }

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.dataset.tone = isError ? 'error' : 'ok';
  }

  function readFormIntoDraft(): void {
    drafts.width = readInt('#scene-width', drafts.width);
    drafts.height = readInt('#scene-height', drafts.height);
    drafts.riverWidth = readInt('#scene-river-width', drafts.riverWidth);
    drafts.camera.mode = readCameraMode();
    drafts.camera.fov = readNumber('#scene-fov', drafts.camera.fov);
    drafts.camera.distance = readNumber('#scene-distance', drafts.camera.distance);
    drafts.camera.offsetY = readNumber('#scene-offset-y', drafts.camera.offsetY);
    drafts.camera.angleDeg = readNumber('#scene-angle', drafts.camera.angleDeg);
    drafts.camera.bottomExtra = readNumber('#scene-bottom-extra', drafts.camera.bottomExtra);
    drafts.bases = readBases();
    drafts.bridge3Enabled = required<HTMLInputElement>('#scene-bridge3-enabled', formRoot).checked;
    drafts.bridges = readBridges();
    toggleBridge3Row();
    for (const field of COLOR_FIELDS) {
      const input = required<HTMLInputElement>(`#scene-color-${field.key}`, formRoot);
      drafts.colors[field.key] = input.value;
    }
    toggleCameraFields();
  }

  function writeFormFromDraft(): void {
    writeNumber('#scene-width', drafts.width);
    writeNumber('#scene-height', drafts.height);
    writeNumber('#scene-river-width', drafts.riverWidth);
    const modeSelect = required<HTMLSelectElement>('#scene-camera-mode', formRoot);
    modeSelect.value = drafts.camera.mode;
    writeNumber('#scene-fov', drafts.camera.fov);
    writeNumber('#scene-distance', drafts.camera.distance);
    writeNumber('#scene-offset-y', drafts.camera.offsetY);
    writeNumber('#scene-angle', drafts.camera.angleDeg);
    writeNumber('#scene-bottom-extra', drafts.camera.bottomExtra);
    writeBases(drafts);
    required<HTMLInputElement>('#scene-bridge3-enabled', formRoot).checked = drafts.bridge3Enabled;
    writeBridges(drafts);
    toggleBridge3Row();
    for (const field of COLOR_FIELDS) {
      const input = required<HTMLInputElement>(`#scene-color-${field.key}`, formRoot);
      input.value = drafts.colors[field.key];
    }
    toggleCameraFields();
  }

  function toggleCameraFields(): void {
    const isPerspective = readCameraMode() === 'perspective';
    required<HTMLElement>('#scene-fov-row', formRoot).hidden = !isPerspective;
    required<HTMLElement>('#scene-distance-row', formRoot).hidden = !isPerspective;
    required<HTMLElement>('#scene-offset-y-row', formRoot).hidden = !isPerspective;
    required<HTMLElement>('#scene-bottom-extra-row', formRoot).hidden = isPerspective;
  }

  function readCameraMode(): ArenaCameraMode {
    const value = required<HTMLSelectElement>('#scene-camera-mode', formRoot).value;
    return value === 'perspective' ? 'perspective' : 'ortho';
  }

  function readBridges(): ArenaConfigDraft['bridges'] {
    const rows = Array.from(formRoot.querySelectorAll<HTMLElement>('[data-bridge-row]'));
    return rows.map((row) => {
      const minX = Number.parseInt(row.querySelector<HTMLInputElement>('[data-bridge-min]')?.value ?? '0', 10);
      const width = Number.parseInt(row.querySelector<HTMLInputElement>('[data-bridge-width]')?.value ?? '1', 10);
      return { minX, maxX: minX + width };
    });
  }

  function writeBridges(draft: ArenaConfigDraft): void {
    const list = required<HTMLElement>('#scene-bridge-list', formRoot);
    list.replaceChildren();
    draft.bridges.forEach((bridge, index) => {
      const row = document.createElement('div');
      row.className = 'scene-config-row';
      row.dataset.bridgeRow = String(index);
      row.innerHTML = `
        <label>桥 ${index + 1} 位置
          <input data-bridge-min type="number" min="0" step="1" value="${bridge.minX}" />
        </label>
        <label>宽度
          <input data-bridge-width type="number" min="1" step="1" value="${bridge.maxX - bridge.minX}" />
        </label>
      `;
      list.append(row);
    });
  }

  /** 桥三关闭时仍保留坐标，只锁第三行避免误改。 */
  function toggleBridge3Row(): void {
    const enabled = required<HTMLInputElement>('#scene-bridge3-enabled', formRoot).checked;
    const row = formRoot.querySelector<HTMLElement>('[data-bridge-row="2"]');
    row?.querySelectorAll('input').forEach((input) => {
      input.disabled = !enabled;
    });
  }

  function expectedBaseCount(): number {
    return editMode === '2v2' ? 2 : 1;
  }

  function readBases(): ArenaConfigDraft['bases'] {
    const rows = Array.from(formRoot.querySelectorAll<HTMLElement>('[data-base-row]'));
    return rows.map((row) => {
      const x = Number.parseFloat(row.querySelector<HTMLInputElement>('[data-base-x]')?.value ?? '0');
      const y = Number.parseFloat(row.querySelector<HTMLInputElement>('[data-base-y]')?.value ?? '0');
      return { x, y };
    });
  }

  /** 按当前编辑模式生成单边基地行；2v2 两座，对岸开局时镜像。 */
  function writeBases(draft: ArenaConfigDraft): void {
    const list = required<HTMLElement>('#scene-base-list', formRoot);
    list.replaceChildren();
    const count = expectedBaseCount();
    const bases = resolveSideBasePositions(draft, count);
    bases.forEach((base, index) => {
      const row = document.createElement('div');
      row.className = 'scene-config-row';
      row.dataset.baseRow = String(index);
      const title = count === 1 ? '基地' : `基地 ${index + 1}`;
      row.innerHTML = `
        <label>${title} X
          <input data-base-x type="number" min="0" step="0.5" value="${base.x}" />
        </label>
        <label>Y（单边）
          <input data-base-y type="number" min="0" step="0.5" value="${base.y}" />
        </label>
      `;
      list.append(row);
    });
  }

  function readInt(selector: string, fallback: number): number {
    const value = Number.parseInt(required<HTMLInputElement>(selector, formRoot).value, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function readNumber(selector: string, fallback: number): number {
    const value = Number.parseFloat(required<HTMLInputElement>(selector, formRoot).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function writeNumber(selector: string, value: number): void {
    required<HTMLInputElement>(selector, formRoot).value = String(value);
  }

  return {
    show,
    showAsOverlay,
    hide,
    setOnApplied(next) {
      onApplied = next;
    },
    dispose() {
      backButton.removeEventListener('click', back);
      preview?.dispose();
    },
  };
}

/** 开发服务器负责源码写盘，静态构建中该请求会失败并由调用方明确提示。 */
async function persistArenaConfig(
  draft: ArenaConfigDraft,
  mode: MatchMode = '1v1',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/__pb/arena-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, draft }),
    });
    if (!response.ok) {
      if (response.status === 404) return { ok: false, error: '需在 pnpm dev 下保存' };
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}
