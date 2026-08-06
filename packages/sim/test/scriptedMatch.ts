import { type Command, spawnCommand } from '../src/commands.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat } from '../src/math/fixed.js';
import { World } from '../src/world.js';

const at = (x: number, y: number) => [fromFloat(x), fromFloat(y)] as const;

/**
 * 一段固定的对局脚本：分批往两边投兵。
 * 确定性测试的核心输入，任何改动都会让基准 hash 变化，属于预期行为。
 */
export const MATCH_SCRIPT: ReadonlyMap<number, readonly Command[]> = new Map([
  [
    1,
    [
      spawnCommand(Faction.Blue, 'melee_grunt', ...at(6, 6)),
      spawnCommand(Faction.Blue, 'melee_grunt', ...at(9, 5)),
      spawnCommand(Faction.Blue, 'ranged_archer', ...at(7.5, 3)),
    ],
  ],
  [
    6,
    [
      spawnCommand(Faction.Red, 'melee_grunt', ...at(8, 26)),
      spawnCommand(Faction.Red, 'ranged_archer', ...at(10, 28)),
      spawnCommand(Faction.Red, 'ranged_archer', ...at(6, 28)),
    ],
  ],
  [
    120,
    [
      spawnCommand(Faction.Blue, 'ranged_archer', ...at(4, 4)),
      spawnCommand(Faction.Blue, 'melee_grunt', ...at(12, 6)),
    ],
  ],
  [
    240,
    [
      spawnCommand(Faction.Red, 'melee_grunt', ...at(9, 27)),
      spawnCommand(Faction.Red, 'melee_grunt', ...at(9.2, 27.1)),
    ],
  ],
]);

/** 跑完整段脚本，返回每一 tick 的世界指纹 */
export function runScriptedMatch(seed: number, ticks: number): number[] {
  const world = new World(seed);
  const hashes: number[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    world.step(MATCH_SCRIPT.get(tick) ?? []);
    hashes.push(world.hash());
  }
  return hashes;
}
