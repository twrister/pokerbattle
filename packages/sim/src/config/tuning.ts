import { type Fx, fromFloat } from '../math/fixed.js';

/** 逻辑帧率。所有「每秒」的配置都按这个换算成每 tick 增量。 */
export const TICK_RATE = 20;
/** 定点形式的帧率，供 div 使用 */
export const TICK_RATE_FX: Fx = fromFloat(TICK_RATE);

/** 索敌间隔（tick）。用 id % 间隔 错峰，避免所有单位在同一帧集中做全场扫描。 */
export const RETARGET_INTERVAL = 5;

/** 路径重算间隔（tick）。目标一直在动，但没必要每帧都跑 A*。 */
export const REPATH_INTERVAL = 15;
/** 目标相对上次算路位置移动超过这个距离就立刻重算，不等间隔到期 */
export const REPATH_GOAL_TOLERANCE: Fx = fromFloat(1.0);

/** 判定「已到达当前路点」的距离阈值 */
export const WAYPOINT_ARRIVE_DIST: Fx = fromFloat(0.15);

/** 碰撞推挤每 tick 的迭代次数。2 次足以把常见的三四个单位堆叠解开。 */
export const SEPARATION_ITERATIONS = 2;
/** 单次迭代最多解开多少重叠比例，全量解开会让密集队形抖动 */
export const SEPARATION_STRENGTH: Fx = fromFloat(0.5);

/** 朝向每 tick 的插值比例，越小转身越慢 */
export const TURN_RATE: Fx = fromFloat(0.35);

/** 出手瞬间目标已略微走出射程时的容差，避免近战永远差一点点打不到 */
export const ATTACK_RANGE_TOLERANCE: Fx = fromFloat(0.35);

/** A* 单次搜索的节点上限，防病态地形把一帧算爆 */
export const ASTAR_NODE_BUDGET = 3000;
