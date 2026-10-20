# HTTP API 覆盖

验收库 `wp_r2_11_f11fb678fdc5` 保留，本文件不执行 DROP DATABASE。
注册 49，清单 49，已执行 49，成功路径 49。
注入 transport 调用 8 次，逃逸到上游的 fetch 0 次。

| 方法 | 路径 | 前端 | 成功 | 用例 |
| --- | --- | --- | --- | --- |
| DELETE | `/api/v1/monitor/targets/:id` | 有 | 是 | monitor-targets 200<br>monitor-targets 409 |
| GET | `/api/health` | 有 | 是 | health 200 |
| GET | `/api/v1/assets/:assetId` | 有 | 是 | assets 200<br>assets 304<br>assets 200<br>assets 200 |
| GET | `/api/v1/commercial/projects` | 有 | 是 | commercial 200 |
| GET | `/api/v1/commercial/projects/:projectId` | 有 | 是 | commercial 400<br>commercial 404<br>commercial 200<br>commercial 200 |
| GET | `/api/v1/commercial/projects/:projectId/workflow` | 有 | 是 | commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200 |
| GET | `/api/v1/commercial/templates/default` | 有 | 是 | commercial 200 |
| GET | `/api/v1/imports/:batchId` | 无 | 是 | imports 404<br>imports 200 |
| GET | `/api/v1/monitor/creators` | 有 | 是 | monitor-read 200 |
| GET | `/api/v1/monitor/creators/:mid` | 有 | 是 | monitor-read 200<br>monitor-read 404 |
| GET | `/api/v1/monitor/creators/:mid/metrics` | 有 | 是 | monitor-read 200 |
| GET | `/api/v1/monitor/creators/:mid/videos` | 有 | 是 | monitor-read 400<br>monitor-read 200 |
| GET | `/api/v1/monitor/dynamics` | 有 | 是 | monitor-read 200 |
| GET | `/api/v1/monitor/dynamics/:id` | 有 | 是 | monitor-read 200<br>monitor-read 404 |
| GET | `/api/v1/monitor/dynamics/:id/metrics` | 有 | 是 | monitor-read 200<br>monitor-read 200 |
| GET | `/api/v1/monitor/jobs` | 有 | 是 | monitor-targets 200 |
| GET | `/api/v1/monitor/metadata/runs/:id` | 无 | 是 | metadata-refresh 400<br>metadata-refresh 404<br>metadata-refresh 200<br>metadata-refresh 200<br>metadata-refresh 200 |
| GET | `/api/v1/monitor/targets` | 有 | 是 | monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200 |
| GET | `/api/v1/monitor/videos` | 有 | 是 | monitor-read 200<br>monitor-read 200<br>monitor-read 200<br>monitor-read 400 |
| GET | `/api/v1/monitor/videos/:bvid` | 有 | 是 | monitor-read 200<br>monitor-read 404 |
| GET | `/api/v1/monitor/videos/:bvid/metrics` | 有 | 是 | monitor-read 200<br>monitor-read 200<br>monitor-read 400 |
| GET | `/api/v1/ops/debug/bundle` | 有 | 是 | ops 200<br>ops 400 |
| GET | `/api/v1/ops/health` | 有 | 是 | ops 200 |
| GET | `/api/v1/ops/logs` | 有 | 是 | ops 200<br>ops 200<br>ops 200<br>ops 400 |
| GET | `/api/v1/ops/metadata/runs/:id` | 无 | 是 | metadata-refresh 200<br>ops 400 |
| GET | `/api/v1/ops/requests` | 无 | 是 | ops 200 |
| GET | `/api/v1/ops/runs` | 有 | 是 | ops 200<br>ops 200<br>ops 200 |
| GET | `/api/v1/ops/runs/:id` | 有 | 是 | ops 200<br>ops 400<br>ops 404 |
| GET | `/api/v1/ops/summary` | 有 | 是 | ops 200 |
| GET | `/health` | 无 | 是 | health 200 |
| PATCH | `/api/v1/monitor/targets/:id` | 有 | 是 | monitor-targets 200<br>monitor-targets 400<br>monitor-targets 404<br>monitor-targets 200<br>monitor-targets 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/advance` | 无 | 是 | commercial 409<br>commercial 200<br>commercial 404<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/block` | 无 | 是 | commercial 200<br>commercial 200<br>commercial 200<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/complete` | 无 | 是 | commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/plan` | 有 | 是 | commercial 200<br>commercial 409<br>commercial 400 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/publish` | 无 | 是 | commercial 200<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/rollback` | 无 | 是 | commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/skip` | 无 | 是 | commercial 200<br>commercial 409 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/step` | 有 | 是 | commercial 200<br>commercial 409<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/nodes/:nodeId/unblock` | 无 | 是 | commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/open-items/:itemId/cancel` | 无 | 是 | commercial 409<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/open-items/:itemId/close` | 无 | 是 | commercial 200<br>commercial 200 |
| POST | `/api/v1/commercial/projects/:projectId/stages/:stageId/step` | 有 | 是 | commercial 200 |
| POST | `/api/v1/imports/csv` | 无 | 是 | imports 400<br>imports 400<br>imports 200<br>imports 200<br>imports 200 |
| POST | `/api/v1/monitor/creators/:mid/refresh` | 无 | 是 | metadata-refresh 200<br>metadata-refresh 404 |
| POST | `/api/v1/monitor/metadata/refresh` | 无 | 是 | metadata-refresh 400<br>metadata-refresh 202<br>metadata-refresh 409<br>metadata-refresh 202<br>metadata-refresh 202 |
| POST | `/api/v1/monitor/targets` | 有 | 是 | monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200<br>monitor-targets 400<br>monitor-targets 400<br>monitor-targets 400<br>monitor-targets 400<br>monitor-targets 200<br>monitor-targets 200<br>monitor-targets 200 |
| POST | `/api/v1/monitor/targets/:id/run` | 有 | 是 | monitor-targets 200<br>monitor-targets 409 |
| POST | `/api/v1/monitor/videos/:bvid/refresh` | 无 | 是 | metadata-refresh 200<br>metadata-refresh 404 |
