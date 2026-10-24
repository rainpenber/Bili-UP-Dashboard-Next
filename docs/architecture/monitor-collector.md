# 离线监控项与 Collector

WP-R2-05 的离线采集器仍然是默认路径。`COLLECTOR_PROVIDER=offline`（或未设置时沿用 `MONITOR_PROVIDER=offline`）不会请求 B 站。真实采集见 [real-collector.md](./real-collector.md)。未实现的采集源在启动时失败退出。

商单发布写下的 `monitor_jobs` 仍是项目域的待执行记录，本采集器不读取、不更新它。

## 表

| 表                     | 作用                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `monitor_targets`      | 视频 BV 或 UP 主 UID。未删除的 `(type, external_id)` 唯一                           |
| `collector_jobs`       | `pending` / `running` / `succeeded` / `failed`。同一目标的同一 `scheduled_for` 唯一 |
| `collector_runs`       | 一次执行的样本数、耗时、成功或失败                                                  |
| `collector_heartbeats` | Collector 实例心跳                                                                  |

样本仍写入既有的 `video_metric_samples` 与 `creator_follower_samples`。冲突键是目标加采样时刻，重复执行不覆盖、不删除历史点。

## 进程

`docker-compose.yml` 的 `collector` 服务使用与 `app` 相同的镜像，命令为 `bun run apps/collector/src/index.ts`。它只连接 Compose 网络里的 `postgres`，不发布端口。轮询待执行任务时用 `FOR UPDATE SKIP LOCKED`，失败按次数退避，达到 `COLLECTOR_MAX_ATTEMPTS`（默认 3）后把任务记为 `failed`。SIGTERM / SIGINT 会停止领取新任务，等当前任务在退出预算内结束，刷完日志再退出。`stop_grace_period` 是 30 秒。主循环自身失败时退出码不是 0。

迁移只由 API 在启动时执行。Collector 发现表还没建好时会有界等待，不会自己跑迁移。本地单次进程：

```bash
MONITOR_DATA_SOURCE=collector MONITOR_PROVIDER=offline bun run apps/collector/src/index.ts
```

夹具目录默认是 `packages/monitoring/fixtures/mock-data`。设置 `MOCK_DATA_ROOT` 时该目录必须存在；`OFFLINE_REQUIRE_FIXTURE=1` 时，目标缺少对应夹具文件会让该次任务失败。

## API

- `POST /api/v1/monitor/targets`
- `GET /api/v1/monitor/targets`
- `PATCH /api/v1/monitor/targets/:id`
- `DELETE /api/v1/monitor/targets/:id`
- `POST /api/v1/monitor/targets/:id/run`
- `GET /api/v1/monitor/first-access-interventions`
- `GET /api/v1/monitor/jobs`
- `GET /api/v1/monitor/cards?type=video|creator&monitor=all|active|paused|unmonitored`
- `GET /api/v1/monitor/cards/:type/:externalId`
- 视频默认过滤：只返回「存在未删除监控目标」或「被 `project_publish_records` / `project_monitor_contracts` 引用」的条目；`includeUnmonitored=1` 显示全部（供排查，无 UI 开关）。`totalItems` 与过滤一致。
- `GET /api/v1/media/image?url=`：受控图片代理（`*.hdslb.com` / `*.bilibili.com` 白名单 + Referer + 进程内 LRU）；卡片 `imageUrl` 为原始地址，`imageProxyUrl` / `bilibiliMediaProxyUrl()` 给浏览器用。
- `GET/POST /api/v1/monitor/creators/:mid/uploads/sync`、`.../dynamics/sync`、`.../media/backfill`：投稿元信息 / 动态事件 / 头像封面回填（TTL 6h；backfill 会资源化并回写 `face_asset_id` / `cover_asset_id`，见 [media-proxy-and-backfill.md](./media-proxy-and-backfill.md)）。
- `GET /api/v1/monitor/creators/:mid/metrics?all=1`：可取全量粉丝样本（上限 20000），响应含 `totalItems`。前端粉丝图默认用 `all=1`，dataZoom 默认近 90 天，`?allEvents=1` 扩展事件横轴。

视频 / UP 主页面读的是上面的卡片投影，不是把 `GET /targets` 整页拉到浏览器后再和当前视频页对拍。投影是 `videos` 或 `creators` 与未删除的 `monitor_targets` 做有界全外连接：目标可以先于实体存在。筛选、搜索和总数在同一次查询里计算。卡片状态只看活动目标的 `enabled`，不看 `videos.monitoring_enabled` / `creators.monitoring_enabled`。

商单跳转只认 `project_publish_records.bvid` 与 `project_monitor_contracts.bvid`。`linked_bvid` 不参与匹配。UP 主表和商单表之间没有 UID 关系，所以 UP 主卡片不显示商单入口。暂停不改这两张表，项目结案也不改 `monitor_targets.enabled`。

`?tab=targets` 打开视频页。最近采集任务仍在监控中心底部。运行记录页接受 `targetId`、`targetType`、`externalId`，并按 `targetId` 预筛选。

错误体为 `{ "error": "中文说明", "code": "机器可读码" }`。重复添加返回既有记录，并带 `code: "target_exists"`。
