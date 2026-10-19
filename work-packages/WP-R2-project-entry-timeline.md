# WP-R2：正常项目入口与已认可时间轴详情

基线 `d9403dd6ffbc4ce5a1319f852e8027ebcb94fb59`。本包只扩展已有只读合同，并把首页、项目列表和 UUID 详情接到同一数据库项目 ID。不改工作流状态机，不加表，不导入真实商单。

## 已接上

- 首页和项目列表调用 `GET /api/v1/commercial/projects`，经 `parseCommercialProjectList`。失败、缺字段和空列表都停在错误或空态，不回退 `commercial-mock-api`。
- 列表卡片、首页事项和阻塞行都链接 `/projects/{commercial_projects.id}`。UUID 详情仍是已认可的概要、时间轴、阶段详情、已发布视频和节点图，并在概要与时间轴之间只读展示 `openItems`。
- 非 UUID `/projects/:projectId` 只说明这是演示书签，并给出返回列表和 `/projects/demo/:projectId` 的链接。不按名称改去别的项目。`/workflow-mock` 仍在。
- 步进和改计划成功后失效 `['commercial','projects']`、项目详情和 workflow 查询。

## 读取合同新增字段

列表项和详情共用这些字段。缺任一字段时解析失败。

| 字段               | 来源                                                                                                                                                                                                                                   | 空值                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `blockingReason`   | 与详情原有投影相同：钉住或 `blocks_node_id` 指向阻塞节点的开放阻塞事项标题                                                                                                                                                             | 没有这样的事项则为 `null`，显示「未记录」                                            |
| `createdAt`        | `commercial_projects.created_at`                                                                                                                                                                                                       | 列非空。列表「创建日不早于」用它的上海日历日                                         |
| `userDeadlineAt`   | `commercial_projects.user_deadline_at`                                                                                                                                                                                                 | `null` 显示「未定」                                                                  |
| `blockedSinceAt`   | `commercial_projects.blocked_since_at`                                                                                                                                                                                                 | `null` 显示「未记录」。不从它推算卡住天数                                            |
| `archivedAt`       | `commercial_projects.archived_at`                                                                                                                                                                                                      | `null` 表示没有归档时间。`overall_stage = archived` 或该时间非空都视为归档，不进待办 |
| `stageEnteredAt`   | `commercial_projects.stage_entered_at`                                                                                                                                                                                                 | 列非空                                                                               |
| `businessClosedAt` | `commercial_projects.business_closed_at`                                                                                                                                                                                               | 可为 `null`                                                                          |
| `blockedNodeNames` | `wf_nodes.name`，`status = blocked`，按 `pos_y, pos_x, id`                                                                                                                                                                             | 空数组表示没有阻塞节点名                                                             |
| `openItems[]`      | `open_items` 的 `title`、`description`、`close_criteria`、`next_action`、`next_actor`、`lifecycle`、`impact`、`planned_at`、`sort_rank`、`blocks_required_for_close`、`workflow_node_id`、`blocks_node_id`、`created_at`、`updated_at` | `planned_at` / `next_action` 等可空列保持 `null`。含 `closed` 和 `cancelled`         |

事项按所属 `project_id` 挂到项目上。待办只取 `lifecycle = open`，再按 `next_actor` 分我方和甲方。

## 尚未接上

- 没有品牌字段，列表不能按品牌搜索。
- 不计算卡住天数，也不把 `updated_at` 当成计划或完成时间。
- 没有单独的开放事项 GET，也没有事项写路径。改名、画布四格、拖动和坐标仍不落库。
- 演示发布仍使用 `localStorage` 前缀 `commercial-mock-publish:`，只在显式演示页。
- 本包没有在 bili-test 上做浏览器验收。路由级测试使用 API fixture，不代表共享预览库或 390/1440 布局已复验。
