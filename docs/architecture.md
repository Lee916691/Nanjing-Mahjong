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

## 11. 胡牌与响应窗口边界

- `ReactionWindow` 是按 `source` 区分的联合类型：弃牌使用 `source: 'discard'` 并保存弃牌来源，补杠声明使用 `source: 'bu-gang'` 并只保存一份 `PendingBuGangIntent`。所有响应提交和解析逻辑必须先按来源收窄。
  - 弃牌窗口可以同时暴露胡、碰、明杠和过；解析时胡高于碰/明杠，并按 `responderOrder` 一次收集全部合法胡牌响应，实现一炮多响。补杠窗口只暴露胡和过。
  - Reducer 在打开弃牌或补杠响应窗口时，从权威 `GameState` 为每名 responder 构造最小只读 `ReactionAvailabilityContext`。该 source-discriminated context 只包含 responder 手牌、副露、花牌、过手胡状态、目标牌、来源玩家和胡牌判定所需的扁平副露事实；`RuleSet.getAvailableReactions` 不接收 `GameState`、完整玩家数组或响应窗口。
  - 弃牌 context 的 `canDrawFromWallTail` 由 Reducer 直接按当时权威 `state.wall.length > 0` 计算，不持久化也不由客户端提供。RuleSet 只基于 context 判定响应 availability；`GameState` 所有权仍在 Reducer，`ScoreTransfer` 与通用 settlement 职责不变。
- 通用 `evaluateHuStructure` 只负责普通四面子一将、七对、龙七对和既有 Meld 对结构数量的影响；普通结构显式保存 `existingMeldCount`，使结果校验可以确认已有副露与暗手面子合计为四组，而不重跑拆牌算法。通用层不计算南京规则资格或金额。
- `hu.ts` 同时提供集中式纯运行时校验，完整校验普通牌实体、Meld metadata、HuStructure、HuPattern、HuEvaluation、HandResult 和 Hu scoring event；Match completion 与 settlement 复用同一套边界校验。
- `nanjing-open` RuleSet 在胡牌发生时计算门清、对对胡、全球独钓、混一色、清一色、无花果、压绝、花数与硬花资格，并生成最终 `ScoreTransfer` 快照。Settlement 只校验和执行快照，不重算胡牌公式、比下胡或付款关系。
- 玩家放弃一次真实弃牌胡机会后记录独立的过手胡状态；该状态持续到玩家自己弃牌，期间同时禁止后续点炮胡和抢补杠胡。摸牌本身不提前解除。
- 局结束写入 typed `HandResult`。胡牌结果只保存共同 winning tile、付款者和有序 winners/evaluation；流局结果保存耗尽原因。金额账本只存在于 pending scoring events 的 transfers 中。

## 12. 补杠事务边界

- 玩家每次通过运行期真实摸牌或补花/杠后尾补得到普通牌时，Reducer 只针对当时已经存在且牌面唯一的合法 Peng 写入 `BuGangDrawProvenance { targetMeldId, tileId }`。Peng 创建不回扫旧手牌；弃牌、暗手消费、补杠成立及抢补杠胡都会按实体牌清理来源记录。
- `DECLARE_BU_GANG` 只提交玩家和原 Peng 的 `meldId`。Reducer 通过 provenance 锁定碰后由本人摸入的具体第四张实体牌，建立 `PendingBuGangIntent`，但声明阶段不移牌、不升级 Meld、不计分、不尾补；availability、声明、全 Pass finalize 与抢杠解析复用同一来源验证。
- 抢补杠窗口全 Pass 后，Reducer 再次验证 intent，将原 Peng 在原位置升级为 BuGang：保留 `meldId`、前三张顺序、`claimedTileId` 和 `fromPlayerIndex`，末尾追加第四张，且不增加 `nextMeldSequence`。
- 正式补杠成立时，RuleSet 生成由原点碰者向补杠者支付实际 20 分的 transfer 快照；随后复用明杠/暗杠的牌墙尾部补牌、连续补花和终局花事件抑制路径。
- 抢补杠胡时第四张只从声明者暗手移除一次，原 Peng 保持不变；不产生补杠事件、不收补杠分、不尾补。声明者独自向每名赢家支付其单份胡牌分三份，并按敞开头比下胡生成最终快照。
- `GameState.handProgressFacts` 保存结算队列清空后仍需用于庄家推进和第16局判断的最小 typed 局内事实。成功暗杠、成功直接明杠/补杠和实际成立的花杠在正式 gameplay 事件处累计；杠开、包子结算、自摸、两类罚分和四风归齐也有独立计数字段，以覆盖权威续庄决策。当前阶段尚无对应 action 的字段保持为零；新手牌全部归零，声明失败或终局抑制事件不计入。
- `applyGameActionToMatch` 在同一次动作中结算胡牌、补杠和尾补花杠事件。`completeCurrentHand` 只接受已经 ended、具有完整合法 typed result 且局内事实合法的 hand，并从 result 与可信 facts 推导庄家推进；抢补杠、一炮多响、庄家胡和流局仍不过庄，第16有效庄家轮次再按权威八类额外条件决定续庄。
- 当前可达状态下的自摸入口复用同一 Hu evaluator、Hu evaluation、`PendingHuScoringEvent`、`HandResult` 和 transfer settlement。未来进园子只需改变 RuleSet 事件时输出；当前阶段仍没有 UI 或网络响应计时器。

## 13. 当前可达状态下的自摸闭环

- Phase 13A 只完成当前 action 和状态可以到达的自摸闭环，不代表规则文档中的全部自摸变体均已实现。地胡报听、杠后承包和其他包子付款重定向仍留待后续阶段，当前也不实现 UI、server 或 timer。
- `GameState` 同一时间最多保存一份 `SelfDrawProvenance`。它绑定当前候选玩家、具体普通牌实体 ID 和 `initial-dealer`、`wall-head`、`flower-replacement`、`ming-gang-tail`、`an-gang-tail`、`bu-gang-tail` 之一，不保存摸牌历史，也不复用补杠来源证明。
- 初始庄家来源在完整发牌与初始补花结束后建立。无初始补花时绑定庄家发牌过程中最后取得的普通牌；有初始补花时绑定庄家补花流程最终补入的普通牌。该来源只用于首次弃牌前的天胡候选。
- 普通墙头或杠尾直接取得普通牌时记录直接来源。只要先取得花牌，最终普通牌就记录为 `flower-replacement`；该 variant 同时记录本次真实补花链是否新创建了未去重、未被终局抑制的 flower-kong event。
- RuleSet 按来源互斥分类：直接杠尾为杠开；补花链未形成新花杠为花开；形成新花杠为杠开；初始庄家优先分类为天胡。花开与杠开不会同时出现在 evaluation 中。
- `getAvailableSelfDrawHu` 与 `DECLARE_SELF_DRAW_HU` 共用同一候选验证边界。验证按 provenance 的实体 ID 从暗手只读副本中精确移除一次，将剩余牌作为 `concealedTiles`、该实体作为 `winningTile` 送入 evaluator，避免把已经在手中的自摸牌计算两次。
- `SelfDrawWinHandResult` 只有一个 `winner`，不伪造 `payerPlayerIndex` 或 `winners` 数组。一个 `PendingSelfDrawHuScoringEvent` 保存 RuleSet 生成的全部付款 transfers；普通自摸由三家分别付款，天胡由三家各付1000。Settlement 仍只验证并执行 transfer 快照，不理解自摸公式或重建付款人。
- 自摸 action 原子结束本局、清除 provenance、更新 `selfDrawCount`，杠开时同时更新 `gangKaiCount`。Match 在同一次 action 中结算事件；`completeCurrentHand` 从 typed result 与局内 facts 处理庄家自摸、闲家过庄、杠开不过庄和第16有效庄家轮次的任意自摸续庄。
- 摸到牌墙最后一张普通牌后，本局继续保持 `waiting-for-discard`，玩家可以自摸或弃牌。若弃牌则正常开放响应窗口；无人响应且牌墙为空后流局。补花链耗尽仍立即流局，最后一张终局花的花杠事件仍被抑制。
