# PokerBattle

类王室战争的 Web RTS 实时对战框架。支持单机战斗与本地多房间联机（1v1 权威帧同步）。

## 运行

```bash
pnpm install
pnpm dev              # 开发服 http://localhost:8081 （含调试面板与配置写回）
pnpm official         # 正式服 http://localhost:8080 （build + preview，仅单机）
pnpm official:online  # 正式服 + 权威服：8080 预览经 /ws 代理联机
pnpm dev:online       # 开发服 :8081 + 权威服 :8090，经 /ws 代理联机
pnpm dev:server       # 仅启动权威服 ws://localhost:8090
pnpm test             # 确定性回归 + 战斗行为 + 联机房间/协议测试
pnpm check            # 全仓类型检查
pnpm build            # 生产构建
```

开发服专属：单位参数面板、单机运行控制、卡组页的新增阵型 / 阵型编辑区 / 重置与保存。

打开页面后：左键点地面放兵，拖拽转视角，滚轮缩放。`1` `2` `3` 切兵种，`Q` `E` 切阵营，空格暂停，`N` 单步，`B` 一键开团，`R` 清空。

## 联机（多房间）

1. 开发联机：`pnpm dev:online`，打开 `http://localhost:8081`。  
   正式服联机：`pnpm official:online`，打开 `http://localhost:8080`（隐藏调试面板的 build 产物 + 同源 `/ws` 代理）。
2. 大厅 → **多人联机**：
   - **快速匹配**：服务端自动分配/填入未开局房间，多组可并行对局。
   - **房间**：输入 1–24 位字母、数字、`_`、`-` 房号；不存在则创建，有空位则加入。
3. 两人到齐后开局；权威服以 20Hz 广播帧，客户端只镜像推进。
4. **断线重连**：对局中意外断线会保留席位 30 秒，服务端继续推进；原客户端自动重连并按最后确认 tick 补帧。超时后对手收到离开通知，本房间结束。主动点「返回主界面」不会重连。

### 局域网联机（正式服）

1. 主机运行 `pnpm official:online`。
2. 看终端里的 **Network** / `[pb-server]` 提示，例如 `http://192.168.6.236:8080/`。
3. **本机**可用 `http://localhost:8080/`；**同网段其他设备**必须用上述局域网 IP，不能用 `localhost`。
4. 各方在大厅用「快速匹配」或输入**同一房号**即可开打；WebSocket 走页面同源 `/ws`，无需单独开放 8090 给外机。
5. 若局域网打不开页面：在 Windows 防火墙中放行 Node.js 入站，或临时允许 TCP `8080`。

静态托管到 nginx 等环境时，同样需要把前端同域的 `/ws` 反代到 `@pb/server`。

## 结构

```
packages/
├── sim/      纯逻辑，零 DOM 依赖，可原样搬到 Node 服务端
├── net/      共享联机协议与编解码
├── server/   WebSocket 权威服（多房间 + 短时重连）
└── client/   Three.js 渲染 + 输入 + 调试 HUD + 联机会话
```

`@pb/sim` 的唯一入口是 `world.step(commands)`，固定 20 tick/s。系统执行顺序写死在 [packages/sim/src/world.ts](packages/sim/src/world.ts) 里：

```
指令 → Buff → 索敌 → AI → 寻路 → 移动 → 冲刺 → 碰撞推挤 → 战斗 → 弹道 → 清理
```

## 确定性约定

这套模拟是为帧同步联网准备的，同一个 seed 加同一串指令必须在任何机器上跑出逐位相同的结果。因此 `packages/sim` 内部：

- 所有数值走 Q16.16 定点数（[math/fixed.ts](packages/sim/src/math/fixed.ts)），不允许裸浮点
- 不允许 `Math.random`、`Date.now`、`Math.sin/cos/atan2`；朝向一律用归一化定点向量表示
- 所有平局场景（等距选敌、A\* 同优先级节点）都用实体 id / 格子下标兜底排序
- 随机数是 `World` 状态的一部分，不是全局单例

`world.hash()` 是世界状态指纹，联网后两端定期比对即可发现不同步；现在由 [test/determinism.test.ts](packages/sim/test/determinism.test.ts) 用来做回归。

## 加一个兵种

无特殊技能时，往 [config/units.ts](packages/sim/src/config/units.ts) 的 `UNIT_CONFIGS` 加一行即可，HUD 兵种按钮和渲染视图会自动跟上。

带冲刺等技能时，除配置外还要在对应系统里接线（例如皇家骑士的 `charge` 配置由 [systems/cavalry.ts](packages/sim/src/systems/cavalry.ts) 驱动）。

## 加一个 Buff

`Unit.buffs` 数组塞一条 `Buff` 并把 `statsDirty` 置位即可，属性重算走 [stats/buff.ts](packages/sim/src/stats/buff.ts) 的「先加后乘」固定顺序。

## 尚未实现

具体的 Buff 效果、剩余兵种、更完整的建筑与河道表现、观战与排位匹配等。这些都只需往现有的配置表、指令队列、系统列表与房间协议里加东西，不用改骨架。
