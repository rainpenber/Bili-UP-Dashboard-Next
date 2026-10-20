# WP-R2-12B API 退出协调

起点：`cursor/log-capacity-collector-exit-2596` @ `9da02ffe12de405b930125c7421a9a21ee5b1171`。12A 已验收日志容量与 Collector 退出。本包只做 API 进程入口的退出边界，不改日志队列、Collector 循环、元数据算法或公开路由合同。

旧入口曾在退出开始时对后台数组做一次快照。信号到达时 HTTP 仍在处理、backfill 尚未登记，快照是空的，随后登记的后台工作被当成已经完成，进程以 0 退出。本包不迁移那套入口。

## 不变量

1. **完整工作边界**。退出开始后新的 HTTP 返回 503。已经接受的请求，以及这些请求在信号前或信号后登记的进程内后台 Promise，都留在同一组活动引用里。引用在结算后释放。预算内全部完成才是退出码 0；拒绝、超时或停止事件没有持久化则不是 0，诊断脱敏。更早已经独立结算的失败不让以后的健康退出一直失败。
2. **复用有期限的退出序列**。当前工作、`service.stopped`、flush、retention、SQL 关闭沿用 12A 的 shutdown 控制器。默认 flush 10 秒，退出预算 20 秒。`app` 与开发用 `api` 的 `stop_grace_period` 是 30 秒。SIGTERM / SIGINT 与重复信号只收尾一次。入口只调用一次 `Bun.serve`，不再 default export fetch。
3. **离线证据**。真实 API 入口、隔离的真 PostgreSQL、离线 fixture transport 与图片下载。测试开关只在 `LOG_LIFECYCLE_TEST=1` 时生效，不增加生产管理接口。缺 PostgreSQL 时进程在写出 `service.started` 之前以非 0 退出。验收库只关闭连接，不 DROP DATABASE。API 不负责清空独立 Worker 的采集任务。

## 允许与禁止

允许：`apps/api/src/index.ts`、进程内活动工作跟踪、生命周期测试与离线 fixture、app / 开发 api 的 flush、退出预算和 grace、本规格与观测/部署说明。

禁止：UI、公开合同、迁移、元数据业务函数、Collector、logger、共享 shutdown 的重写，以及采集、鉴权、限频算法。不部署、不合并。产品镜像上的 `docker stop` 与 30 秒 grace 不在本包执行。

发送完成：handler 返回 `Response` 之后，退出还要等 `Bun.Server` 的 `pendingRequests` 归零。客户端把接收窗口压小且不读时，发送停在 backpressure 上。预算内读完才是退出码 0；预算内发不完则 `process.response_undrained`，退出码不是 0，并用 `server.stop(true)` 关掉监听。默认 flush 10 秒、退出预算 20 秒没有加长。

真实 backfill 拒绝不再跟踪一个成功后再 throw 的派生 Promise。测试在已有 gate 延迟期间把隔离库的 `backfill_runs` 改名，让 `started.done` 自己在保存进度时拒绝，退出后把表名改回。

## 结果

真实入口证据前缀 `WP-R2-12B-EVIDENCE`。下表是纠正后的同一次 `apps/api` lifecycle suite。库保留，没有 DROP DATABASE，临时改名的 `backfill_runs` 已恢复。

| 场景                                 | 保留库                   | 标识                                       | 结果                                                                                                                                         |
| ------------------------------------ | ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SIGTERM 短尾，采集任务仍 pending     | `wp_r2_12b_9d410af108c0` | `api-428177ee-897b-435e-905b-dd287aa5246b` | 退出码 0；15ms；started / stopped；job `pending`                                                                                             |
| SIGINT 短尾                          | `wp_r2_12b_8ab36dcf9e0b` | `api-ff09d6a0-bf5a-408d-9b22-bed581738b23` | 退出码 0；16ms；started / stopped                                                                                                            |
| 在途 SQL 完成，新请求 503            | `wp_r2_12b_5f5e1ee67c06` | `api-3de6db02-b189-4642-8175-999b033b3d0b` | 退出码 0；718ms；在途 200；新请求 503                                                                                                        |
| 已返回 202 后慢 backfill             | `wp_r2_12b_2b6c5e96f6ba` | run `1a80bc3c-c5e1-4543-9179-89cf6d6ebd92` | 退出码 0；626ms；succeeded；视频写入                                                                                                         |
| 已返回 202 后永挂                    | `wp_r2_12b_c6603fa9da4f` | run `cb95a075-1256-4399-a250-d821fb6e0d3a` | 退出码 1；1259ms；仍 running                                                                                                                 |
| 信号后才登记的慢 backfill            | `wp_r2_12b_1376bc28d7c5` | run `b8245850-621f-485c-b2ce-a4513c4e0750` | 202 在信号后 599ms；退出码 0；1025ms                                                                                                         |
| 信号后才登记的永挂                   | `wp_r2_12b_d9b694f48f09` | run `193d60d3-86d4-4271-b0d2-ac162299d763` | 202 在信号后 597ms；退出码 1；1760ms                                                                                                         |
| 真实 `started.done` 拒绝             | `wp_r2_12b_316b60e35ed6` | `api-ae8dbf1a-e173-44f2-9f0b-e62a794cb7b9` | 退出码 1；832ms；run `a30e84c6-d3a1-4f08-a147-ae74d3aa7009`；`relation "backfill_runs" does not exist`；`task=failed`；flush 成功            |
| 该拒绝已结算后的健康退出             | `wp_r2_12b_823d6703a2a3` | `api-a8111f11-c37e-48b8-8fe6-6b0f782d2648` | 退出码 0；10ms；run `aff1394b-1e68-4e87-9701-d5b970700be4`；无 `shutdown_incomplete`                                                         |
| 慢接收 4MiB 资产，信号后在预算内读完 | `wp_r2_12b_73cdd73ca6f2` | `api-11c32cf2-372e-4f36-8925-64c51abf90e3` | 退出码 0；423ms；信号前正文 0 字节；暂停期间没有 `service.stopped`；读完 4194304；asset `response-send-fde54121-f761-4cf3-8d13-e883dbcd77e3` |
| 4MiB 停读超过退出预算                | `wp_r2_12b_4ff2411732b5` | `api-5d658144-4736-49cb-953c-7e976a252e8f` | 退出码 1；1061ms；`response_undrained`；`timed_out`；监听已拒绝新连接；asset `response-send-108b333c-1bf6-4fef-9a28-73a9040eed36`            |
| 慢 sink                              | `wp_r2_12b_f27dfbf91094` | `api-6cc569e5-a18c-4ba8-bed6-f36a9b2d20af` | 退出码 0；415ms；started / stopped                                                                                                           |
| 失败 sink                            | `wp_r2_12b_6bda2a215aaa` | `api-d9a85a0b-295c-4f8a-bde8-dc2da4d05e70` | 退出码 1；7ms；`sink_failed`；无 stopped                                                                                                     |
| 永挂 sink                            | `wp_r2_12b_1a0e7f958586` | `api-4bc86d2f-9f15-4598-819e-9100431a0ca9` | 退出码 1；409ms                                                                                                                              |
| 满队列后停止事件恢复                 | `wp_r2_12b_6d3563b6e0a5` | `api-d2563647-dd07-4ce4-a7a2-79e55b21e01e` | 退出码 0；815ms；含 `signal_duplicate`                                                                                                       |
| 满队列且 sink 永挂                   | `wp_r2_12b_5cd39b7152c4` | `api-68481b56-4893-466b-a62f-2e3673c0155d` | 退出码 1；407ms；`stopEventAccepted=false`                                                                                                   |
| 资源关闭挂起                         | `wp_r2_12b_9878b3a5b45b` | `api-c4b64913-79b1-4840-89ee-01929be5be3e` | 退出码 0；1453ms；预算 1500ms                                                                                                                |
| 缺 PostgreSQL                        | 无新库                   | `api-c313c0ed-307e-4831-ac2f-b8a145c0f93f` | 退出码 1；没有 `service.started`                                                                                                             |

短尾上的第二次信号是紧接着发出的，操作系统可能把两次投递合并；进程仍只有一条停止事件。第二次信号在退出尚未结束时被单独送达，由在途 HTTP 用例和满队列用例覆盖，stdout 有 `process.signal_duplicate`，停止事件仍是一条。

同一次全量测试里，HTTP 覆盖报告仍是注册 49、清单 49、已执行 49、HTTP 成功 49、断言验收 49。这次覆盖库是 `wp_r2_11_b094fa3f1e3f`，只保留，不 DROP。

产品镜像和 Compose 里 30 秒 `stop_grace_period` 的实际 `docker stop` 未在本包执行。
