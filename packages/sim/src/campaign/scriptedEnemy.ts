import { spawnCommand, type Command } from '../commands.js';
import { TICK_RATE } from '../config/tuning.js';
import { Faction } from '../entity/unit.js';
import { fromFloat } from '../math/fixed.js';
import type { MatchState } from '../match/matchState.js';
import type { ScriptedEnemyStep } from './stageDef.js';

/** 同点位多个单位的横向间距。 */
const SPAWN_SPACING = 1.2;

/**
 * 按时间轴出兵的敌方。
 * 每个 tick 最多下发一条指令；到点的步骤按顺序逐帧消化，
 * 同一 tick 到期多步时会依次排在后续帧，保证确定性。
 */
export class ScriptedEnemy {
  private readonly queue: Array<{ tick: number; command: Command }> = [];

  constructor(steps: readonly ScriptedEnemyStep[], readonly faction: Faction = Faction.Red) {
    const sorted = [...steps].sort((left, right) => left.atSeconds - right.atSeconds);
    for (const step of sorted) {
      const tick = Math.round(step.atSeconds * TICK_RATE);
      for (const command of expandStep(step, faction)) this.queue.push({ tick, command });
    }
  }

  /** 供 SimLoop.addCommandSource 使用：到点返回队首指令。 */
  decide(match: MatchState): Command | null {
    if (match.result) return null;
    const head = this.queue[0];
    if (!head || match.world.tick < head.tick) return null;
    this.queue.shift();
    return head.command;
  }

  /** 剩余未执行的指令数，供测试断言。 */
  get remaining(): number {
    return this.queue.length;
  }

  /**
   * 队列里是否还有没下发的出兵指令。
   * 清场判定要用它而不是「最后一个出兵点的时间」：同一时刻的一批敌人要分多帧才进场，
   * 只看时间会在敌人还没出完时误判这一波已经清空。
   */
  get hasPendingSpawns(): boolean {
    return this.queue.length > 0;
  }
}

/** 把一步展开成若干 Spawn 指令，以落点为中心横向对称排开。 */
function expandStep(step: ScriptedEnemyStep, faction: Faction): Command[] {
  const count = Math.max(1, step.count ?? 1);
  const commands: Command[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) / 2) * SPAWN_SPACING;
    commands.push(
      spawnCommand(faction, step.typeId, fromFloat(step.x + offset), fromFloat(step.y)),
    );
  }
  return commands;
}
