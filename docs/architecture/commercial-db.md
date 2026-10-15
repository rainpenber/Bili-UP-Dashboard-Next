# 商单域数据库与流程 API（WP-004R2-2 / WP-004R2-3A）

聚合根是 **`commercial_projects`**。流程实例上的节点、边、制作包、开放事项都带项目归属，并用复合外键拦住跨项目引用。

## 节点种类

模板节点 `wf_template_nodes.kind` 与实例节点 `wf_nodes.kind` 只有两个值：`stage`（默认）和 `merge`。未知值由 CHECK 拒绝。已有行靠默认值落到 `stage`，不需要数据迁移。

汇合节点是普通步骤，不是制作包，也不按入度/出度推断。它有自己的状态（含进行中）、可以阻塞、可选节点可以标成不适用，并可以写入 `domain_audit_events`。阻塞原因不是节点列：原因来自开放事项；没有对应事项时，阻塞可以没有原因。

## 制作包删除

`package_id` 和归属列（`template_version_id` / `workflow_id`）在同一条复合外键里。PostgreSQL 对复合外键的 `ON DELETE SET NULL` 会把两列都写成 NULL，从而撞上归属列的 NOT NULL。因此这两条外键是 `ON DELETE RESTRICT`，并在删除制作包之前用触发器只清空 `package_id`：

- `fk_wf_template_nodes_package`
- `fk_wf_nodes_instance_package`

已发布模板仍然不可变。删除已发布模板上的制作包会失败，成员关系保持原样。

## 模板版本

- 只有草稿版本可以改结构。
- 发布把 `is_draft` 改成 `FALSE` 并写入 `published_at`，之后模板及其子表不可改。
- 实例图钉在创建时的 `template_version_id` 上。之后再发布新版本，不会改写已有实例。
- 同一 slug 同时只有一个 `is_default`。已发布版本的内容列不能改；发布新版本时只允许把旧版本的 `is_default` 改成 `FALSE`，再把新版本标成默认。节点名称在同一版本内按去首尾空格后唯一。

## 默认流程种子

`default_sponsorship` 版本 1 是已发布的默认模板，**14 个节点、16 条边**。汇合节点恰好一个，名字是「汇合节点」，可选，不属于制作包，放在「文案 / 预拍摄」和「A-roll 拍摄 / B-roll 素材 / AI 后期」之间。这一段是 5 条边，不是原先的 6 条直连：

- 文案 → 汇合节点
- 预拍摄 → 汇合节点
- 汇合节点 → A-roll 拍摄
- 汇合节点 → B-roll 素材
- 汇合节点 → AI 后期

其余边：询单 → 大纲；大纲 → 文案、预拍摄；A-roll 拍摄 / B-roll 素材 / AI 后期 → 审核；审核 → 发布；发布 → 结算、全平台分发、数据维护、其他。

页面 Mock 上曾经画过 17 条边。本包的种子是数据层的依据，计数以 14 / 16 为准。

## 只读 API

响应形状在 `@studio/contracts`。流程图节点带 `updatedAt`，这是写入时要原样交回的并发令牌。

| 方法   | 路径                                                                 | 内容                                               |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/v1/commercial/projects`                                        | 名称、到手金额、返点金额、当前阶段、是否有节点阻塞 |
| GET    | `/api/v1/commercial/projects/:projectId`                             | 金额、当前阶段、阻塞原因、发布状态                 |
| GET    | `/api/v1/commercial/projects/:projectId/workflow`                    | 节点（状态、种类、updatedAt）与边                  |
| GET    | `/api/v1/commercial/templates/default`                               | 已发布的默认流程模板及其图                         |
| GET    | `/api/v1/commercial/templates/default/workspace`                     | 当前草稿（可空）和全部已发布版本                   |
| GET    | `/api/v1/commercial/templates/default/versions/:id`                  | 某一个默认流程版本，含已发布旧版                   |
| POST   | `/api/v1/commercial/templates/default/draft`                         | 从当前默认发布版复制出草稿；已有草稿则原样返回     |
| DELETE | `/api/v1/commercial/templates/default/draft`                         | 丢弃草稿                                           |
| POST   | `/api/v1/commercial/templates/default/draft/publish`                 | 发布草稿为新版本并设为默认，不改已有项目           |
| POST   | `/api/v1/commercial/templates/default/versions/:id/nodes`            | 在草稿上添加节点                                   |
| PATCH  | `/api/v1/commercial/templates/default/versions/:id/nodes/:nodeId`    | 重命名草稿节点                                     |
| DELETE | `/api/v1/commercial/templates/default/versions/:id/nodes/:nodeId`    | 删除草稿节点及其边                                 |
| POST   | `/api/v1/commercial/templates/default/versions/:id/edges`            | 连接两个草稿节点                                   |
| POST   | `/api/v1/commercial/templates/default/versions/:id/edges/disconnect` | 断开一条草稿边                                     |
| POST   | `/api/v1/commercial/projects`                                        | 用名称和已发布模板版本创建项目并物化实例图         |

金额是 `numeric(14,2)` 的十进制字符串。`overallStage` 是项目上存储的阶段。`currentStageNames` 是状态为 `in_progress` 或 `blocked` 的节点名，按 `pos_y`、`pos_x`、`id` 排序；没有进行中或阻塞节点时为空数组。`blockingReason` 取仍开放且 `impact = blocking`、并且钉在阻塞节点上或 `blocks_node_id` 指向阻塞节点的事项标题；优先被钉住的事项，其次 `sort_rank`、创建时间、`id`。没有这样的事项时为 `null`。

图和模板节点按 `pos_y`、`pos_x`、`id` 排列。项目列表按 `created_at`、`id` 排列。

## 写入 API（WP-004R2-3A）

规则在 `packages/workflow`，不按节点种类分叉。汇合节点就是普通节点。推进到 `in_progress` 时，直接前驱必须是 `completed` 或 `not_applicable`；`not_applicable` 会递归换成它自己的前驱。回退要求每个直接后继仍是 `not_reached`。拒绝是 409，并点名挡住的节点。

阻塞原因可空。空白不会插入开放事项。`status_before_block` 保存阻塞前状态。钉住的 `impact = blocking` 事项被关闭或取消时，同一事务解除阻塞。

完成「发布」节点必须在同一事务写入 `project_publish_records`、`project_monitor_contracts`，以及该项目各一条 `metadata` / `metrics` 的 `monitor_jobs`（`pending`，不执行）。幂等靠 `idempotency_key` 和 `UNIQUE (project_id, job_type)`。监控标识是已有的 `bvid`。请求可以带视频链接，链接里的 BV 号写入 `bvid`；平台只接受 `bilibili`，因为表上没有平台列。

每次写入一个事务，和 `domain_audit_events` 一起提交。并发令牌是 `updated_at`。违反数据库约束时返回 409，消息来自约束本身。路径见 [WP-004R2-3A](../../work-packages/WP-004R2-3A-commercial-workflow-engine.md)。

## 模板草稿与从版本创建项目（WP-004R2-3B2）

默认流程页读写 `default_sponsorship`。开始草稿会把当前 `is_default` 的已发布版本复制成新行（新的包、节点、边 id），版本号是该 slug 现有最大版本加 1。草稿丢弃会删掉这行，下一个草稿重新取最大版本加 1，所以未发布过的版本号可以再用。已发布版本不能删除，编号不会改、也不会被后来的发布占用。

发布在同一事务里先清掉旧的 `is_default`，再把草稿改成已发布并标为默认。不更新 `commercial_projects`、`project_workflows` 或实例图。

编辑只接受草稿。已发布版本返回 409「已发布的模板版本不可修改」。成环由模板边触发器拒绝，接口改写成「无法连接「发布 → 询单」：会在流程中形成环路。」。重名返回「节点名称「大纲」已存在，同一流程内名称必须唯一。」。自环返回「不能将节点连接到自身。」。

`POST /api/v1/commercial/projects` 只接受已发布版本。它新建项目、流程、制作包、节点和边；节点状态是 `not_reached`，项目阶段是 `pre_publish`。`commercial_projects.name` 没有唯一约束，也没有只覆盖名称的唯一索引，因此同名项目允许并存。这次创建不修改其他项目。

页面不再用内存里的 `default-flow-store` 当默认流程的数据源。删除节点前的确认仍写明将消失的连接，例如「删除节点「大纲」将同时移除以下连接：询单 → 大纲；大纲 → 发布。确认继续？」。

## 本地核对

```bash
cp .env.example .env
# 需要本机可连的 PostgreSQL。CI 已提供 postgres:16。
cd packages/db && bun run migrate
CI=true bun test
```
