# PokerBattle

类王室战争的 Web RTS 实时对战框架。当前阶段是**单机战斗 MVP**：可以在场上任意位置投放两种兵、两个阵营，观察自动索敌、寻路、碰撞推挤和战斗结算。

## 运行

```bash
pnpm install
pnpm dev      # 开发服务器
pnpm test     # 确定性回归 + 战斗行为 + 渲染同步测试
pnpm check    # 全仓类型检查
pnpm build    # 生产构建
```

打开页面后：左键点地面放兵，拖拽转视角，滚轮缩放。`1` `2` 切兵种，`Q` `E` 切阵营，空格暂停，`N` 单步，`B` 一键开团，`R` 清空。

## 结构

```
packages/
├── sim/      纯逻辑，零 DOM 依赖，可原样搬到 Node 服务端
└── client/   Three.js 渲染 + 输入 + 调试 HUD
```

`@pb/sim` 的唯一入口是 `world.step(commands)`，固定 20 tick/s。系统执行顺序写死在 [packages/sim/src/world.ts](packages/sim/src/world.ts) 里：

```
指令 → Buff → 索敌 → AI → 寻路 → 移动 → 碰撞推挤 → 战斗 → 弹道 → 清理
```

## 确定性约定

这套模拟是为帧同步联网准备的，同一个 seed 加同一串指令必须在任何机器上跑出逐位相同的结果。因此 `packages/sim` 内部：

- 所有数值走 Q16.16 定点数（[math/fixed.ts](packages/sim/src/math/fixed.ts)），不允许裸浮点
- 不允许 `Math.random`、`Date.now`、`Math.sin/cos/atan2`；朝向一律用归一化定点向量表示
- 所有平局场景（等距选敌、A\* 同优先级节点）都用实体 id / 格子下标兜底排序
- 随机数是 `World` 状态的一部分，不是全局单例

`world.hash()` 是世界状态指纹，联网后两端定期比对即可发现不同步；现在由 [test/determinism.test.ts](packages/sim/test/determinism.test.ts) 用来做回归。

## 加一个兵种

往 [config/units.ts](packages/sim/src/config/units.ts) 的 `UNIT_CONFIGS` 加一行就行，HUD 的兵种按钮和渲染视图都会自动跟上，不需要改任何逻辑代码。

## 加一个 Buff

`Unit.buffs` 数组塞一条 `Buff` 并把 `statsDirty` 置位即可，属性重算走 [stats/buff.ts](packages/sim/src/stats/buff.ts) 的「先加后乘」固定顺序。

## 尚未实现

服务端房间与 WebSocket 帧同步、具体的 Buff 效果、剩余兵种、建筑与河道、卡牌与费用系统。这些都只需往现有的配置表、指令队列、系统列表里加东西，不用改骨架。
