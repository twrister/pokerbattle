import {
  MatchState,
  type Command,
  type Snapshot,
  TICK_RATE,
  World,
  takeSnapshot,
} from '@pb/sim';

const STEP_MS = 1000 / TICK_RATE;
/** 单帧最多补几个逻辑帧。标签页切回来时时间差可能有好几秒，不设上限会卡死。 */
const MAX_CATCHUP_STEPS = 8;

export interface SimLoopOptions {
  /** 为 true 时用 MatchState（牌堆+出牌校验），单机/联机对局用；沙盒仍走裸 World。 */
  withMatch?: boolean;
}

/** 在每个逻辑帧消费指令前生成自动操作，适用于本地人机等非网络控制方。 */
export type CommandSource = (match: MatchState | null) => Command | null;

/**
 * 固定步长驱动器。
 *
 * 逻辑必须按固定 tick 推进（否则确定性无从谈起），而画面要跟着刷新率走，
 * 两者之间用累加器解耦：攒够一个 tick 的时间就跑一帧逻辑，剩下的零头交给渲染插值。
 */
export class SimLoop {
  readonly world: World;
  readonly match: MatchState | null;
  paused = false;
  speed = 1;

  prev: Snapshot;
  curr: Snapshot;

  private accumulator = 0;
  private readonly pending: Command[] = [];
  private readonly commandSources: CommandSource[] = [];

  constructor(seed = 1, options: SimLoopOptions = {}) {
    if (options.withMatch) {
      this.match = new MatchState(seed);
      this.world = this.match.world;
    } else {
      this.match = null;
      this.world = new World(seed);
    }
    this.curr = takeSnapshot(this.world);
    this.prev = this.curr;
  }

  /** 指令先入队，等到下一个逻辑帧统一执行——联网后这里换成「等服务器确认的帧」 */
  enqueue(command: Command): void {
    this.pending.push(command);
  }

  /** 注册逻辑帧命令来源；返回注销函数，确保离开对局后不残留自动操作。 */
  addCommandSource(source: CommandSource): () => void {
    this.commandSources.push(source);
    return () => {
      const index = this.commandSources.indexOf(source);
      if (index >= 0) this.commandSources.splice(index, 1);
    };
  }

  advance(deltaMs: number): void {
    if (this.paused) return;
    this.accumulator += deltaMs * this.speed;

    let steps = 0;
    while (this.accumulator >= STEP_MS) {
      if (steps >= MAX_CATCHUP_STEPS) {
        this.accumulator = 0;
        break;
      }
      this.stepOnce();
      this.accumulator -= STEP_MS;
      steps++;
    }
  }

  stepOnce(): void {
    for (const source of this.commandSources) {
      const command = source(this.match);
      if (command) this.pending.push(command);
    }
    if (this.match) this.match.step(this.pending);
    else this.world.step(this.pending);
    this.pending.length = 0;
    this.prev = this.curr;
    this.curr = takeSnapshot(this.world);
  }

  /** 当前处于两个逻辑帧之间的比例，渲染插值用 */
  get alpha(): number {
    if (this.paused) return 1;
    return Math.min(1, this.accumulator / STEP_MS);
  }

  reset(): void {
    if (this.match) {
      this.match.clear();
      this.match.seedStartingCastles();
    } else {
      this.world.clear();
    }
    this.pending.length = 0;
    this.accumulator = 0;
    this.curr = takeSnapshot(this.world);
    this.prev = this.curr;
  }
}
