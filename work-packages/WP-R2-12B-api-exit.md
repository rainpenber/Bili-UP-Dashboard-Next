# WP-R2-12B API 退出协调

起点：`cursor/log-capacity-collector-exit-2596` @ `9da02ffe12de405b930125c7421a9a21ee5b1171`。12A 已验收日志容量与 Collector 退出。本包只做 API 进程入口的退出边界，不改日志队列、Collector 循环、元数据算法或公开路由合同。

旧入口曾在退出开始时对后台数组做一次快照。信号到达时 HTTP 仍在处理、backfill 尚未登记，快照是空的，随后登记的后台工作被当成已经完成，进程以 0 退出。本包不迁移那套入口。

## 不变量

1. **完整工作边界**。退出开始后新的 HTTP 返回 503。已经接受的请求，以及这些请求在信号前或信号后登记的进程内后台 Promise，都留在同一组活动引用里。引用在结算后释放。预算内全部完成才是退出码 0；拒绝、超时或停止事件没有持久化则不是 0，诊断脱敏。更早已经独立结算的失败不让以后的健康退出一直失败。
2. **复用有期限的退出序列**。当前工作、`service.stopped`、flush、retention、SQL 关闭沿用 12A 的 shutdown 控制器。默认 flush 10 秒，退出预算 20 秒。`app` 与开发用 `api` 的 `stop_grace_period` 是 30 秒。SIGTERM / SIGINT 与重复信号只收尾一次。入口只保留 Bun 对 default export 启动的那一个服务器。
3. **离线证据**。真实 API 入口、隔离的真 PostgreSQL、离线 fixture transport 与图片下载。测试开关只在 `LOG_LIFECYCLE_TEST=1` 时生效，不增加生产管理接口。缺 PostgreSQL 时进程在写出 `service.started` 之前以非 0 退出。验收库只关闭连接，不 DROP DATABASE。API 不负责清空独立 Worker 的采集任务。

## 允许与禁止

允许：`apps/api/src/index.ts`、进程内活动工作跟踪、生命周期测试与离线 fixture、app / 开发 api 的 flush、退出预算和 grace、本规格与观测/部署说明。

禁止：UI、公开合同、迁移、元数据业务函数、Collector、logger、共享 shutdown 的重写，以及采集、鉴权、限频算法。不部署、不合并。产品镜像上的 `docker stop` 与 30 秒 grace 不在本包执行。

## 结果

真实入口证据前缀 `WP-R2-12B-EVIDENCE`。下表是同一次 `apps/api` lifecycle suite。库保留，没有 DROP DATABASE。

| 场景                                                                      | 保留库                   | 标识                                       | 结果                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| SIGTERM 短尾，重复信号，采集任务仍 pending                                | `wp_r2_12b_22d0e8aed22a` | `api-6f159b76-585c-4ab6-a52d-5c445335912f` | 退出码 0；19ms；`service.started`、`service.stopped`；stderr 空；job `pending`                                                       |
| SIGINT 短尾，重复信号                                                     | `wp_r2_12b_3836476678a0` | `api-a1c949ac-367f-4ad2-8f99-d19c8bf6303f` | 退出码 0；9ms；started / stopped 各 1；stderr 空                                                                                     |
| 在途 SQL 请求完成，新请求 503，重复 SIGTERM 有 `process.signal_duplicate` | `wp_r2_12b_93e122fbcbd7` | `api-436b7019-e3f5-43e2-bec9-9f03717c6c02` | 退出码 0；703ms；在途 200，`totalItems` 0；新请求 503                                                                                |
| 已返回 202 后慢 backfill 完成                                             | `wp_r2_12b_e9d6a2c60fe7` | `api-cbdaedd6-997c-4134-8224-cdc75cad1d18` | 退出码 0；631ms；run `50ab9b9c-e8cf-43c4-9373-80ad7846652b` succeeded；视频 `接口标题` / `ok` / `ok`；含 `backfill.finished`         |
| 已返回 202 后 backfill 永挂                                               | `wp_r2_12b_c32610ee9339` | `api-83407a20-735a-4c5a-8a7e-52168c506a26` | 退出码 1；1259ms；run `9575cf9a-b972-4a4a-b410-0b6b3c9089fe` 仍 running；无视频行；`task=timed_out`                                  |
| 信号后才登记的慢 backfill                                                 | `wp_r2_12b_60a466cfc30c` | `api-3e22e60e-434d-4818-b090-f387bdb9ce2f` | 信号时 HTTP 状态仍为 0；202 在信号后 597ms；退出码 0；1021ms；run `2ccdc4e0-ebf4-490b-9cee-04c758087cec` succeeded                   |
| 信号后才登记的永挂 backfill                                               | `wp_r2_12b_cc6c77bb2bb8` | `api-dfc0d7af-a2a6-4651-8bc1-4e5183211032` | 信号时 HTTP 状态仍为 0；202 在信号后 599ms；退出码 1；1760ms；run `ad6a568d-f307-482d-8655-3f21dfc478e5` 仍 running                  |
| 活动后台拒绝，sink 正常                                                   | `wp_r2_12b_184613e3fd02` | `api-28038cb4-4aba-4ed6-9fad-6ab49e2b9cb5` | 退出码 1；527ms；run `68e4065c-a95d-4910-8a27-38dbaaced5fb`；`task=failed`；诊断 `metadata-backfill-rejected [redacted]; [redacted]` |
| 已结算的拒绝之后健康退出                                                  | `wp_r2_12b_690ea0df896c` | `api-570bc71d-0df7-4af6-8d90-9c3800c724af` | 退出码 0；7ms；run `c0cc3871-21c1-45f3-a76f-06acb8272c00`；无 `shutdown_incomplete`                                                  |
| 慢 sink                                                                   | `wp_r2_12b_1ec228233ac0` | `api-6aa78f97-56ed-4dab-9ab3-0936dcfbc8e2` | 退出码 0；416ms；started / stopped                                                                                                   |
| 失败 sink                                                                 | `wp_r2_12b_c8a80ea1013c` | `api-63e3e9a0-4ed6-48a6-b9cb-684ad32abf97` | 退出码 1；8ms；`flushReason=sink_failed`；无 `service.stopped`                                                                       |
| 永挂 sink                                                                 | `wp_r2_12b_e918b3374cac` | `api-2110c8d3-a8cf-4aa6-8999-527e109a9dd0` | 退出码 1；408ms；flush 400ms / 退出预算 1500ms                                                                                       |
| 满队列后停止事件恢复，重复 SIGINT                                         | `wp_r2_12b_0462d25d28e6` | `api-aa8ae0a9-b7b2-432d-88ad-5f7595e4012e` | 退出码 0；814ms；started / stopped；含 `process.signal_duplicate`                                                                    |
| 满队列且 sink 永挂，停止事件进不去                                        | `wp_r2_12b_011afa6e335b` | `api-c2384928-8011-4991-af2a-cfadd9b08e3b` | 退出码 1；407ms；`stopEventAccepted=false`；入库 0 条                                                                                |
| 资源关闭挂起，期限切断                                                    | `wp_r2_12b_e3706b40f5d3` | `api-dc414ce3-7ff5-47a6-87c3-4e6479934226` | 退出码 0；1454ms；预算 1500ms；父进程仍能查询该库                                                                                    |
| 缺 PostgreSQL                                                             | 无新库                   | `api-a76445a5-5e97-4b6d-ac9e-b40811b8d6a8` | 退出码 1；72ms；没有 `service.started`                                                                                               |

短尾上的第二次信号是紧接着发出的，操作系统可能把两次投递合并；进程仍只有一条停止事件。第二次信号在退出尚未结束时被单独送达，由在途 HTTP 用例和满队列用例覆盖，stdout 有 `process.signal_duplicate`，停止事件仍是一条。

同一次全量测试里，HTTP 覆盖报告仍是注册 49、清单 49、已执行 49、HTTP 成功 49、断言验收 49。这次覆盖库是 `wp_r2_11_4dbb4db6b058`，只保留，不 DROP。

产品镜像和 Compose 里 30 秒 `stop_grace_period` 的实际 `docker stop` 未在本包执行。
