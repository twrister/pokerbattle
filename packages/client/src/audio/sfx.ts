import {
  SFX_DEFS,
  SFX_DIR,
  SFX_DISABLED_STORAGE_KEY,
  SFX_MUTED_STORAGE_KEY,
  type SfxId,
} from './sfxManifest.js';

export type { SfxId } from './sfxManifest.js';
export { SFX_DEFS, SFX_MUTED_STORAGE_KEY, SFX_DISABLED_STORAGE_KEY } from './sfxManifest.js';

/** 单次播放的覆盖参数。 */
export interface SfxPlayOptions {
  /** 相对该音效基础音量的倍率；如范围伤害想更响就传 1.4。 */
  volumeScale?: number;
  /** 指定播放速率（移调）；不传则按 SFX_DEFS 的抖动幅度随机。 */
  rate?: number;
}

/** 便于单测替换的注入点；生产环境全部走默认实现。 */
export interface SfxEngineOptions {
  /** 创建 AudioContext；返回 null 表示环境不支持（如 jsdom、Safari 隐私模式）。 */
  createContext?: () => AudioContext | null;
  /** 拉取音频二进制；默认用 fetch。 */
  loadBytes?: (url: string) => Promise<ArrayBuffer>;
  /** 静音状态读写；默认 localStorage。 */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** 单调时钟；默认 performance.now。 */
  now?: () => number;
  /** 全局同时发声上限；接近满员时后到的音效直接丢弃，防止大混战糊成噪声墙。 */
  maxTotalVoices?: number;
}

/** 浏览器不支持 Web Audio 时的空上下文标记，避免每次播放都重试创建。 */
const UNSUPPORTED = Symbol('unsupported');

/**
 * 极简 Web Audio 音效播放器。
 *
 * 设计取舍：
 * - 只做一次性短音效，不做循环/BGM，所以每个音只用 BufferSource 播完即弃；
 * - 每个音效都有重触发间隔与并发上限，否则几十个单位同时开火会糊成一堵噪声墙；
 * - 所有失败（解码失败、自动播放被拦）都静默跳过，音效永远不该影响对局本身。
 */
export class SfxEngine {
  private readonly options: SfxEngineOptions;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly now: () => number;
  private context: AudioContext | typeof UNSUPPORTED | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  /** 在途加载；用 Promise 复用，试听页替换后 reload 才能等到新文件解码完。 */
  private readonly pendingLoads = new Map<SfxId, Promise<void>>();
  private readonly failed = new Set<SfxId>();
  /** 每个音效的缓存版本号；reload 后加在 URL 上绕开浏览器缓存。 */
  private readonly versions = new Map<SfxId, number>();
  private readonly lastPlayAt = new Map<SfxId, number>();
  private readonly voices = new Map<SfxId, number>();
  /** 每个音效在播的 BufferSource；关掉某个音效时要能立刻把它们停掉。 */
  private readonly activeSources = new Map<SfxId, Set<AudioBufferSourceNode>>();
  /** 当前全部在播实例数；与 voices 之和一致，单独维护便于快速判上限。 */
  private totalVoices = 0;
  private readonly maxTotalVoices: number;
  private muted: boolean;
  /** 被单独关掉的音效；play 时直接跳过，但 buffer 照旧加载，随时开回来就能响。 */
  private readonly disabled = new Set<SfxId>();
  /** 主音量；当前不暴露调节 UI，留作后续接音量滑条。 */
  private masterVolume = 0.7;
  private unlockBound = false;
  /** 静音状态订阅者；大厅设置与局内按钮靠它互相同步。 */
  private readonly listeners = new Set<(muted: boolean) => void>();

  constructor(options: SfxEngineOptions = {}) {
    this.options = options;
    this.storage = options.storage === undefined ? safeLocalStorage() : options.storage;
    this.now = options.now ?? (() => performance.now());
    this.maxTotalVoices = options.maxTotalVoices ?? 12;
    this.muted = this.readMuted();
    this.readDisabled();
  }

  /** 静音状态；UI 按钮据此显示喇叭开/关。 */
  isMuted(): boolean {
    return this.muted;
  }

  /** 切换静音并持久化；返回切换后的状态，方便按钮同步。 */
  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 订阅静音状态变更；返回退订函数。UI 开关据此互相同步。 */
  subscribe(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 设置静音；静音时立刻停掉正在播的实例，避免尾音继续响。 */
  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      this.storage?.setItem(SFX_MUTED_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* 隐私模式下写不进去，只影响下次打开 */
    }
    if (this.master) this.master.gain.value = muted ? 0 : this.masterVolume;
    if (muted) this.stopAllVoices();
    // 统一在 setMuted 通知，toggleMuted 也走这里，避免多个入口各写一遍
    for (const listener of this.listeners) listener(muted);
  }

  /** 单个音效是否允许播放；没有单独关掉就是开着的。 */
  isEnabled(id: SfxId): boolean {
    return !this.disabled.has(id);
  }

  /**
   * 单独开关一个音效；关掉后 play 直接静默跳过，与总静音互不干扰。
   * 状态写入 localStorage，刷新页面后仍然生效。
   */
  setEnabled(id: SfxId, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else {
      this.disabled.add(id);
      // 立刻掐掉在播的实例，否则关掉之后还会把这一声放完
      this.stopVoicesOf(id);
    }
    try {
      this.storage?.setItem(SFX_DISABLED_STORAGE_KEY, JSON.stringify([...this.disabled]));
    } catch {
      /* 同上：写不进去只影响下次打开 */
    }
  }

  /**
   * 预加载全部音效。
   * 解码在 AudioContext 上做，所以即便处于 suspended 也能先备好，等首次交互再出声。
   */
  preloadAll(): void {
    for (const id of Object.keys(SFX_DEFS) as SfxId[]) void this.load(id);
  }

  /**
   * 在用户第一次交互时解锁音频。
   *
   * Chrome/Safari 要求 AudioContext 在用户手势里 resume，否则一直是 suspended。
   * 这里一次性挂 pointerdown/keydown，命中任意一个就摘掉监听。
   */
  attachUnlock(target: Document = document): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = (): void => {
      target.removeEventListener('pointerdown', unlock, true);
      target.removeEventListener('keydown', unlock, true);
      this.unlock();
    };
    target.addEventListener('pointerdown', unlock, true);
    target.addEventListener('keydown', unlock, true);
  }

  /** 主动解锁并创建 AudioContext；返回是否可用。 */
  unlock(): boolean {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return true;
  }

  /**
   * 播放一个音效。
   * 总静音、该音效被单独关掉、超出并发上限或仍在上次重触发间隔内时直接返回，不排队也不延后。
   */
  play(id: SfxId, options: SfxPlayOptions = {}): void {
    if (this.muted) return;
    // 单个音效的开关先判，关掉后连加载都不必再触发
    if (this.disabled.has(id)) return;
    const def = SFX_DEFS[id];
    if (!def) return;
    const at = this.now();
    const last = this.lastPlayAt.get(id);
    if (last !== undefined && def.minIntervalMs > 0 && at - last < def.minIntervalMs) return;
    if ((this.voices.get(id) ?? 0) >= def.maxVoices) return;
    // 全局并发已满：宁可丢这一声，也不让混战把音频线程压垮
    if (this.totalVoices >= this.maxTotalVoices) return;

    const buffer = this.buffers.get(id);
    if (!buffer) {
      // 首次播放时还没解码完：补一个加载请求，本次静默跳过
      void this.load(id);
      return;
    }
    const jitter = def.pitchJitter ?? 0;
    const rate = options.rate ?? (jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1);
    this.playBuffer(id, buffer, def.volume * (options.volumeScale ?? 1), rate);
  }

  /**
   * 真正发声：建 source/gain 接主增益，并维护在播计数。
   * key 为 null 表示试听用的临时 buffer，只计全局并发、不占某个音效的名额。
   * direct 为 true 时跳过主增益（静音也能出声），试听必须能听见才谈得上调整。
   */
  private playBuffer(
    key: SfxId | null,
    buffer: AudioBuffer,
    volume: number,
    rate: number,
    direct = false,
  ): boolean {
    const context = this.ensureContext();
    if (!context || !this.master) return false;
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = clampVolume(volume);
    source.connect(gain).connect(direct ? context.destination : this.master);

    if (key) {
      this.lastPlayAt.set(key, this.now());
      this.voices.set(key, (this.voices.get(key) ?? 0) + 1);
      // 记下在播节点，关掉该音效时可以立刻 stop 掉，而不是等它自己放完
      const set = this.activeSources.get(key) ?? new Set<AudioBufferSourceNode>();
      set.add(source);
      this.activeSources.set(key, set);
    }
    this.totalVoices += 1;

    /** 收尾：把并发名额还回去并断开节点，正常结束与启动失败共用。 */
    let released = false;
    const release = (): void => {
      // stop() 也会触发 onended，用标记保证计数只回收一次
      if (released) return;
      released = true;
      if (key) {
        const remaining = (this.voices.get(key) ?? 1) - 1;
        if (remaining <= 0) this.voices.delete(key);
        else this.voices.set(key, remaining);
        this.activeSources.get(key)?.delete(source);
        if (this.activeSources.get(key)?.size === 0) this.activeSources.delete(key);
      }
      this.totalVoices = Math.max(0, this.totalVoices - 1);
      gain.disconnect();
      source.disconnect();
    };
    source.onended = release;
    try {
      source.start();
      return true;
    } catch {
      // 上下文被关闭等极端情况：把计数还回去，下次还能播
      release();
      return false;
    }
  }

  /**
   * 开发服试听：忽略静音、单个音效开关、重触发间隔与并发上限，按基础音量放一声。
   * 返回值为 true 表示这次真的发出了声音（资源未就绪或环境不支持时为 false）。
   * 关掉的音效也必须能试听，否则没法判断该不该重新打开。
   */
  audition(id: SfxId): boolean {
    const def = SFX_DEFS[id];
    if (!def) return false;
    // 连点不叠加：已有实例在播就当作「正在试听」，避免糊成一片
    if ((this.voices.get(id) ?? 0) > 0) return true;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      // 还没解码好：补一个加载请求，让用户再点一次就能听到
      void this.load(id);
      return false;
    }
    return this.playBuffer(id, buffer, def.volume, 1, true);
  }

  /**
   * 试听用户刚选中的候选文件：只解码播放，不落盘也不占用正式 buffer。
   * 这样「先听再换」不会污染正式音效，取消选择也没有副作用。
   */
  async auditionBytes(bytes: ArrayBuffer, id?: SfxId): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume().catch(() => {});
    try {
      const buffer = await context.decodeAudioData(bytes.slice(0));
      const volume = id ? (SFX_DEFS[id]?.volume ?? 0.5) : 0.5;
      return this.playBuffer(null, buffer, volume, 1, true);
    } catch {
      // 不是合法音频：交给调用方提示，用户可重新选文件
      return false;
    }
  }

  /**
   * 丢弃某个音效的缓存并重新拉取，供开发服替换文件后立刻生效。
   * 加版本号参数绕开浏览器缓存，否则重新 fetch 很可能拿到旧字节。
   */
  async reload(id: SfxId): Promise<boolean> {
    // 旧的加载请求若还在途，等它落地再清缓存，否则旧响应回来会把旧声音塞回去
    const pending = this.pendingLoads.get(id);
    if (pending) await pending;
    this.buffers.delete(id);
    this.failed.delete(id);
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    await this.load(id);
    return this.buffers.has(id);
  }

  /** 是否已解码就绪；试听页据此显示「加载中 / 就绪 / 缺失」。 */
  hasBuffer(id: SfxId): boolean {
    return this.buffers.has(id);
  }

  /** 是否已被判定为加载失败（缺文件或格式不支持）。 */
  hasFailed(id: SfxId): boolean {
    return this.failed.has(id);
  }

  /**
   * 清空在播计数的记录。
   * 已发声的 BufferSource 无法反查，静音由主增益负责；这里主要防止计数残留
   * 把后续播放误判成「已满并发」。
   */
  stopAllVoices(): void {
    this.voices.clear();
    this.activeSources.clear();
    this.totalVoices = 0;
  }

  /**
   * 立刻停掉某个音效的在播实例。
   * 关掉开关时用：正放在半途的爆炸声不会继续响完，计数由 release 统一回收。
   */
  private stopVoicesOf(id: SfxId): void {
    const sources = this.activeSources.get(id);
    if (!sources) return;
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // 尚未 start 或已停止：忽略，计数仍由 onended/release 兜底
      }
    }
  }

  /** 惰性创建 AudioContext 与主增益；不支持时缓存 UNSUPPORTED，不再重试。 */
  private ensureContext(): AudioContext | null {
    if (this.context === UNSUPPORTED) return null;
    if (this.context) return this.context;
    try {
      const context = this.options.createContext
        ? this.options.createContext()
        : createDefaultContext();
      if (!context) {
        this.context = UNSUPPORTED;
        return null;
      }
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : this.masterVolume;
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      return context;
    } catch {
      this.context = UNSUPPORTED;
      return null;
    }
  }

  /** 下载并解码单个音效；重复调用会复用同一份 Promise 结果。 */
  private load(id: SfxId): Promise<void> {
    const pending = this.pendingLoads.get(id);
    if (pending) return pending;
    if (this.buffers.has(id) || this.failed.has(id)) return Promise.resolve();
    const def = SFX_DEFS[id];
    if (!def) return Promise.resolve();
    const context = this.ensureContext();
    if (!context) return Promise.resolve();

    const version = this.versions.get(id) ?? 0;
    // 版本号只在替换过之后才加，正常启动不多带一个查询串
    const suffix = version > 0 ? `?v=${version}` : '';
    const url = `${SFX_DIR}${def.file}.ogg${suffix}`;
    const task = (async (): Promise<void> => {
      try {
        const bytes = this.options.loadBytes
          ? await this.options.loadBytes(url)
          : await fetchBytes(url);
        const buffer = await context.decodeAudioData(bytes);
        this.buffers.set(id, buffer);
      } catch {
        // 缺文件或格式不受支持（如老 Safari 不认 ogg）：标记后不再重试，游戏照常跑
        this.failed.add(id);
      } finally {
        this.pendingLoads.delete(id);
      }
    })();
    this.pendingLoads.set(id, task);
    return task;
  }

  private readMuted(): boolean {
    try {
      return this.storage?.getItem(SFX_MUTED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /**
   * 从存储恢复被单独关掉的音效。
   * 存储里的数据可能被手改或来自旧版本，逐项校验白名单，脏数据直接丢弃。
   */
  private readDisabled(): void {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(SFX_DISABLED_STORAGE_KEY) ?? null;
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (typeof item === 'string' && Object.hasOwn(SFX_DEFS, item)) this.disabled.add(item as SfxId);
      }
    } catch {
      // 非法 JSON：当作没有关闭过任何音效
    }
  }
}

/** 全局单例：所有 UI 与战斗音效都从这里播。 */
export const sfx = new SfxEngine();

/** 把音量夹在 0~1，防止叠了多个倍率后爆音。 */
function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 读取 localStorage；某些内嵌环境访问会抛错。 */
function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 优先用标准 AudioContext，兼容只有 webkit 前缀的旧 Safari。 */
function createDefaultContext(): AudioContext | null {
  const scope = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** 取音频二进制；非 2xx 直接抛错，交给上层标记失败。 */
async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`音效加载失败：${url} (${response.status})`);
  return response.arrayBuffer();
}
