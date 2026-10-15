# WP-004R2-3A — 商单流程引擎与写入 API

从当前 `main`（`8fad6a48c0b2dec8566b4cd3bcb4bd2a0ff28b8d`）实现。不改 WP-004R2-2 已经合并的表结构，没有新增迁移。

## 规则

1. **依赖与推进。** 节点只有在每个直接前驱是 `completed` 或 `not_applicable` 时才能进入 `in_progress`。汇合节点没有单独分支：它的前驱就是指向它的边。收集前驱时，`not_applicable` 会被换成它自己的前驱，并递归下去。跳过的可选节点既不挡住下游，也不把下游提前放行。拒绝时返回 409，`code = predecessors_incomplete`，并点名前驱，例如 `须先完成前置节点：文案、预拍摄`。
2. **阻塞与开放事项。** 阻塞原因可空。空白原因不会插入 `open_items`。`status_before_block` 记下阻塞前的状态，解除阻塞时恢复。`impact = blocking` 的开放事项可以钉成节点的 `primary_block_pinned_item_id`；关闭或取消该事项会在同一事务里解除阻塞。不适用节点不能挂主阻塞事项。
3. **回退。** 只有每个直接后继仍是 `not_reached` 时才能回退。否则 409，`code = successors_advanced`，并点名已推进的后继。`not_applicable` 可以清回 `not_reached`，目标状态仍然合法；后继已经离开 `not_reached` 时，清除同样被拒绝。
4. **发布与监控。** 完成「发布」节点必须在同一事务里写入发布记录、监控合同，以及该项目的一条 `metadata` 任务和一条 `metrics` 任务。任务保持 `pending`，不拉取、不执行。同一 `idempotency_key` 再提交不会复制任务。监控侧使用的标识是 `bvid`；请求里的视频链接只作为这个标识的来源。平台目前只接受 `bilibili`，因为发布记录和监控合同都只有 `bvid`，没有平台列。

## 写入

每次写入是一个数据库事务，流程变更和 `domain_audit_events` 一起提交。并发令牌是客户端上次读到的 `updated_at`（微秒 UTC 文本），过期返回 409 `stale_write`。没有为令牌加新列。

会违反数据库约束的写入交给约束自己拒绝，API 把约束错误转成 409 `constraint_violation`，带上约束名和数据库消息。可选节点才能标成不适用，这条不在应用层再写一遍。

| 方法 | 路径                                                               | 作用                                                |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------- |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/advance`     | `not_reached` → `in_progress`                       |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/complete`    | `in_progress` → `completed`（发布节点改走 publish） |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/skip`        | 标为 `not_applicable`                               |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/rollback`    | 回退一步，或清除不适用                              |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/block`       | 阻塞；空白原因不落事项                              |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/unblock`     | 恢复 `status_before_block`                          |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/publish`     | 完成发布节点并建立监控任务                          |
| POST | `/api/v1/commercial/projects/:projectId/open-items/:itemId/close`  | 关闭事项，钉住的阻塞自动解除                        |
| POST | `/api/v1/commercial/projects/:projectId/open-items/:itemId/cancel` | 取消事项，钉住的阻塞自动解除                        |

响应形状在 `@studio/contracts`。流程图读取里的节点增加 `updatedAt`，作为下一次写入的令牌。

## 明确不做

`apps/web`、Hermes 判别/提案/执行、采集器、微信/飞书/OneNote/B 站生产访问、部署与 Docker 变更。没有新增迁移：发布平台和视频链接不另开列，链接里的 BV 号写入已有的 `bvid`。
