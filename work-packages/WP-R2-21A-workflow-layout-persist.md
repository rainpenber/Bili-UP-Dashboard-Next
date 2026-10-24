# WP-R2-21A — 项目流程图写回：改名与位置持久化

## 范围

项目流程画布的节点改名与坐标批量写回数据库。不改连线拓扑。模板侧 layout 路由本包未开放（模板编辑仍只读证明）。

## API

- `GET /api/v1/commercial/projects/:projectId/workflow` 节点增加 `posX` / `posY`。
- `PATCH /api/v1/commercial/projects/:projectId/workflow/layout`
  - 请求：`{ nodes: [{ nodeId, expectedUpdatedAt, name?, posX?, posY? }] }`
  - 节点 id 集合必须与库内流程完全一致；任一令牌过期则整单 409 `stale_write`。
  - 名称：去首尾空白、非空、最长 60、流程内唯一；违规 400/409。
  - 归档 / 已结案：409 `invalid_transition`。
  - 不改写 `wf_edges`。
  - 响应：`{ projectId, updatedAt, nodes }`，节点形状与 GET workflow 一致。
  - 审计：`domain_audit_events` action=`layout`，detail 含修改前后名称/坐标摘要。

## 前端

- 改名与拖动/整理进入未保存态；「保存布局」或 Ctrl+S 一次提交。
- 失败展示后端文案并保留本地输入；成功用响应快照刷新并清空脏标记。
- 只读（归档 / 结案 / 业务展示态）无编辑与保存入口。

## 验收

`bun run format:check`、`bun run lint`、`bun run build`、相关测试通过。不部署生产。
