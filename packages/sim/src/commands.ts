import type { Fx } from './math/fixed.js';
import type { UnitTypeId } from './config/units.js';
import type { Faction } from './entity/unit.js';

/**
 * 指令是外界影响世界的唯一入口。
 *
 * 联网时客户端只上报指令，服务器按 tick 打包广播，两端各自跑同一份 sim。
 * 所以指令必须是可序列化的纯数据，不能塞函数或对象引用。
 */
export const CommandKind = {
  Spawn: 0,
  PlaceBuilding: 1,
  PlayFormation: 2,
} as const;
export type CommandKind = (typeof CommandKind)[keyof typeof CommandKind];

export interface SpawnCommand {
  kind: typeof CommandKind.Spawn;
  faction: Faction;
  typeId: UnitTypeId;
  x: Fx;
  y: Fx;
}

/** 放置建筑；坐标为点击点，sim 内会吸附到合法格心后再校验重叠。 */
export interface PlaceBuildingCommand {
  kind: typeof CommandKind.PlaceBuilding;
  faction: Faction;
  typeId: UnitTypeId;
  x: Fx;
  y: Fx;
}

/**
 * 玩家真实出牌意图：阵型 + 手牌 + 锚点。
 * 服务端可校验半场/手牌/牌型，再在 applyCommands 内展开为 spawn/建筑。
 */
export interface PlayFormationCommand {
  kind: typeof CommandKind.PlayFormation;
  faction: Faction;
  formationId: string;
  cardIds: string[];
  x: Fx;
  y: Fx;
}

export type Command = SpawnCommand | PlaceBuildingCommand | PlayFormationCommand;

export function spawnCommand(faction: Faction, typeId: UnitTypeId, x: Fx, y: Fx): SpawnCommand {
  return { kind: CommandKind.Spawn, faction, typeId, x, y };
}

export function placeBuildingCommand(
  faction: Faction,
  typeId: UnitTypeId,
  x: Fx,
  y: Fx,
): PlaceBuildingCommand {
  return { kind: CommandKind.PlaceBuilding, faction, typeId, x, y };
}

export function playFormationCommand(
  faction: Faction,
  formationId: string,
  cardIds: readonly string[],
  x: Fx,
  y: Fx,
): PlayFormationCommand {
  return {
    kind: CommandKind.PlayFormation,
    faction,
    formationId,
    cardIds: [...cardIds],
    x,
    y,
  };
}
