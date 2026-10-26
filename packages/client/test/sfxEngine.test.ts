import { describe, expect, it, vi } from 'vitest';
import { SfxEngine } from '../src/audio/sfx.js';
import { SFX_DIR } from '../src/audio/sfxManifest.js';

interface Harness {
  engine: SfxEngine;
  /** 每次 loadBytes 收到的 URL。 */
  urls: string[];
  /** 累计真正 start 的 BufferSource 数量。 */
  played: { count: number };
  /** 被 stop 掐断的实例数，用于验证关掉开关能立刻停声。 */
  stopped: { count: number };
  /** 每次 playTone 实际起振的振荡器参数，用于验证合成音。 */
  tones: { frequency: number; startedAt: number; stoppedAt: number }[];
}

/** 构造一个够用的 AudioContext 替身，只实现引擎实际调用的方法。 */
function createFakeContext(
  played: { count: number },
  stopped: { count: number },
  decode: () => Promise<AudioBuffer>,
  tones: Harness['tones'],
): AudioContext {
  /** 所有节点共用的空壳；connect 返回对端，够走通链路。 */
  const node = {
    connect: (target: unknown) => target,
    disconnect: () => {},
  };
  /** 音量自动化只需接收调用，不需要真的算包络。 */
  const gainParam = {
    value: 1,
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  };
  return {
    state: 'running',
    currentTime: 0,
    destination: node,
    resume: async () => {},
    createGain: () => ({ ...node, gain: gainParam }),
    createOscillator: () => {
      const record = { frequency: 0, startedAt: 0, stoppedAt: 0 };
      return {
        ...node,
        type: 'sine',
        frequency: { get value() { return record.frequency; }, set value(v: number) { record.frequency = v; } },
        onended: null,
        start: (at: number) => {
          record.startedAt = at;
          tones.push(record);
        },
        stop: (at: number) => {
          record.stoppedAt = at;
        },
      };
    },
    createBufferSource: () => ({
      ...node,
      buffer: null,
      playbackRate: { value: 1 },
      onended: null,
      start: () => {
        played.count += 1;
      },
      stop: () => {
        stopped.count += 1;
      },
    }),
    decodeAudioData: decode,
  } as unknown as AudioContext;
}

/** 造一个引擎：记录 URL、统计发声，decode 行为可通过参数切换。 */
function createHarness(
  decode?: () => Promise<AudioBuffer>,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = null,
  now?: () => number,
): Harness {
  const urls: string[] = [];
  const played = { count: 0 };
  const stopped = { count: 0 };
  const tones: Harness['tones'] = [];
  const engine = new SfxEngine({
    createContext: () =>
      createFakeContext(
        played,
        stopped,
        decode ?? (async () => ({ duration: 1 }) as AudioBuffer),
        tones,
      ),
    loadBytes: async (url) => {
      urls.push(url);
      return new ArrayBuffer(8);
    },
    storage,
    now,
  });
  return { engine, urls, played, stopped, tones };
}

describe('音效引擎的试听与重载', () => {
  it('reload 会带上缓存版本号重新拉取并重新解码', async () => {
    const { engine, urls } = createHarness();
    engine.preloadAll();
    expect(await engine.reload('ui_click')).toBe(true);

    expect(urls[0]).toBe(`${SFX_DIR}ui_click.ogg`);
    expect(urls.at(-1)).toBe(`${SFX_DIR}ui_click.ogg?v=1`);
    expect(engine.hasBuffer('ui_click')).toBe(true);
  });

  it('试听不受静音影响，正常播放仍被拦', async () => {
    const { engine, played } = createHarness();
    engine.preloadAll();
    await engine.reload('explode');
    engine.setMuted(true);

    expect(engine.audition('explode')).toBe(true);
    expect(played.count).toBe(1);

    engine.play('explode');
    expect(played.count).toBe(1);
  });

  it('资源未解码时试听返回 false，并补一次加载', async () => {
    const { engine } = createHarness();
    expect(engine.audition('ui_click')).toBe(false);
    await vi.waitFor(() => expect(engine.hasBuffer('ui_click')).toBe(true));
  });

  it('decode 失败标记 failed，换好文件 reload 后恢复', async () => {
    let broken = true;
    const { engine } = createHarness(async () => {
      if (broken) throw new Error('bad file');
      return { duration: 1 } as AudioBuffer;
    });

    expect(await engine.reload('ui_click')).toBe(false);
    expect(engine.hasFailed('ui_click')).toBe(true);

    broken = false;
    expect(await engine.reload('ui_click')).toBe(true);
    expect(engine.hasFailed('ui_click')).toBe(false);
  });

  it('试听候选字节只发声，不覆盖正式 buffer', async () => {
    const { engine, played, urls } = createHarness();
    engine.preloadAll();
    await engine.reload('ui_click');
    const before = urls.length;

    expect(await engine.auditionBytes(new ArrayBuffer(8), 'ui_click')).toBe(true);
    expect(played.count).toBe(1);
    expect(urls.length).toBe(before);
  });
});

describe('单个音效开关', () => {
  it('默认开启，关掉后 play 不发声、开回来立刻恢复', async () => {
    const { engine, played } = createHarness();
    engine.preloadAll();
    await engine.reload('ui_click');
    expect(engine.isEnabled('ui_click')).toBe(true);

    engine.setEnabled('ui_click', false);
    expect(engine.isEnabled('ui_click')).toBe(false);
    engine.play('ui_click');
    expect(played.count).toBe(0);

    engine.setEnabled('ui_click', true);
    engine.play('ui_click');
    expect(played.count).toBe(1);
  });

  it('关掉某个音效不影响其它音效', async () => {
    const { engine, played } = createHarness();
    engine.preloadAll();
    await engine.reload('explode');
    await engine.reload('arrow');

    engine.setEnabled('explode', false);
    engine.play('explode');
    engine.play('arrow');

    expect(played.count).toBe(1);
  });

  it('关掉时掐断在播实例，避免静音后还响完', async () => {
    // 用可推进的时钟，绕开 explode 的 140ms 重触发间隔
    let clock = 0;
    const { engine, played, stopped } = createHarness(undefined, null, () => (clock += 1000));
    engine.preloadAll();
    await engine.reload('explode');

    engine.play('explode');
    expect(played.count).toBe(1);

    engine.setEnabled('explode', false);
    expect(stopped.count).toBe(1);
    // 在播名额已回收，开回来后还能正常再播
    engine.setEnabled('explode', true);
    engine.play('explode');
    expect(played.count).toBe(2);
  });

  it('试听不受开关影响，便于对比后再决定是否开启', async () => {
    const { engine, played } = createHarness();
    engine.preloadAll();
    await engine.reload('ui_click');
    engine.setEnabled('ui_click', false);

    expect(engine.audition('ui_click')).toBe(true);
    expect(played.count).toBe(1);
  });

  it('关闭状态写入存储，新引擎实例恢复后依旧静默', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };

    const first = createHarness(undefined, storage);
    first.engine.preloadAll();
    await first.engine.reload('ui_click');
    first.engine.setEnabled('ui_click', false);

    const second = createHarness(undefined, storage);
    second.engine.preloadAll();
    await second.engine.reload('ui_click');
    expect(second.engine.isEnabled('ui_click')).toBe(false);
    second.engine.play('ui_click');
    expect(second.played.count).toBe(0);
  });

  it('存储里的脏数据被忽略，不会误关音效', () => {
    const storage = {
      getItem: (key: string) => (key === 'pb.sfx.disabled' ? '["ui_click","not-a-sfx",42]' : null),
      setItem: () => {},
    };
    const { engine } = createHarness(undefined, storage);

    expect(engine.isEnabled('ui_click')).toBe(false);
    expect(engine.isEnabled('explode')).toBe(true);
  });
});

describe('合成提示音', () => {
  it('按给定频率起振并按音量包络收尾', () => {
    const { engine, tones } = createHarness();

    expect(engine.playTone({ frequency: 880, durationMs: 120, volume: 0.2 })).toBe(true);
    expect(tones.length).toBe(1);
    expect(tones[0]!.frequency).toBe(880);
    // stop 时间应落在音头后的 120ms，过长会拖尾盖住下一声
    expect(tones[0]!.stoppedAt - tones[0]!.startedAt).toBeCloseTo(0.12, 5);
  });

  it('总静音时不出声，也不占音频上下文', () => {
    const { engine, tones } = createHarness();
    engine.setMuted(true);

    expect(engine.playTone({ frequency: 1320, durationMs: 160 })).toBe(false);
    expect(tones.length).toBe(0);
  });

  it('不受单个音效开关影响，因为它不是资源音效', async () => {
    const { engine, tones } = createHarness();
    engine.setEnabled('ui_click', false);

    expect(engine.playTone({ frequency: 880, durationMs: 110 })).toBe(true);
    expect(tones.length).toBe(1);
    // 合成音不该触发任何素材下载
    expect(engine.hasBuffer('ui_click')).toBe(false);
  });
});
