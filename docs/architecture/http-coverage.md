# HTTP API 覆盖

验收库 `wp_r2_11_b143bec9f4c5` 保留，本文件不执行 DROP DATABASE。

注册 57，清单 57，已执行 57，HTTP 成功 57，断言验收 57。

验收结论：通过。每一条注册路由都有一次 HTTP 成功响应，且发出该响应的测试断言已通过。

注入 transport 调用 8 次，逃逸到上游的 fetch 0 次。

## DELETE `/api/v1/monitor/targets/:id`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 409（拒绝响应，断言通过）

## GET `/api/health`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- health：HTTP 200（成功响应，断言通过）

## GET `/api/v1/assets/:assetId`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- assets：HTTP 200（成功响应，断言通过）
- assets：HTTP 304（成功响应，断言通过）
- assets：HTTP 200（成功响应，断言通过）
- assets：HTTP 200（成功响应，断言通过）

## GET `/api/v1/commercial/projects`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）

## GET `/api/v1/commercial/projects/:projectId`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 400（拒绝响应，断言通过）
- commercial：HTTP 404（拒绝响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## GET `/api/v1/commercial/projects/:projectId/workflow`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## GET `/api/v1/commercial/templates/default`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）

## GET `/api/v1/imports/:batchId`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- imports：HTTP 404（拒绝响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/cards`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 400（拒绝响应，断言通过）

## GET `/api/v1/monitor/cards/:type/:externalId`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/creators`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/creators/:mid`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 404（拒绝响应，断言通过）

## GET `/api/v1/monitor/creators/:mid/metrics`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/creators/:mid/videos`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 400（拒绝响应，断言通过）
- monitor-read：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/dynamics`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/dynamics/:id`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 404（拒绝响应，断言通过）

## GET `/api/v1/monitor/dynamics/:id/metrics`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/first-access-interventions`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/jobs`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/metadata/runs/:id`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- metadata-refresh：HTTP 400（拒绝响应，断言通过）
- metadata-refresh：HTTP 404（拒绝响应，断言通过）
- metadata-refresh：HTTP 200（成功响应，断言通过）
- metadata-refresh：HTTP 200（成功响应，断言通过）
- metadata-refresh：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/targets`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）

## GET `/api/v1/monitor/videos`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 400（拒绝响应，断言通过）

## GET `/api/v1/monitor/videos/:bvid`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 404（拒绝响应，断言通过）

## GET `/api/v1/monitor/videos/:bvid/metrics`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 200（成功响应，断言通过）
- monitor-read：HTTP 400（拒绝响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/collector-jobs`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/collector-jobs/:id`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/collector-targets`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/debug/bundle`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 400（拒绝响应，断言通过）

## GET `/api/v1/ops/health`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/logs`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 400（拒绝响应，断言通过）

## GET `/api/v1/ops/metadata/runs/:id`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- metadata-refresh：HTTP 200（成功响应，断言通过）
- ops：HTTP 400（拒绝响应，断言通过）

## GET `/api/v1/ops/operations`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/projects`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/requests`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/runs`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 200（成功响应，断言通过）

## GET `/api/v1/ops/runs/:id`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）
- ops：HTTP 400（拒绝响应，断言通过）
- ops：HTTP 404（拒绝响应，断言通过）

## GET `/api/v1/ops/summary`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- ops：HTTP 200（成功响应，断言通过）

## GET `/health`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- health：HTTP 200（成功响应，断言通过）

## PATCH `/api/v1/monitor/targets/:id`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 400（拒绝响应，断言通过）
- monitor-targets：HTTP 404（拒绝响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/advance`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 409（拒绝响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 404（拒绝响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/block`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/complete`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/plan`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 409（拒绝响应，断言通过）
- commercial：HTTP 400（拒绝响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/publish`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/rollback`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/skip`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 409（拒绝响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/step`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 409（拒绝响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/unblock`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/open-items/:itemId/cancel`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 409（拒绝响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/open-items/:itemId/close`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/commercial/projects/:projectId/stages/:stageId/step`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- commercial：HTTP 200（成功响应，断言通过）

## POST `/api/v1/imports/csv`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- imports：HTTP 400（拒绝响应，断言通过）
- imports：HTTP 400（拒绝响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）
- imports：HTTP 200（成功响应，断言通过）

## POST `/api/v1/monitor/creators/:mid/refresh`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- metadata-refresh：HTTP 200（成功响应，断言通过）
- metadata-refresh：HTTP 404（拒绝响应，断言通过）

## POST `/api/v1/monitor/metadata/refresh`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- metadata-refresh：HTTP 400（拒绝响应，断言通过）
- metadata-refresh：HTTP 202（成功响应，断言通过）
- metadata-refresh：HTTP 409（拒绝响应，断言通过）
- metadata-refresh：HTTP 202（成功响应，断言通过）
- metadata-refresh：HTTP 202（成功响应，断言通过）

## POST `/api/v1/monitor/targets`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 400（拒绝响应，断言通过）
- monitor-targets：HTTP 400（拒绝响应，断言通过）
- monitor-targets：HTTP 400（拒绝响应，断言通过）
- monitor-targets：HTTP 400（拒绝响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）

## POST `/api/v1/monitor/targets/:id/run`

- 前端调用：有
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 200（成功响应，断言通过）
- monitor-targets：HTTP 409（拒绝响应，断言通过）

## POST `/api/v1/monitor/videos/:bvid/refresh`

- 前端调用：无
- 已执行：是
- HTTP 成功：是
- 断言验收：是
- metadata-refresh：HTTP 200（成功响应，断言通过）
- metadata-refresh：HTTP 404（拒绝响应，断言通过）
