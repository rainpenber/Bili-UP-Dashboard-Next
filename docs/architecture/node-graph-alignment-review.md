# 节点图对齐评审（Phase 2A）

评审基线是 Phase 1 文档头 `fe456f3cbea12f8abef327be9404435d06a9b296`（分支 `cursor/ui-backend-contract-audit-d3a5`），对应已接受界面 `9d9370e0b2c0d3b5b5e6cb92f68d5416f48b641b`。本文件只决定真实 UUID 项目图怎样对齐已经接受的逐步控制，并标明原先画布承诺落在哪一层。不改界面，不新增状态机、表或算法。端口、路由清单和采集缺口仍以 [ui-backend-contract-audit.md](./ui-backend-contract-audit.md) 为准。

本云端工作区没有重放 Hermes 的浏览器点击，也没有重读测试库。Hermes 证据只采用已交代的那次只读观察：localhost 上一个真实项目图为 14 节点 / 16 边，节点 `data-id` 等于 workflow 响应里的节点 UUID，说明文案是「改名只留在本页，尚未写回数据库」；发布节点为 `completed` 时，展开后四格「未完成 / 进行中 / 阻塞 / 完成」的 `disabled` 都是 false；点击「进行中」后整份 workflow JSON 不变。源码用来解释这次点击，不把同态点击当成证明。

状态词：`verified` 有源码，并且有组件测试或上述 Hermes 观察；`source only` 只读到源码；`session only` 只活在页面内存；`missing` 真实图上没有；`unknown` 现有证据不够。边数等于自身不是连通性证明。

## 1. 需求矩阵

| 能力                                 | 出处                                             | 真实 UUID 图                                                                                              | `/workflow-mock` 与页内演示                                 | 状态                                    | 产品后果                                                                                                       |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 从数据库加载该项目流程               | I-1；`LiveProjectWorkflow` 读 `GET .../workflow` | 同一响应进时间线和 `commercialWorkflowToLive`。React Flow 的 `id` 就是节点 UUID                           | 演示 id 不走这条查询                                        | verified                                | 图和时间线已经是同一批实体。14/16 与默认模板种子一致，且 `data-id` 对上响应 id                                 |
| 自由拖动节点                         | 《节点工作流交互重设计》画布第 1 条              | `draggable: true`，松手只改画布 state                                                                     | mock 画布记入撤销栈                                         | session only                            | 刷新或重进页面会重新 dagre。方向切换也会重排                                                                   |
| 从端口拖线，不再用下拉连线           | 同上第 2 条；旧「从 / 到」已去掉                 | `nodesConnectable={false}`，`deleteKeyCode={null}`                                                        | 仅 `workflow-mock/canvas.tsx` 的 `onConnect`                | session only                            | 真实图能看见端口，连不上。下拉面板在当前壳上已不渲染                                                           |
| 增加、删除节点和边                   | 同上第 4–5 条；I-1 写明留到 I-2 / I-3            | A / J / Delete / Backspace 只设通知「增删节点和连线留到后续」                                             | mock 画布有增删和撤销。演示项目钩子仍留着函数，当前壳不调用 | session only                            | 真实拓扑不能在图上改。组件测试只证明快捷键不改演示图                                                           |
| 看得见、可拖、可接线的汇合圆点       | 汇合节点专节                                     | 库内 `kind=merge` 画成 10px 金色圆点，可拖，`selectable/connectable` 为 false                             | mock 圆点 `connectable: true`，悬停出端口                   | source only；接线 missing               | 源码里圆点可见且可拖，接线被关掉。Hermes 那次观察没有单独记录圆点。UUID 图不插入第二套演示圆点                 |
| 增加、删除汇合点                     | 同上，J 与右键                                   | 右键没有这项；J 走上面的「留到后续」                                                                      | mock 的 `addJunction` / `removeJunction`                    | session only                            | 真实汇合行不能在图上增删                                                                                       |
| 行内改名：Enter、再 Enter、blur、Esc | 同上第 5 条；I-1                                 | 卡片实现了聚焦、Enter、blur、Esc。UUID 页写入 `applySessionRename`                                        | 演示编辑器走 `renameWorkflowNode` 并入撤销栈                | session only                            | 空名在真实页被拒绝；mock 模型把空名收成「流程节点」。两套规则还没统一，A 包不改名                              |
| 改名写回并在重开后仍在               | I-1 明确「当前接口没有改名路由」                 | `commercial-write.ts` 无改名路由。归档连会话改名也关                                                      | 刷新丢失。设置页默认流程发布只改页内 store                  | missing                                 | 不能把会话改名或演示撤销算成已完成。工具条仍写 Ctrl+Z，UUID 页没有改名撤销栈                                   |
| 展开，就近推开邻居，视口不动         | 同上第 6 条                                      | `toggleDetail` + `nudgeOverlaps`；`fitView` 只在初次和切换方向                                            | 同一套 `WorkflowLiveCanvas`                                 | source only                             | 选择节点保持视口有演示壳测试。展开推开没有单独测试，也没有 Hermes 测量                                         |
| 快捷键不抢走输入框                   | 快捷键节                                         | 壳层在 INPUT / TEXTAREA / contentEditable 上直接 return                                                   | mock 同样先判断输入，Esc 仍取消改名                         | source only                             | 结构键目前只发通知。确认框若门户到 `document.body`，不该再绑一层画布快捷键                                     |
| 横向 / 纵向，端口跟着转              | 方向切换节                                       | 工具条切换后 dagre 重排，端口改为左/右或上/下                                                             | 演示壳测试会看到 `is-vertical`                              | verified（演示壳）；UUID 运行时 unknown | 方向是视图。重设计只要求撤销能回到切换前的方向，没有要求入库                                                   |
| 方向本身写入数据库                   | 无此要求                                         | 无列、无字段、无路由                                                                                      | 只在 mock 撤销栈里                                          | missing，且不补                         | 不新增方向持久化                                                                                               |
| 拖动坐标重开后仍在                   | 「之后位置以拖拽为准」；I-1 未接写入             | `pos_x` / `pos_y` 只用于 `ORDER BY`，响应无坐标。打开时坐标写 0 再 dagre                                  | 会话内拖动还在；重排或重开即失                              | missing                                 | 列已经存在，读写都没有接到画布                                                                                 |
| 结构增删重开后仍在                   | I-2 / I-3                                        | 无结构写路由。库有 `wf_edges` 防环触发器                                                                  | 只在 `/workflow-mock` 内存                                  | missing                                 | 触发器不是功能已交付。演示边数测试不能证明 UUID 图可编辑                                                       |
| 四格切换任意状态                     | 重设计第 6 条写明只改 mock 显示；I-1 改为只展示  | 四格按钮没有 `disabled`。`statusReadOnly` 让 `onClick` 在调用前返回；`setStatus` / `setReason` 仍是空函数 | mock 画布的 `setStatus` 会改内存状态                        | verified                                | Hermes 在 `completed` 上点「进行中」后 JSON 不变。这不是禁用，是看起来能写、实际上不写。不能把四格接到任意状态 |
| 已接受的逐步按钮                     | WP-004R2-9；`stepActionSpecs`                    | 时间线使用。图不调用 `onStep`                                                                             | 演示图文案写明状态推进留到后续                              | missing（图）                           | 未开始只「推进」；进行中是「完成」和中性「回退」；完成只留红色「回退」。图上不得另做一套                       |
| 阻塞确认后才写，取消零写入           | 同上；`StepNotices`                              | 只在时间线的 `useStepController`                                                                          | 无                                                          | source only；图 missing                 | 本轮没有重放取消。图若自建第二次确认，会拆成两套锁                                                             |
| 后继已推进则拒绝回退                 | `planNodeStep` / 阶段回退                        | 时间线展示 `successors`。图无入口                                                                         | 无                                                          | source only                             | 拒绝发生在服务端计划。图只复用这条结果                                                                         |
| 发布必填、幂等键和原监控任务         | 同上；`recordedPublish`                          | 时间线在 `publish_required` 时复用详情里的键                                                              | 无                                                          | source only                             | 图上的发布节点必须走同一次 `/step`，不能另插任务                                                               |
| 计划日小铅笔，实际日只展示           | WP-004R2-9；详情字段已在响应里                   | 铅笔只在时间线。`commercialWorkflowToLive` 没带 `plannedAt` / `completedAt`                               | 无真实保存                                                  | missing（图）                           | 计划仍由 Hermes 维护。图上只放同一支铅笔，不放常驻日期表单                                                     |
| 名称、状态、原因、计划、实际两处一致 | 同一 workflow 响应                               | 会话改名两处一起盖。`blockingReason` 有查询、有时间线，画布映射丢掉                                       | 演示 `workflowGraphToLive` 会带上原因                       | verified（原因分叉）                    | 阻塞节点展开后原因是空的。`not_applicable` 在四格里并进灰色「未完成」，卡上另有 `data-workflow-status`         |
| 汇合点没有状态格和操作               | WP-004R2-9；`planNodeStep` 拒绝 merge            | `JunctionNode` 无展开。时间线跳过 `kind==='merge'`                                                        | mock 圆点也无状态                                           | source only                             | 保持被动。完成或收回只发生在既有逐步事务里                                                                     |
| 写入锁定、错误、归档只读             | 时间线 `pending` 与 `archived`                   | 归档关掉改名和逐步编辑器。四格仍可点，点击被丢掉。图没有逐步错误区                                        | 演示归档走只读画布                                          | source only                             | 归档不能只关改名、却留着四颗看起来能写的按钮。四格可点本身已由 Hermes 在未归档项目上看到                       |
| 入口先选 V1 / V2 / V3 再打开         | 重设计信息架构                                   | UUID 页直接打开该项目的一张图                                                                             | `/workflow-mock` 与设置页内存版本                           | session only                            | 不把版本下拉补进真实项目页。已发布模板另有只读 GET                                                             |

`use-workflow-editor.ts` 里的增删和连线函数只服务于演示内存图。设置页「新项目默认流程」和数据库默认模板都不是这张 UUID 实例图。

## 2. 对齐后的交互

真实项目页继续只有一张图和一条时间线，都读现在的 workflow 查询。业务节点展开后放下时间线已经在用的那一排按钮，不再放能点的四格。

- 未开始只显示「推进」。进行中显示「完成」和中性「回退」。完成只显示红色「回退」。阻塞显示「解除阻塞」。不适用显示「回退」。文案用 `STATUS_WORD` 的五个词：未开始、进行中、完成、阻塞、不适用。时间线色带里把后两者都写成「未完成」的那一处，在同一包里改成这五个词，不增加状态。
- 按钮调用现有 `NodeStepActions`：一次 `POST .../nodes/:nodeId/step`，`nodeId` 用画布上的 workflow UUID（与 `child.id` 相同，不是模板 slug）。`expectedUpdatedAt` 原样带上该节点的 `updatedAt`。祖先闭包、开放阻塞、后继拒绝、发布校验仍由 `planNodeStep` 决定。
- `useStepController` 从时间线内部抬到 `LiveProjectWorkflow`，图和时间线共用这一份 `pending`、确认框、发布框和错误。取消确认只关对话框。发布框继续复用详情里的 `idempotencyKey`、BV 号和发布时间。不在前端循环写多个节点，也不调用旧的 `advance` / `complete` / `block` / `publish`。
- 阶段按钮留在时间线。图上没有阶段行，不把阶段推进复制到节点上。
- 展开卡显示与时间线相同的原因、计划日和实际完成时刻。原因来自响应里的 `blockingReason`，只读，不提供原因文本框。计划日沿用 `formatScheduleLabel` 和现有铅笔，保存仍走页面上的 `saveLiveNodePlan`。没有日期时不占一行。
- 汇合圆点保持现在的样子：可拖、不可选、无格、无按钮、无改名。
- 成功后只作废现有的 workflow 与项目详情查询。状态变化走现在的 meta 更新，不改 `structureKey`，不调用整理或 `fitView`。选中、展开和会话内拖过的位置留在原地。
- 失败、后继名单和网络错误写在已经展开的卡片上，并继续用现有的门户对话框。不滚动、不重排。`pending` 时这一份控制器里的按钮禁用。
- 归档沿用 `stepEditor.disabled` 和画布 `readOnly`：不发逐步、不改计划、不改名。
- 演示页、`/workflow-mock` 和模板卡不接 `/step`。模板没有实例状态。

`commercialWorkflowToLive` 需要把契约里已经有的 `blockingReason`、`plannedAt`、`completedAt`、`updatedAt` 带进画布视图。这是映射，不是新列。

## 3. 实现包

顺序已经定了：先做 A，再做视频与粉丝的可配置采集，再做已注册 API 联调。B 是原先承诺、现在仍缺的持久化，不并进 A，也不并进采集，更不合并成一个跨全部层的 I-2。B 排在采集里程碑之后，B1、B2、B3 彼此分开。

### A. 展开卡对齐今天的逐步控制

依赖：现有 workflow GET、`POST .../step`、`POST .../plan`、页面上的 `runLiveStep` 和 `saveLiveNodePlan`。不新增路由。

1. 业务节点展开后只走 `stepActionSpecs(..., 'node')` 的一次节点 `/step`。四格不再充当写入器。汇合圆点仍然没有操作。
2. 两处视图的名称、五态用词、原因、计划日、实际日和 `updatedAt` 来自同一次响应。会话改名若还在，只覆盖名称。
3. 成功只刷新现有两条查询。失败、取消和 `pending` 不移动视口，也不改边集。归档与时间线共用禁用开关。

### B. 已经承诺、尚未落地的持久化

不在 A 里宣布完成，也不永久删掉。

**B1 改名写回。** 新的改名写入，只改 `wf_nodes.name`。不变量：同一流程内名称唯一；归档拒绝；重开后两处名称相同且状态不动。空名称规则见第 5 节，A 不需要这份决定。

**B2 坐标写回。** 使用已有 `pos_x` / `pos_y`。不变量：松手后只写坐标；重开时用库存坐标，而不是每次 dagre；不保存横向或纵向。整理仍是一次视图重排。

**B3 端口增删节点和边。** 交互只做在真实图上，不新开演示页。不变量：环路、两个汇合点不相连、重复边和自环沿用已有的 `wf_edges` 触发器与 mock 模型拒绝文案；一次事务只改这一张 `workflow_id`；UUID 汇合点继续是 `kind=merge` 的行，不套用演示补点。

没有采集进程之前不开始 B。

### C. 更晚、且不属于缺口

版本下拉、把业务步骤做成 Ctrl+Z、把方向入库、120ms 动效、把旧逐节点路由接上画布、自由编辑阻塞原因、第五个状态格。这些都不进入 A 或 B。

## 4. 验收

| 场景             | 通过时看到什么                                                                        | 现在的证据                                                                     | 归入 |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- |
| 同一份数据       | 同一节点 UUID 在图和时间线上的名称、五态、原因、计划、实际一致；边的两端仍是这两个 id | 同源查询 verified。原因和日期在图上 missing。14/16 与 `data-id` 为 Hermes 观察 | A    |
| 真实写入后重开   | 合法一步后重开，库内状态还在；图没有第二套本地状态                                    | 时间线路径 source only。图上异态点击 JSON 不变，verified                       | A    |
| 选中、悬停、视口 | 逐步成功或失败后，缩放、平移、选中和展开保持；邻居只按现有 `nudgeOverlaps` 让开       | 选择保持视口有演示壳测试。逐步期间的视口 unknown                               | A    |
| 并行与汇合       | 平行兄弟不被这次节点步骤改写；汇合点没有按钮；它只在既有事务需要时被带上              | `planNodeStep` source only。圆点无面板 verified                                | A    |
| 阻塞取消         | 出现确认框时取消，workflow 与点击前一致                                               | 控制器源码 source only。本轮没有重放取消                                       | A    |
| 发布复用         | 发布节点沿用原幂等键和 BV；不新增监控任务                                             | 时间线源码 source only。图无入口                                               | A    |
| 令牌             | 请求里的 `expectedUpdatedAt` 等于打开时看到的 `updatedAt`；冲突时可以刷新再试         | 契约与时间线 source only                                                       | A    |
| 归档             | 无逐步、无铅笔、无改名，也没有可点的状态格                                            | 改名关闭 verified。四格仍可点，Hermes 观察加源码                               | A    |
| 结构归属与无环   | 只在 B3：写入前后边都属于同一 `workflow_id`；非法边被现有约束拒绝，图回到写入前       | 触发器 source only。真实图结构编辑 missing                                     | B3   |

A 的运行时验收要在隔离数据上做。本评审没有执行写入。

## 5. 仍须产品决定的一点

只在做 B1 时需要拍板：空名称是拒绝保存，还是落成「流程节点」。前者是现在的 `applySessionRename`，后者是 mock 的 `renameStageNode`。A 不改名，因此现在不用回答。

已接受的按钮、颜色、`/step` 规则，以及 React Flow 加 dagre，都不再作为问题重开。
