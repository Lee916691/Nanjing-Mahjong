# MVP 架构说明

## 1. 架构目标

MVP 架构服务于一个明确目标：支持 4 个好友通过分享链接进入同一房间，并完整打完一将南京麻将敞开头。

架构必须保证：

- 服务端权威；
- 客户端只展示安全视图并提交操作意图；
- 规则逻辑集中在可测试的共享规则引擎；
- 当前只实现 `nanjing-open`，但 RuleSet / variant 边界可扩展；
- 房间、对局、一局和状态概念清晰分层。

## 2. 包与应用职责

### 2.1 `apps/web`

`apps/web` 是浏览器端应用。

职责：

- 渲染房间、麻将桌、玩家手牌、安全公共区、分数和结算结果。
- 通过 Socket.IO 与 `apps/server` 通信。
- 根据服务端下发的安全视图展示可用操作。
- 将玩家点击转化为 `GameAction` 意图提交给服务端。

禁止：

- 保存权威 `GameState`。
- 自行判断动作是否合法。
- 自行判断是否胡牌。
- 自行计算权威分数。
- 查看或推导其他玩家手牌。

### 2.2 `apps/server`

`apps/server` 是联机对局的权威状态持有者。

职责：

- 管理 Room 生命周期。
- 管理玩家连接、座位、准备状态和房主权限。
- 持有权威 Room / Match / GameState。
- 校验所有客户端提交的 `GameAction`。
- 调用 `packages/game-core` 推进游戏状态。
- 为每名玩家生成安全视图。
- 通过 Socket.IO 广播公共状态和玩家私有状态。

服务端是唯一权威裁判。任何客户端提交的动作都只是意图，必须由服务端验证后才能改变状态。

### 2.3 `packages/game-core`

`packages/game-core` 保存通用麻将规则引擎和南京麻将敞开头规则实现。

职责：

- 建模牌、牌墙、玩家、手牌、副露、花牌、弃牌、局状态和一将状态。
- 实现 RuleSet / variant 边界。
- 实现 `nanjing-open` 的规则判定和状态推进。
- 提供纯函数或可测试 API 给 `apps/server` 调用。

禁止：

- 依赖 Web UI。
- 依赖 Socket.IO。
- 持有网络连接或房间连接状态。

### 2.4 `packages/shared-types`

`packages/shared-types` 保存前后端共享类型。

职责：

- 定义 Socket.IO payload 类型。
- 定义客户端可提交的 action intent 类型。
- 定义服务端下发的公共视图和玩家私有视图类型。
- 定义错误 payload 和基础房间状态类型。

共享类型不能成为规则实现位置。规则判定仍属于 `packages/game-core`。

## 3. Server Authoritative 原则

MVP 必须遵守：

1. `apps/server` 是权威对局状态持有者。
2. 所有 `GameAction` 必须由服务端验证。
3. 服务端维护真实 `GameState`。
4. 客户端只接收服务端广播后的安全视图。
5. 客户端不能看到其他玩家手牌。
6. 客户端不能通过本地状态推进、修正或覆盖服务端状态。

推荐动作流：

```text
client click
→ apps/web submits GameAction intent
→ apps/server validates room, player, seat, turn and rule legality
→ apps/server calls packages/game-core
→ apps/server stores authoritative next state
→ apps/server emits safe views to clients
→ apps/web renders received view
```

## 4. RuleSet / Variant

规则引擎应支持 variant：

- 当前 MVP variant：`nanjing-open`
- 未来可能扩展：`nanjing-jinyuanzi`
- 未来可能扩展：其他麻将玩法

设计原则：

- 当前只实现 `nanjing-open`。
- 不为了未来玩法提前实现复杂功能。
- RuleSet 接口要避免把南京敞开头规则写死在 engine、server 或 UI 中。
- RuleSet 输出应能覆盖动作合法性、状态推进、胡牌判定、计分、单局结束、一将推进和安全视图所需信息。

## 5. Room / Match / Hand / GameState

### 5.1 Room

Room 是联机对局容器。

Room 应包含：

- 唯一 `roomId`；
- 4 个 player slots；
- 房主信息；
- 每名玩家的连接状态；
- 每名玩家的准备状态；
- 当前 `MatchState`；
- 房间生命周期状态。

房主可以开始游戏、提前结束或解散房间。提前结束或解散属于管理能力，不能作为正常完成一将的替代方案。

### 5.2 Match

Match 表示一将牌。

Match 应包含：

- `matchStatus`；
- `totalEffectiveDealerTurns = 16`；
- `effectiveDealerTurns`；
- 当前圈数；
- 当前庄家；
- 当前是否处于第16局；
- 第16局特殊续庄状态；
- `cumulativeScores`；
- 当前 `HandState`。

一将牌必须由系统按规则自动推进，并在满足16个有效庄次和第16局特殊续庄结束条件后自动结束。

### 5.3 Hand

Hand 表示一局。

Hand 从发牌开始，到胡牌、流局、包子强制结束或其他规则定义的局结束条件为止。

Hand 应包含：

- `handStatus`；
- `dealerSeat`；
- `currentSeat`；
- 牌墙头尾；
- 每名玩家手牌、副露、花牌、弃牌；
- 当前响应窗口；
- 局内罚分、杠、承包、包子、过手和地胡等状态；
- 本局结算结果。

### 5.4 GameState

`GameState` 是服务端权威规则状态，可根据实现阶段拆分为 `MatchState` 和 `HandState`。

无论内部命名如何，必须能区分并记录：

- `matchStatus`；
- `handStatus`；
- `currentHandIndex` 或 `effectiveDealerTurns`；
- `totalEffectiveDealerTurns = 16`；
- `dealerSeat`；
- `currentSeat`；
- `cumulativeScores`。

## 6. 客户端安全视图

服务端必须为每名玩家生成独立安全视图。

玩家可见：

- 自己的手牌；
- 自己的可操作项；
- 所有公开花牌；
- 所有副露；
- 所有弃牌；
- 当前庄家；
- 当前行动位；
- 当前一将进度；
- 公共分数和结算结果。

玩家不可见：

- 其他玩家手牌；
- 其他玩家未公开的可胡信息；
- 服务端内部裁判状态中不应公开的私有推导信息。

## 7. Socket 同步边界

Socket.IO 只负责传输事件，不负责裁判规则。

事件设计应围绕：

- 房间创建；
- 房间加入；
- 玩家入座；
- 玩家准备；
- 开始一将；
- 提交 `GameAction`；
- 接收房间公共状态；
- 接收玩家私有视图；
- 接收错误和拒绝原因；
- 接收结算和一将结束信息。

所有事件 payload 应尽量定义在 `packages/shared-types` 中。

## 8. 当前实现提示

当前仓库中 `apps/server` 仍只有健康检查和最小 `server:hello` 事件；`packages/game-core` 已有部分牌、牌墙、补花和基础回合推进能力。后续实现应按照 `docs/mvp-roadmap.md` 分阶段推进，不应在本架构文档归位步骤中写功能代码。

## 9. Match 实时计分边界

- Game reducer 只推进纯 `GameState` 并产生 `pendingScoringEvents`，不直接修改 `cumulativeScores`。RuleSet 在事件发生时根据当时的规则上下文确定实际 `ScoreTransfer`，事件保存不可变的转账快照。
- Match 层通过 `settlePendingScoringEvents` 消费事件；settlement 只校验并执行 `transfers`，不理解明杠、花杠或其他麻将金额规则。整批验证成功后更新累计分并清空队列。
- `startCurrentHand` 结算初始事件；`applyGameActionToMatch` 在同一次 Match action 中结算运行时事件；即使 GameState 已 ended，已有事件仍须结算。
- `applyGameActionToMatch` 是未来服务端推进权威 MatchState 的统一入口。房间和 WebSocket 业务不得直接调用纯 Game reducer 更新权威状态。
- 当前敞开头 RuleSet 生成实际 20 分转账。未来进园子可按事件发生时的规则状态生成 10 或 20 分快照；未来胡牌也可新增携带 `transfers` 的 scoring event，通用 settlement 无需改变。
- 当前 MVP 不保留 `eventId`、settled ledger 或完整回放日志。

## 10. 暗杠纵向边界

- 暗杠是玩家在自己的出牌阶段主动提交的 `DECLARE_AN_GANG` 动作；Game reducer 校验所选牌面后，从暗手中确定性选取四张实体牌并创建 `an-gang` Meld。
- 暗杠成立后复用统一的牌墙尾部补牌与连续补花流程；开杠前空墙时动作 no-op，补花链耗尽时保留已经成立的暗杠和较早实时事件并结束本局。
- RuleSet 在暗杠成立时通过 `getAnGangScoreTransfers` 生成 `ScoreTransfer` 快照；Game reducer 只创建 `an-gang-created` pending event，不直接修改累计分数。
- `applyGameActionToMatch` 通过通用 settlement 在同一动作内结算暗杠及尾补产生的花杠事件。Settlement 只校验并执行事件中的 transfers，不写死暗杠金额，也不访问 RuleSet、Meld 或手牌重算。
- 未来进园子可通过扩展暗杠事件发生时的 RuleSet context 和 transfer 输出改变付款规则，无需修改通用 settlement。
