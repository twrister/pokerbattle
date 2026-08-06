import { type Command, CommandKind } from '../commands.js';
import type { World } from '../world.js';

/** 把本 tick 收到的指令落地。放在流水线最前面，新单位当帧就能参与后续系统。 */
export function applyCommands(world: World, commands: readonly Command[]): void {
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]!;
    switch (command.kind) {
      case CommandKind.Spawn:
        world.spawnUnit(command.faction, command.typeId, command.x, command.y);
        break;
    }
  }
}
