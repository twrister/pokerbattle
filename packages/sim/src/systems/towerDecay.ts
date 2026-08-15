import { isArcherTowerId } from '../config/units.js';
import { TOWER_HP_DECAY_PER_TICK } from '../config/tuning.js';
import type { World } from '../world.js';

/**
 * 箭塔部署后持续掉血：每秒 20 点，按帧率摊到每个 tick。
 * 基地不参与；掉到 0 交给 cleanup 结算死亡，保证当帧仍能出手。
 */
export function updateTowerDecay(world: World): void {
  for (const unit of world.units) {
    if (unit.dead || unit.hp <= 0) continue;
    if (!isArcherTowerId(unit.config.id)) continue;
    unit.hp -= TOWER_HP_DECAY_PER_TICK;
  }
}
