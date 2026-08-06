import type { Fx } from './math/fixed.js';
import type { UnitTypeId } from './config/units.js';
import type { Faction } from './entity/unit.js';

/**
 * 指令是外界影响世界的唯一入口。
 *
 * 现在只有本地点击放兵会产生指令，但这条通道就是将来帧同步的输入管线：
 * 联网时客户端只上报指令，服务器按 tick 打包广播，两端各自跑同一份 sim。
 * 所以指令必须是可序列化的纯数据，不能塞函数或对象引用。
 */
export const CommandKind = {
  Spawn: 0,
} as const;
export type CommandKind = (typeof CommandKind)[keyof typeof CommandKind];

export interface SpawnCommand {
  kind: typeof CommandKind.Spawn;
  faction: Faction;
  typeId: UnitTypeId;
  x: Fx;
  y: Fx;
}

export type Command = SpawnCommand;

export function spawnCommand(faction: Faction, typeId: UnitTypeId, x: Fx, y: Fx): SpawnCommand {
  return { kind: CommandKind.Spawn, faction, typeId, x, y };
}
