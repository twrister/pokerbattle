import type { ExplosionEffectSnapshot, Snapshot, UnitSnapshot } from '@pb/sim';
import { sfx } from './sfx.js';
import type { SfxId } from './sfxManifest.js';

/** 播放函数签名；单测里替换成收集器，避免真的去碰 Web Audio。 */
export type SfxPlayer = (id: SfxId, options?: { volumeScale?: number }) => void;

export interface BattleSfxOptions {
  /** 播放实现；默认用全局 sfx。 */
  play?: SfxPlayer;
  /** 投送音的合并窗口，避免一次出多兵种像放鞭炮。 */
  crowdWindowMs?: number;
  /** 受击音的合并窗口；比投送更密，单独放宽。 */
  hitWindowMs?: number;
  /** 时钟；默认 performance.now，供单测注入。 */
  now?: () => number;
}

/**
 * 爆炸特效种类到听感的映射：巨型炸弹与连锁爆炸比普通爆炸更闷更重。
 *
 * 取值为 null 表示这类特效只出画面不出声。explode4 目前只有单位阵亡会生成
 * （见 sim 的 cleanup.ts；弹道命中特效由 PROJECTILE_EXPLOSION_FX_ENABLED 关闭），
 * 群战里一次倒一片时连续爆炸会盖住受击与技能音，所以静音，阵亡本身仍由 'death' 提示。
 * 若将来重新打开弹道命中特效，需要区分来源、只对阵亡静音。
 */
const EXPLOSION_SFX: Readonly<Record<ExplosionEffectSnapshot['kind'], SfxId | null>> = {
  normal: 'explode',
  giant_bomb: 'explode_big',
  explode2: 'explode_big',
  explode4: null,
  blood3: 'hit_big',
};

/**
 * 用「快照差分」驱动战斗音效。
 *
 * 逻辑层没有事件总线，但每 tick 的快照已经带齐了可听事件：
 * 新增的弹道/爆炸/脉冲 id 就是「刚发生」，新出现的单位是「刚投送」，
 * 从快照里消失的单位就是「刚阵亡」。这样音效与画面天然同源，也不会重复触发。
 */
export class BattleSfx {
  private readonly play: SfxPlayer;
  private readonly crowdWindowMs: number;
  private readonly hitWindowMs: number;
  private readonly now: () => number;
  /** 上次处理的逻辑帧；同一 tick 内 rAF 会多次渲染，必须去重。 */
  private lastTick = -1;
  /** 首帧只建索引不出声，避免进局瞬间噼里啪啦。 */
  private primed = false;
  /** 上一帧的单位表：既判「是否刚受击」，也判阵亡的是不是建筑。 */
  private readonly unitById = new Map<number, UnitSnapshot>();
  private readonly projectileIds = new Set<number>();
  private readonly explosionIds = new Set<number>();
  private readonly pulseIds = new Set<number>();
  private readonly healIds = new Set<number>();
  private lastCrowdAt = -Infinity;
  private lastHitAt = -Infinity;

  constructor(options: BattleSfxOptions = {}) {
    this.play = options.play ?? ((id, opts) => sfx.play(id, opts));
    this.crowdWindowMs = options.crowdWindowMs ?? 90;
    this.hitWindowMs = options.hitWindowMs ?? 150;
    this.now = options.now ?? (() => performance.now());
  }

  /**
   * 每帧喂入当前快照。
   * 只有 tick 前进时才真正比对，同一 tick 的重复调用立即返回。
   */
  onSnapshot(curr: Snapshot): void {
    if (curr.tick === this.lastTick) return;
    this.lastTick = curr.tick;

    if (!this.primed) {
      this.primes(curr);
      this.primed = true;
      return;
    }

    this.diffUnits(curr);
    this.diffProjectiles(curr);
    this.diffExplosions(curr);
    this.diffAoePulses(curr);
    this.diffHeals(curr);
    this.primes(curr);
  }

  /** 换局/回放跳段时清空索引，下一帧重新静默建索引。 */
  reset(): void {
    this.lastTick = -1;
    this.primed = false;
    this.unitById.clear();
    this.projectileIds.clear();
    this.explosionIds.clear();
    this.pulseIds.clear();
    this.healIds.clear();
    this.lastCrowdAt = -Infinity;
    this.lastHitAt = -Infinity;
  }

  /** 单位增减与命中：投送、受击、阵亡都在这里判。 */
  private diffUnits(curr: Snapshot): void {
    for (const unit of curr.units) {
      const before = this.unitById.get(unit.id);
      if (!before) {
        this.playCrowd('spawn');
        continue;
      }
      if (unit.hit && !before.hit) this.playHit(unit.aoeHit ? 'hit_big' : 'hit', unit.aoeHit ? 1 : 0.85);
    }
    // 上一帧有、这一帧没有 = 阵亡；有占地的按建筑倒塌声处理
    const alive = new Set(curr.units.map((unit) => unit.id));
    for (const [id, before] of this.unitById) {
      if (alive.has(id)) continue;
      this.play(before.footprint > 0 ? 'building_down' : 'death');
    }
  }

  /** 弹道新增：按外观分开箭矢 / 投弹 / 法球三种听感。 */
  private diffProjectiles(curr: Snapshot): void {
    for (const projectile of curr.projectiles) {
      if (this.projectileIds.has(projectile.id)) continue;
      if (projectile.visual === 'arrow') this.play('arrow');
      else if (projectile.visual === 'bomb') this.play('bomb_toss');
      else this.play('magic');
    }
  }

  /** 爆炸按种类分档，血溅音更轻一些；未配置音效的种类（如单位阵亡特效）只出画面。 */
  private diffExplosions(curr: Snapshot): void {
    for (const effect of curr.explosionEffects) {
      if (this.explosionIds.has(effect.id)) continue;
      const id = EXPLOSION_SFX[effect.kind];
      if (!id) continue;
      this.play(id, { volumeScale: effect.kind === 'blood3' ? 0.8 : 1 });
    }
  }

  /** 近战整圆与冲刺扇形都配一声挥砍。 */
  private diffAoePulses(curr: Snapshot): void {
    for (const effect of curr.aoePulseEffects) {
      if (this.pulseIds.has(effect.id)) continue;
      this.play('melee');
    }
  }

  private diffHeals(curr: Snapshot): void {
    for (const effect of curr.healEffects) {
      if (this.healIds.has(effect.id)) continue;
      this.play('heal');
    }
  }

  /** 用当前快照重建全部索引，供下一帧差分。 */
  private primes(curr: Snapshot): void {
    this.unitById.clear();
    for (const unit of curr.units) this.unitById.set(unit.id, unit);
    this.replaceSet(this.projectileIds, curr.projectiles.map((entry) => entry.id));
    this.replaceSet(this.explosionIds, curr.explosionEffects.map((entry) => entry.id));
    this.replaceSet(this.pulseIds, curr.aoePulseEffects.map((entry) => entry.id));
    this.replaceSet(this.healIds, curr.healEffects.map((entry) => entry.id));
  }

  private replaceSet(target: Set<number>, ids: readonly number[]): void {
    target.clear();
    for (const id of ids) target.add(id);
  }

  /** 投送音合并到窗口内只响一次，一次出多兵种不会像放鞭炮。 */
  private playCrowd(id: SfxId): void {
    const at = this.now();
    if (at - this.lastCrowdAt < this.crowdWindowMs) return;
    this.lastCrowdAt = at;
    this.play(id);
  }

  /** 受击比投送更密，用单独的窗口降噪。 */
  private playHit(id: SfxId, volumeScale: number): void {
    const at = this.now();
    if (at - this.lastHitAt < this.hitWindowMs) return;
    this.lastHitAt = at;
    this.play(id, { volumeScale });
  }
}
