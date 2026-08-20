import { type Fx, div, fromFloat } from '../math/fixed.js';

/** 逻辑帧率。所有「每秒」的配置都按这个换算成每 tick 增量。 */
export const TICK_RATE = 20;
/** 定点形式的帧率，供 div 使用 */
export const TICK_RATE_FX: Fx = fromFloat(TICK_RATE);

/** 首次索敌错峰间隔（tick）。spawn 时用 id % 间隔打散，避免同批出场挤在同一帧全场扫描。 */
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
/**
 * Attack 状态下的浅层重叠推挤系数。
 * 站定输出时仍会被友军轻微挤开，但不至于立刻退出攻击位。
 */
export const ATTACK_PUSH_SCALE: Fx = fromFloat(0.2);
/**
 * 穿透深度超过双方半径之和的这个比例，视为深层重叠，Attack 也按正常力度推开。
 * 避免完全叠体时永远解不开。
 */
export const ATTACK_PUSH_DEEP_RATIO: Fx = fromFloat(0.35);
/**
 * 单次分离迭代的推挤位移上限 = moveSpeed/TICK_RATE * 该系数。
 * 需要高于常见双单位解叠所需位移，否则质量分配会被裁剪抹平；
 * 仍能挡住十几人堆叠时的瞬移级累加。
 */
export const PUSH_MAX_MOVE_RATIO: Fx = fromFloat(5);

/**
 * 已处于 Attack 时允许超出进入射程的额外距离。
 * 进入用正常射程，退出用射程+迟滞，减少 Attack/Seek 抖动。
 */
export const ATTACK_EXIT_HYSTERESIS: Fx = fromFloat(0.2);

/** 攻击环上的槽位数量（八方向查表，不用三角函数） */
export const ENGAGEMENT_SLOT_COUNT = 8;
/**
 * 槽位相对「刚好够着」再往内收。
 * 必须明显大于 WAYPOINT_ARRIVE_DIST，否则寻路会在距槽位 0.15 处「到站」，
 * 实际站位仍略超出进入射程，近战打远程会永远 Seek。
 */
export const ENGAGEMENT_SLOT_INSET: Fx = fromFloat(0.25);

/** 朝向每 tick 的插值比例，越小转身越慢 */
export const TURN_RATE: Fx = fromFloat(0.35);

/** 出手瞬间目标已略微走出射程时的容差，避免近战永远差一点点打不到 */
export const ATTACK_RANGE_TOLERANCE: Fx = fromFloat(0.35);

/** 空中单位角色离地悬浮高度（场景单位），供渲染与弹道出生点对齐。 */
export const AIR_UNIT_HOVER_HEIGHT = 1.4;
/** 地面远程弹道默认离地高度。 */
export const GROUND_PROJECTILE_HEIGHT = 0.9;
/** 防御塔箭矢出生高度：接近塔顶弓手位置，避免从塔底射出。 */
export const TOWER_PROJECTILE_HEIGHT = 2.0;
/**
 * 箭塔部署后的持续损耗（点/秒）。三种箭塔共用，基地不掉。
 * 用来限制占场时间，避免无限防守。
 */
export const TOWER_HP_DECAY_PER_SECOND = 20;
/** 每逻辑帧扣除的箭塔生命；由每秒损耗按帧率换算，避免 tick 循环里做浮点除法。 */
export const TOWER_HP_DECAY_PER_TICK: Fx = div(fromFloat(TOWER_HP_DECAY_PER_SECOND), TICK_RATE_FX);
/**
 * 空中单位弹道出生高度：约等于悬浮高度 + 巨龙头相对脚底的位置，
 * 让火球从巨龙头吐出而不是脚底。
 */
export const AIR_PROJECTILE_HEIGHT = 2.5;
/** 抛物线弧高占水平飞行距离的比例。 */
export const PROJECTILE_ARC_RATIO = 0.22;
/** 弧高下限：贴脸射击也要看得出弧度。 */
export const PROJECTILE_ARC_MIN = 0.4;
/** 弧高上限（乘上 scale 后生效），避免超远弹道飞出镜头。 */
export const PROJECTILE_ARC_MAX = 2.6;
/** 战车炸弹 / 小炸弹的高抛倍率。 */
export const BOMB_ARC_SCALE = 1.5;
/** 巨型炸弹倍率，保持比小炸弹明显更高的吊射手感。 */
export const GIANT_BOMB_ARC_SCALE = 2;

/**
 * 按发射时水平距离换算抛物线顶点高度。
 * 远射拉高、近射压平，scale 用来区分箭矢/法球与炸弹类的高抛手感。
 */
export function arcApexForDistance(distance: number, scale = 1): number {
  const raw = distance * PROJECTILE_ARC_RATIO * scale;
  return Math.min(PROJECTILE_ARC_MAX * scale, Math.max(PROJECTILE_ARC_MIN, raw));
}

/** A* 单次搜索的节点上限，防病态地形把一帧算爆 */
export const ASTAR_NODE_BUDGET = 3000;
