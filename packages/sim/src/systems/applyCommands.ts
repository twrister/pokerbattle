import { type Command, CommandKind } from '../commands.js';
import {
  findFormationById,
  getFormationBuildingTypeId,
  isBuildingOnlyFormation,
  resolveFormationSpawnsFx,
} from '../config/cardFormations.js';
import { isBuildingConfig, getUnitConfig } from '../config/units.js';
import type { World } from '../world.js';

/** 把本 tick 收到的指令落地。放在流水线最前面，新单位当帧就能参与后续系统。 */
export function applyCommands(world: World, commands: readonly Command[]): void {
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]!;
    switch (command.kind) {
      case CommandKind.Spawn:
        // 建筑只能走 PlaceBuilding，避免绕过占格校验
        if (isBuildingConfig(getUnitConfig(command.typeId))) break;
        world.spawnUnit(command.faction, command.typeId, command.x, command.y);
        break;
      case CommandKind.PlaceBuilding:
        // 非法落点静默丢弃，与客户端预览拦截对齐，保持确定性
        world.spawnBuilding(command.faction, command.typeId, command.x, command.y);
        break;
      case CommandKind.PlayFormation:
        applyPlayFormation(world, command);
        break;
    }
  }
}

/** 将出牌指令展开为建筑或单位生成；非法阵型/落点静默跳过。 */
function applyPlayFormation(
  world: World,
  command: Extract<Command, { kind: typeof CommandKind.PlayFormation }>,
): void {
  const formation = findFormationById(command.formationId);
  if (!formation) return;

  if (isBuildingOnlyFormation(formation)) {
    const typeId = getFormationBuildingTypeId(formation);
    if (!typeId) return;
    world.spawnBuilding(command.faction, typeId, command.x, command.y);
    return;
  }

  const points = resolveFormationSpawnsFx(formation, command.faction, command.x, command.y);
  for (const point of points) {
    if (isBuildingConfig(getUnitConfig(point.typeId))) continue;
    world.spawnUnit(command.faction, point.typeId, point.x, point.y);
  }
}
