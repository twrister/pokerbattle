import type { Command } from '@pb/sim';
import type { ReplayFrame } from './types.js';

/** 收集权威非空帧，供对局结束时落盘。 */
export class ReplayRecorder {
  private readonly frames: ReplayFrame[] = [];

  /** 只记有指令的 tick；空帧回放时按缺失处理。 */
  record(tick: number, commands: readonly Command[]): void {
    if (commands.length === 0) return;
    this.frames.push({
      tick,
      commands: commands.map(cloneCommand),
    });
  }

  /** 返回拷贝，避免调用方改坏内部缓冲。 */
  toFrames(): ReplayFrame[] {
    return this.frames.map((frame) => ({
      tick: frame.tick,
      commands: frame.commands.map(cloneCommand),
    }));
  }
}

/** 指令是纯数据，浅拷贝即可切断与 sim 内部数组的引用。 */
export function cloneCommand(command: Command): Command {
  if ('cardIds' in command) {
    return { ...command, cardIds: [...command.cardIds] };
  }
  return { ...command };
}
