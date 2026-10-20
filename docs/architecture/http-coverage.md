# HTTP API 覆盖

验收库 `wp_r2_11_89114f0274d8` 保留，本文件不执行 DROP DATABASE。

注册 49，清单 49，已执行 49，成功路径 49。

注入 transport 调用 8 次，逃逸到上游的 fetch 0 次。

## DELETE `/api/v1/monitor/targets/:id`

- 前端调用：有
- 成功路径：是
- monitor-targets：200（success）
- monitor-targets：409（reject）

## GET `/api/health`

- 前端调用：有
- 成功路径：是
- health：200（success）

## GET `/api/v1/assets/:assetId`

- 前端调用：有
- 成功路径：是
- assets：200（success）
- assets：304（success）
- assets：200（success）
- assets：200（success）

## GET `/api/v1/commercial/projects`

- 前端调用：有
- 成功路径：是
- commercial：200（success）

## GET `/api/v1/commercial/projects/:projectId`

- 前端调用：有
- 成功路径：是
- commercial：400（reject）
- commercial：404（reject）
- commercial：200（success）
- commercial：200（success）

## GET `/api/v1/commercial/projects/:projectId/workflow`

- 前端调用：有
- 成功路径：是
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）

## GET `/api/v1/commercial/templates/default`

- 前端调用：有
- 成功路径：是
- commercial：200（success）

## GET `/api/v1/imports/:batchId`

- 前端调用：无
- 成功路径：是
- imports：404（reject）
- imports：200（success）

## GET `/api/v1/monitor/creators`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）

## GET `/api/v1/monitor/creators/:mid`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）
- monitor-read：404（reject）

## GET `/api/v1/monitor/creators/:mid/metrics`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）

## GET `/api/v1/monitor/creators/:mid/videos`

- 前端调用：有
- 成功路径：是
- monitor-read：400（reject）
- monitor-read：200（success）

## GET `/api/v1/monitor/dynamics`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）

## GET `/api/v1/monitor/dynamics/:id`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）
- monitor-read：404（reject）

## GET `/api/v1/monitor/dynamics/:id/metrics`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）
- monitor-read：200（success）

## GET `/api/v1/monitor/jobs`

- 前端调用：有
- 成功路径：是
- monitor-targets：200（success）

## GET `/api/v1/monitor/metadata/runs/:id`

- 前端调用：无
- 成功路径：是
- metadata-refresh：400（reject）
- metadata-refresh：404（reject）
- metadata-refresh：200（success）
- metadata-refresh：200（success）
- metadata-refresh：200（success）

## GET `/api/v1/monitor/targets`

- 前端调用：有
- 成功路径：是
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）

## GET `/api/v1/monitor/videos`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）
- monitor-read：200（success）
- monitor-read：200（success）
- monitor-read：400（reject）

## GET `/api/v1/monitor/videos/:bvid`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）
- monitor-read：404（reject）

## GET `/api/v1/monitor/videos/:bvid/metrics`

- 前端调用：有
- 成功路径：是
- monitor-read：200（success）
- monitor-read：200（success）
- monitor-read：400（reject）

## GET `/api/v1/ops/debug/bundle`

- 前端调用：有
- 成功路径：是
- ops：200（success）
- ops：400（reject）

## GET `/api/v1/ops/health`

- 前端调用：有
- 成功路径：是
- ops：200（success）

## GET `/api/v1/ops/logs`

- 前端调用：有
- 成功路径：是
- ops：200（success）
- ops：200（success）
- ops：200（success）
- ops：400（reject）

## GET `/api/v1/ops/metadata/runs/:id`

- 前端调用：无
- 成功路径：是
- metadata-refresh：200（success）
- ops：400（reject）

## GET `/api/v1/ops/requests`

- 前端调用：无
- 成功路径：是
- ops：200（success）

## GET `/api/v1/ops/runs`

- 前端调用：有
- 成功路径：是
- ops：200（success）
- ops：200（success）
- ops：200（success）

## GET `/api/v1/ops/runs/:id`

- 前端调用：有
- 成功路径：是
- ops：200（success）
- ops：400（reject）
- ops：404（reject）

## GET `/api/v1/ops/summary`

- 前端调用：有
- 成功路径：是
- ops：200（success）

## GET `/health`

- 前端调用：无
- 成功路径：是
- health：200（success）

## PATCH `/api/v1/monitor/targets/:id`

- 前端调用：有
- 成功路径：是
- monitor-targets：200（success）
- monitor-targets：400（reject）
- monitor-targets：404（reject）
- monitor-targets：200（success）
- monitor-targets：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/advance`

- 前端调用：无
- 成功路径：是
- commercial：409（reject）
- commercial：200（success）
- commercial：404（reject）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/block`

- 前端调用：无
- 成功路径：是
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/complete`

- 前端调用：无
- 成功路径：是
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/plan`

- 前端调用：有
- 成功路径：是
- commercial：200（success）
- commercial：409（reject）
- commercial：400（reject）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/publish`

- 前端调用：无
- 成功路径：是
- commercial：200（success）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/rollback`

- 前端调用：无
- 成功路径：是
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/skip`

- 前端调用：无
- 成功路径：是
- commercial：200（success）
- commercial：409（reject）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/step`

- 前端调用：有
- 成功路径：是
- commercial：200（success）
- commercial：409（reject）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/nodes/:nodeId/unblock`

- 前端调用：无
- 成功路径：是
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/open-items/:itemId/cancel`

- 前端调用：无
- 成功路径：是
- commercial：409（reject）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/open-items/:itemId/close`

- 前端调用：无
- 成功路径：是
- commercial：200（success）
- commercial：200（success）

## POST `/api/v1/commercial/projects/:projectId/stages/:stageId/step`

- 前端调用：有
- 成功路径：是
- commercial：200（success）

## POST `/api/v1/imports/csv`

- 前端调用：无
- 成功路径：是
- imports：400（reject）
- imports：400（reject）
- imports：200（success）
- imports：200（success）
- imports：200（success）

## POST `/api/v1/monitor/creators/:mid/refresh`

- 前端调用：无
- 成功路径：是
- metadata-refresh：200（success）
- metadata-refresh：404（reject）

## POST `/api/v1/monitor/metadata/refresh`

- 前端调用：无
- 成功路径：是
- metadata-refresh：400（reject）
- metadata-refresh：202（success）
- metadata-refresh：409（reject）
- metadata-refresh：202（success）
- metadata-refresh：202（success）

## POST `/api/v1/monitor/targets`

- 前端调用：有
- 成功路径：是
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：400（reject）
- monitor-targets：400（reject）
- monitor-targets：400（reject）
- monitor-targets：400（reject）
- monitor-targets：200（success）
- monitor-targets：200（success）
- monitor-targets：200（success）

## POST `/api/v1/monitor/targets/:id/run`

- 前端调用：有
- 成功路径：是
- monitor-targets：200（success）
- monitor-targets：409（reject）

## POST `/api/v1/monitor/videos/:bvid/refresh`

- 前端调用：无
- 成功路径：是
- metadata-refresh：200（success）
- metadata-refresh：404（reject）
