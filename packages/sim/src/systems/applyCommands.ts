import { type Command, CommandKind } from '../commands.js';
import {
  findFormationById,
  getFormationBuildingTypeId,
  getFuseBombTypeId,
  isFuseBombFormation,
  isFuseBombTypeId,
  isBuildingOnlyFormation,
  resolveCardFormation,
  resolveFormationSpawnsFx,
} from '../config/cardFormations.js';
import { getPokerCardById } from '../cards/deck.js';
import type { PlayingCard } from '../cards/deck.js';
import { resolveFuseBombDamage } from '../config/cardMapping.js';
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
        // 引信炸弹与出牌一致：主堡抛物线投放，不生成地面单位
        if (isFuseBombTypeId(command.typeId)) {
          const bombSlot = command.slot ?? command.faction;
          if (command.typeId === 'small_bomb') {
            world.spawnSmallBomb(command.faction, command.x, command.y, undefined, bombSlot);
          } else {
            world.spawnGiantBomb(command.faction, command.x, command.y, undefined, bombSlot);
          }
          break;
        }
        world.spawnUnit(
          command.faction,
          command.typeId,
          command.x,
          command.y,
          command.slot ?? command.faction,
        );
        break;
      case CommandKind.PlaceBuilding:
        // 非法落点静默丢弃，与客户端预览拦截对齐，保持确定性
        world.spawnBuilding(
          command.faction,
          command.typeId,
          command.x,
          command.y,
          command.slot ?? command.faction,
        );
        break;
      case CommandKind.PlayFormation:
        applyPlayFormation(world, command);
        break;
      case CommandKind.ClaimCastlePack:
        // 领包只改 MatchState 牌堆，不进入世界
        break;
    }
  }
}

/** 将出牌指令展开为建筑或单位生成；非法阵型/落点静默跳过。 */
function applyPlayFormation(
  world: World,
  command: Extract<Command, { kind: typeof CommandKind.PlayFormation }>,
): void {
  const template = findFormationById(command.formationId);
  if (!template) return;
  const cards = command.cardIds.map(getPokerCardById);
  if (cards.some((card) => !card)) return;
  const formation = resolveCardFormation(template, cards as PlayingCard[]);
  if (!formation) return;

  if (isBuildingOnlyFormation(formation)) {
    const typeId = getFormationBuildingTypeId(formation);
    if (!typeId) return;
    world.spawnBuilding(command.faction, typeId, command.x, command.y, command.slot ?? command.faction);
    return;
  }
  if (isFuseBombFormation(formation)) {
    const bombType = getFuseBombTypeId(formation)!;
    const damageOverride = resolveFuseBombDamage(formation, cards as PlayingCard[]);
    const bombSlot = command.slot ?? command.faction;
    if (bombType === 'small_bomb') {
      world.spawnSmallBomb(command.faction, command.x, command.y, damageOverride, bombSlot);
    } else {
      world.spawnGiantBomb(command.faction, command.x, command.y, damageOverride, bombSlot);
    }
    return;
  }

  const points = resolveFormationSpawnsFx(formation, command.faction, command.x, command.y);
  for (const point of points) {
    if (isBuildingConfig(getUnitConfig(point.typeId))) continue;
    world.spawnUnit(command.faction, point.typeId, point.x, point.y, command.slot ?? command.faction);
  }
}
