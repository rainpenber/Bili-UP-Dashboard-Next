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

## 默认流程种子

`default_sponsorship` 版本 1 是已发布的默认模板，**14 个节点、16 条边**。汇合节点恰好一个，名字是「汇合节点」，可选，不属于制作包，放在「文案 / 预拍摄」和「A-roll 拍摄 / B-roll 素材 / AI 后期」之间。这一段是 5 条边，不是原先的 6 条直连：

- 文案 → 汇合节点
- 预拍摄 → 汇合节点
- 汇合节点 → A-roll 拍摄
- 汇合节点 → B-roll 素材
- 汇合节点 → AI 后期

其余边：询单 → 大纲；大纲 → 文案、预拍摄；A-roll 拍摄 / B-roll 素材 / AI 后期 → 审核；审核 → 发布；发布 → 结算、全平台分发、数据维护、其他。

页面 Mock 上曾经画过 17 条边。本包的种子是数据层的依据，计数以 14 / 16 为准。

`seedCommercialFixtures` 可以重复执行。样例节点的 `status`，以及样例开放事项的生命周期、影响和 `blocks_node_id`，会按样例写回，不会停在 `ON CONFLICT DO NOTHING` 留下的旧行上。样例项目里，节点 `status = 'blocked'` 当且仅当存在一条 `lifecycle = 'open'`、`impact = 'blocking'`、并且通过 `primary_block_pinned_item_id` 或 `blocks_node_id` 关联到该节点的开放事项。阻塞节点会钉住这条主阻塞事项，并把 `status_before_block` 记为 `in_progress`（写入接口只从进行中进入阻塞）。引擎仍然允许一次没有原因的阻塞；这条不变式约束的是样例数据，不是表上的 CHECK。

## 只读 API

响应形状在 `@studio/contracts`。流程图节点带 `updatedAt`，这是写入时要原样交回的并发令牌。

| 方法 | 路径                                              | 内容                                               |
| ---- | ------------------------------------------------- | -------------------------------------------------- |
| GET  | `/api/v1/commercial/projects`                     | 名称、到手金额、返点金额、当前阶段、是否有节点阻塞 |
| GET  | `/api/v1/commercial/projects/:projectId`          | 金额、当前阶段、阻塞原因、发布状态                 |
| GET  | `/api/v1/commercial/projects/:projectId/workflow` | 节点（状态、种类、updatedAt）与边                  |
| GET  | `/api/v1/commercial/templates/default`            | 已发布的默认流程模板及其图                         |

金额是 `numeric(14,2)` 的十进制字符串。`overallStage` 是项目上存储的阶段。`currentStageNames` 是状态为 `in_progress` 或 `blocked` 的节点名，按 `pos_y`、`pos_x`、`id` 排序；没有进行中或阻塞节点时为空数组。`blockingReason` 取仍开放且 `impact = blocking`、并且钉在阻塞节点上或 `blocks_node_id` 指向阻塞节点的事项标题；优先被钉住的事项，其次 `sort_rank`、创建时间、`id`。没有这样的事项时为 `null`。

图和模板节点按 `pos_y`、`pos_x`、`id` 排列。项目列表按 `created_at`、`id` 排列。

## 写入 API（WP-004R2-3A）

规则在 `packages/workflow`，不按节点种类分叉。汇合节点就是普通节点。推进到 `in_progress` 时，直接前驱必须是 `completed` 或 `not_applicable`；`not_applicable` 会递归换成它自己的前驱。回退要求每个直接后继仍是 `not_reached`。拒绝是 409，并点名挡住的节点。

阻塞原因可空。空白不会插入开放事项。`status_before_block` 保存阻塞前状态。钉住的 `impact = blocking` 事项被关闭或取消时，同一事务解除阻塞。

完成「发布」节点必须在同一事务写入 `project_publish_records`、`project_monitor_contracts`，以及该项目各一条 `metadata` / `metrics` 的 `monitor_jobs`（`pending`，不执行）。幂等靠 `idempotency_key` 和 `UNIQUE (project_id, job_type)`。监控标识是已有的 `bvid`。请求可以带视频链接，链接里的 BV 号写入 `bvid`；平台只接受 `bilibili`，因为表上没有平台列。

每次写入一个事务，和 `domain_audit_events` 一起提交。并发令牌是 `updated_at`。违反数据库约束时返回 409，消息来自约束本身。路径见 [WP-004R2-3A](../../work-packages/WP-004R2-3A-commercial-workflow-engine.md)。

`POST .../nodes/:nodeId/step` 和 `POST .../stages/:stageId/step` 在同一个事务里完成上游闭包或阶段前沿、阻塞事项关闭和项目 `overall_stage` 重算。有开放阻塞时返回 409 `confirmation_required` 且不写入；带 `force: true` 才关闭阻塞事项并继续。完成发布节点仍要在这一次请求里带上发布信息，缺了就整单拒绝。阶段 id 是 `write_outline`、`copy_prep`、`production`、`client_review`、`distribution_settlement`。归档或已结案项目拒绝这些写入。见 [WP-004R2-9](../../work-packages/WP-004R2-9-commercial-step-actions.md)。

## 本地核对

```bash
cp .env.example .env
# 需要本机可连的 PostgreSQL。CI 已提供 postgres:16。
cd packages/db && bun run migrate
CI=true bun test
```
