import { div, mul } from '../math/fixed.js';
import { recomputeStats, tickBuffList } from '../stats/buff.js';
import type { World } from '../world.js';

/**
 * 推进 Buff 倒计时并重算最终属性。
 * MVP 阶段场上不会有任何 Buff，这里几乎是空转，但流程先跑通，
 * 之后加光环、减速、狂暴只需要往 unit.buffs 里塞数据。
 */
export function updateBuffs(world: World): void {
  for (const unit of world.units) {
    if (unit.dead) continue;
    if (tickBuffList(unit.buffs)) unit.statsDirty = true;
    if (!unit.statsDirty) continue;

    const prevMaxHp = unit.stats.maxHp;
    recomputeStats(unit.base, unit.buffs, unit.stats);

    // 生命上限变化时按比例保留当前血量，否则加血 Buff 一到期单位就会直接暴毙
    if (prevMaxHp > 0 && prevMaxHp !== unit.stats.maxHp) {
      unit.hp = mul(div(unit.hp, prevMaxHp), unit.stats.maxHp);
    }
    if (unit.hp > unit.stats.maxHp) unit.hp = unit.stats.maxHp;
    unit.statsDirty = false;
  }
}
