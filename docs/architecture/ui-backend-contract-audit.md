# UI / 后端契约审计（Phase 1）

基线 `9d9370e0b2c0d3b5b5e6cb92f68d5416f48b641b`。本文件只记录当前源码和已提供的脱敏测试运行时，不改界面，也不把未执行的请求写成已复现缺陷。

机器可读路由清单：[api-inventory.json](./api-inventory.json)。清单在脚本里按「方法 + 挂载后的完整路径」去重，`apiRouteCount` 为 **30**。其中 17 条能在 `apps/web` 找到 HTTP 调用，13 条已注册但当前页面不调用。SPA 的 `/`、`*` 和 `/assets/*` 不计入这 30 条。

## 证据等级

| 等级                          | 含义                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| source-confirmed              | 本基线源码直接读到                                                            |
| Hermes runtime read-confirmed | 下方脱敏测试运行时读到，且只覆盖列出的读请求                                  |
| previously accepted behavior  | 本审计不重开的已接受逐步规则；实现位置在 `packages/workflow/src/step-plan.ts` |
| unverified                    | 本轮没有执行，不能当成运行时结论                                              |
| missing                       | 本基线没有对应实现                                                            |
| inconsistent                  | 同一事实在 UI、契约、旧文档或另一条代码路径上不一致                           |

本仓库工作区没有对照其他 PR 的检出。下面的「没有」只针对这个基线和这次测试 Compose 项目，不把兄弟分支里可能存在的功能说成全局不存在。

## 端口与拓扑

仓库里有三套端口，测试环境对上的是合并进程，不是开发热重载拆分。

| 场景       | 依据                               | 应用端口                                                                             | PostgreSQL                                                                           | 进程                                          |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| 合并镜像   | `docker-compose.yml`、`Dockerfile` | 容器 `API_PORT` 3000；宿主机默认 `${APP_PORT:-8080}`                                 | 容器内 `5432`，不映射宿主机；卷 `postgres_data`                                      | 服务 `app`，同一 Bun 进程提供 `/api/*` 与 SPA |
| 开发热重载 | `docker-compose.dev.yml`           | API 宿主机 `${API_PORT:-3000}` → 容器 3000；Web `${WEB_PORT:-5173}`                  | 同样不映射，除非再叠加 `docker-compose.dev-postgres.example.yml` 的 `127.0.0.1:5432` | 服务 `api` 与 `web` 分开                      |
| 本机 Vite  | `apps/web/vite.config.ts`          | 开发服务器 5173；`/api` 代理到 `VITE_API_PROXY_TARGET`，缺省 `http://localhost:3000` | 不由 Vite 提供                                                                       | 浏览器只访问 Vite                             |
| 直接跑 API | `apps/api/src/index.ts`            | `API_PORT`，缺省 3000                                                                | 客户端默认端口 5432                                                                  | 只提供 API，除非设置 `WEB_STATIC_ROOT`        |

Hermes runtime read-confirmed，2026-10-18，Compose 项目 `bili-test`，不是生产：

- 服务 `app`，镜像 `bili-test-app`，网络 `bili-test_default`，状态 healthy。容器 `3000/tcp` 映射宿主机 `18492`。这不是 Compose 文件里的默认 8080，说明测试宿主机改过发布端口。本审计不读取该端口的来源环境文件。
- 服务 `postgres`，镜像 `postgres:16-alpine`，`5432/tcp` 没有宿主机映射，卷 `bili-test_postgres_data`。
- `app` 有只读绑定挂载，容器内目标 `/mock-data`。仓库合并 Compose 把该挂载设为只读，并把 `MONITOR_DATA_SOURCE` 写成 `mock`。这次运行时证据没有包含环境变量值，所以容器里的实际取值仍是 unverified；源码缺省和合并 Compose 都是 `mock`。`collector` 在 `apps/api/src/data-source.ts` 会直接抛错。
- 只读枚举只有 `app` 和 `postgres`，没有 Collector 服务。
- `GET` 健康检查返回 `status=ok`、`service=studio-api`、`version=0.1.0`。响应里还有时间戳，与 `HealthResponse` 一致。
- 页面脚本出现 `/assets/index-ChGE6-f_.js`，说明这次合并进程在提供 SPA 静态资源。
- 三个只读 JSON 为 200：`/api/v1/commercial/projects`（`items`）、指定项目详情、该项目 `/workflow`（`projectId`、`workflowId`、`templateVersionId`、`nodes`、`edges`）。这不是全路由联调。
- 物理列清单与 `packages/db/migrations/001`–`004` 的表名一致。证据本身写明只覆盖列名、类型和可空性，不是每条约束或状态迁移的运行时证明。

`docs/runbooks/deploy.md` 把项目名 `bili-test` 写成开发热重载命令。这次观察到的 `bili-test` 却是合并服务 `app`。两套拓扑都在仓库里，不能从这次测试证据推断生产 `bili-prod`。

## 类型、标识、状态、时间、金额与空值

已接受的 UUID 项目页使用 `@studio/contracts` 的解析器：详情、流程、默认模板、计划保存和逐步响应。监控列表和曲线使用契约里的 TypeScript 类型，但 `apps/web/src/api/monitor-client.ts` 把 JSON 直接断言成这些类型，没有调用解析器。视频、UP 主、动态的详情类型是前端本地副本，字段与对应 GET 处理函数当前返回值一致，没有放进 `packages/contracts`。

今日看板、项目列表，以及非 UUID 项目详情，使用 `apps/web/src/features/commercial/types.ts` 和 `mock-data.ts`。那些 id 形如 `proj-nev-spring`，不是 UUID。`ProjectDetailPage` 用 `isUuidString` 分流：UUID 走数据库流程，其他 id 走演示数据。列表不会发出 `GET /api/v1/commercial/projects`。

节点状态在契约、`wf_nodes.status` 和逐步计划里是同一组：`not_reached`、`in_progress`、`completed`、`blocked`、`not_applicable`。时间线标签把 `not_reached` 和 `not_applicable` 都显示成「未完成」；逐步对话框把它们分成「未开始」和「不适用」。画布四格把两者都画成灰色 `idle`，`not_applicable` 没有第五格。项目 `overallStage` 为 `pre_publish`、`published_winding_down`、`closed`、`archived`。演示列表用的是另一套中文阶段文案，不经过这个枚举。

计划日期写入只接受 `YYYY-MM-DD` 或 `null`。服务端把它存成 `Asia/Shanghai` 当天 00:00 的 `timestamptz`。读回是 UTC 的 ISO 字符串，微秒格式与 `updatedAt` 相同（`COMMERCIAL_UPDATED_AT_FORMAT`）。前端再用上海日历日显示，午夜不当成约定的 00:00 钟点。`completedAt` 和发布时刻是实际瞬间，显示时保留钟点。`updatedAt` 是并发令牌，逐步和改计划必须原样送回。监控采样另有 `sampledAt`（UTC ISO）、`rawTime`、`sourceTimezone`、`timestampPrecision`（`minute` 或 `second`）。曲线轴用浏览器本地时区格式化，没有固定到 `Asia/Shanghai`。商单排期和监控曲线的时区策略不一致；本环境的浏览器时区 unverified。

到手金额和返点金额是 `numeric` 的十进制字符串，契约注释为 `numeric(14,2)`。进度摘要用 `Number` 再按人民币、`maximumFractionDigits: 0` 格式化，分位会在显示时去掉。`null` 显示「未填写」。播放、互动和粉丝数在 JSON 里是十进制字符串，对应库内 `bigint`。播放图的纵轴单位是千次，输入为原始播放量除以 1000。空指标在卡片上显示为破折号；动态评论空值在列表上显示「暂无数据」。

读接口错误：非法 UUID 为 400，缺少项目或流程为 404，意外异常为 500，正文是 `{ error }`。逐步失败保留 HTTP 状态和 `code`。其他 `fetch` 只抛出 `error` 字符串。监控 404 的 `error` 为 `not found`；项目视频卡把这个和 `HTTP 404` 显示成「暂未接入监控」。静态资源找不到仍返回 HTTP 200 和占位 SVG，并用 `X-Asset-Status` 区分 `placeholder`、`missing-root`、`missing-file`、`ok`。`blockingReason` 只允许非空字符串或 `null`；`null` 表示没有选中的开放阻塞事项标题，不是空字符串。

## 用户可见事实

| UI 事实或动作                                                                                          | 前端                                                                 | HTTP                                                             | 契约                                                       | 存储或派生                                                                                       | 证据与缺口                                                           |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 今日看板：我方待办、等甲方、阻塞汇总                                                                   | `commercial-home-page.tsx`，选择器读演示项目                         | 无                                                               | 演示类型，不是商单契约                                     | 内存 `mock-data.ts`                                                                              | mock。开放事项、卡点天数、对外期限没有对应读接口                     |
| 项目列表：名称、当前阶段、关键词和日期筛选                                                             | `project-list-page.tsx`                                              | 无                                                               | 演示类型                                                   | 内存；筛选在浏览器内                                                                             | mock。`GET /projects` 已实现且测试环境返回 200，页面未接             |
| 非 UUID 项目详情：金额、排期、状态、开放事项、演示发布、流程图                                         | `project-detail-page.tsx` 的 `MockProjectDetail`                     | 无                                                               | 演示类型                                                   | 内存；发布覆盖写在 `localStorage` 前缀 `commercial-mock-publish:`                                | mock。演示 id 不会进入数据库详情                                     |
| UUID 项目标题、归档只读                                                                                | `live-project-workflow.tsx`                                          | `GET /api/v1/commercial/projects/:projectId`                     | `parseCommercialProjectDetail`                             | `commercial_projects.overall_stage`                                                              | source-confirmed；该路径形状 Hermes runtime read-confirmed           |
| 进度摘要：金额、总阶段、当前任务、发布与阻塞                                                           | `ProgressSummary`，`timelineFactsFromDetail`                         | 同上详情                                                         | 同上                                                       | 金额列；当前任务名为进行中或阻塞节点名                                                           | 与详情同一响应                                                       |
| 时间线、阶段色带、节点 tooltip、计划与完成标签                                                         | `progress-timeline-view.tsx`，`deriveProgressTimeline`               | `GET .../workflow`                                               | `parseCommercialProjectWorkflow`                           | `wf_nodes`、`wf_edges`；阶段由模板 slug 归并，不是表                                             | 与画布同一份 workflow 响应。Hermes 确认了该形状                      |
| 时间线前进、一步回退、阻塞确认后才写入、取消确认不写、后继回退拒绝、发布必填、复用已有发布记录和幂等键 | `stage-step-controls.tsx` → `postLiveNodeStep` / `postLiveStageStep` | `POST .../nodes/:nodeId/step` 或 `POST .../stages/:stageId/step` | `CommercialNodeStepRequest` / `CommercialStageStepRequest` | 同一事务更新节点、阻塞事项、总阶段；发布时写发布记录、监控合同和两条 `pending` 的 `monitor_jobs` | previously accepted behavior，本轮未再执行写入。取消确认只停在对话框 |
| 修改计划日或清空                                                                                       | 时间线计划按钮 → `saveLiveNodePlan`                                  | `POST .../nodes/:nodeId/plan`                                    | `CommercialPlanRequest`                                    | 只写 `wf_nodes.planned_at`                                                                       | source-confirmed                                                     |
| 已发布项目的视频数据卡                                                                                 | `project-video-metrics.tsx`                                          | `GET /api/v1/monitor/videos/:bvid` 与 `.../metrics?limit=500`    | 详情为本地类型；点为 `VideoMetricPoint`                    | `videos`、`video_metric_samples`                                                                 | 只读历史。无 BV、404、或零采样时不画曲线。未发布项目不发出监控请求   |
| 节点画布：节点、边、汇合圆点、改名、四格、拖动、整理                                                   | `workflow-live-canvas.tsx`，`commercialWorkflowToLive`               | 只读同一 `GET .../workflow`                                      | 流程契约的子集                                             | 同一 `wf_nodes` / `wf_edges`。坐标不回传，画布用 dagre                                           | 改名、拖动、四格都不写库。见下一节                                   |
| 集成页「数据库默认模板」                                                                               | `live-template-panel.tsx`                                            | `GET /api/v1/commercial/templates/default`                       | `parseCommercialDefaultTemplate`                           | 已发布默认模板                                                                                   | 改名只留本页。模板无实例状态，卡片按未完成画                         |
| 集成页「新项目默认流程」                                                                               | `default-flow-editor.tsx`                                            | 无                                                               | 演示图                                                     | 页内内存                                                                                         | mock。发布不会改数据库模板或已有项目                                 |
| 集成页通知说明                                                                                         | `integrations-settings-page.tsx`                                     | 无                                                               | 无                                                         | 无                                                                                               | 静态说明                                                             |
| 监控中心视频列表、筛选、分页、趋势                                                                     | `monitoring-page.tsx`                                                | `GET /api/v1/monitor/videos`，选中后 `.../metrics`               | `VideoListItem`、`VideoMetricPoint`                        | `videos`、`video_metric_samples`                                                                 | 读已导入历史。`monitoringEnabled` 有返回值，列表不提供开关           |
| 监控中心 UP 主与粉丝数、粉丝曲线                                                                       | 同上，creators 标签                                                  | `GET /creators`，`GET /creators/:mid/metrics`                    | `CreatorListItem`、`CreatorMetricPoint`                    | `creators`、`creator_follower_samples.follower_count`                                            | 与视频历史同一类读路径。不是采集器                                   |
| 监控中心动态                                                                                           | 同上                                                                 | `GET /dynamics` 与 `.../metrics`                                 | `DynamicListItem`、`DynamicMetricPoint`                    | `dynamics`、`dynamic_metric_samples`                                                             | 读历史。列表无关键词参数                                             |
| 视频 / UP 主 / 动态详情                                                                                | `monitoring-*-detail-page.tsx`                                       | 对应详情与 metrics                                               | 详情为本地类型                                             | 同上三组表                                                                                       | 封面或头像走 `GET /api/v1/assets/:assetId`                           |
| 离线徽章                                                                                               | `offline-environment-badge.tsx`                                      | `GET /api/health`                                                | `parseHealthResponse`                                      | 无                                                                                               | 文案固定为离线 CSV、不访问 B 站                                      |
| 内容与工具                                                                                             | `placeholder-page.tsx`                                               | 无                                                               | 无                                                         | 无                                                                                               | 静态空状态。页面文字仍写 M2.5 未交付                                 |
| 设计系统                                                                                               | `design-system-page.tsx`                                             | 无                                                               | 无                                                         | 无                                                                                               | 静态组件画廊                                                         |
| `/workflow-mock`                                                                                       | `workflow-mock-page.tsx`                                             | 无                                                               | 无                                                         | 页内原型                                                                                         | 不在主导航。与数据库流程无关                                         |
| `/monitor`                                                                                             | `route-config.tsx`                                                   | 无                                                               | 无                                                         | 无                                                                                               | 重定向到 `/monitoring`                                               |

## 图与时间线是不是同一流程

UUID 项目页的摘要、时间线和画布从同一次详情查询和同一次 workflow 查询派生。已发布项目还会另读监控视频。会话里的改名表会同时盖住时间线标签和画布名称，刷新后回到数据库名称。汇合节点在逐步计划里保持透明：不能作为逐步目标，完成态只在回退需要保持图合法时被拨回。时间线直接跳过 `kind === 'merge'`。画布把库里的汇合行画成不可选中的金色圆点，不再插入第二套演示汇合点。

画布没有走上逐步读写：

- `setStatus` 和 `setReason` 是空函数，注释为 `TODO(I-2)`。四格不调用 `advance`、`complete`、`block` 或 `/step`。
- `LiveProjectWorkflow` 的改名调用 `applySessionRename`。`workflow-live-graph.ts` 写明这是没有改名 HTTP 时的会话改名，并带 `TODO(I-2)`。`commercial-routes.ts` 与 `commercial-write.ts` 没有改名路由。归档项目连会话改名也关掉。
- `commercialWorkflowToLive` 没有把 `blockingReason` 放进画布节点。时间线保留该字段。同一响应下，画布原因一栏是空的。
- 拖动和方向切换只改画布状态。workflow JSON 不含 `posX` / `posY`，虽然表上有 `pos_x` / `pos_y`。
- 键盘 A、J、Delete 只提示「增删节点和连线留到后续」。

因此当前图不是第二套业务状态，但也还不是时间线那条已接受写路径的视图。旧的 `advance`、`complete`、`skip`、`rollback`、`block`、`unblock`、`publish` 仍注册。`packages/workflow/src/engine.ts` 不按节点种类分叉；逐步计划才把汇合节点排除在目标之外。已接受界面不调用旧路由。

## 监控：历史、开关与采集

视频指标和粉丝样本在本基线都有表、只读路由和图表。`video_metric_samples` 含播放、在线、点赞、投币、收藏、分享、弹幕、评论。`creator_follower_samples` 含 `follower_count`。导入 CLI 和 `POST /api/v1/imports/csv` 能把离线 CSV 写入这些表。`videos.monitoring_enabled` 与 `creators.monitoring_enabled` 会随列表和详情返回，页面没有修改它们的请求。

发布节点的已接受写入会插入 `project_monitor_contracts`，以及每个项目各一条 `metadata`、`metrics` 且状态为 `pending` 的 `monitor_jobs`。源码注释和 `commercial-db.md` 都写明这些任务不执行。测试 Compose 没有 Collector 服务。`MONITOR_DATA_SOURCE=collector` 不能启动采集。因此：数据库历史和图表是读路径；可配置的持续监控和正在运行的视频或粉丝采集，在这个基线上 missing。`pending` 任务或粉丝表本身不是采集器在运行的证据。

## 不一致与最小后续动作

| 不一致                                                        | 产品后果                                  | 建议的下一步                                                                 | 阶段           |
| ------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- | -------------- |
| 看板和项目列表仍是演示数据，数据库列表已存在                  | 从导航进不去测试库里的 UUID 项目          | 让列表改读 `GET /projects`，演示页保留明确入口                               | 不在本阶段实现 |
| 画布改名、四格、拖动不写库；阻塞原因未送入画布                | 图上的操作刷新即失，和已接受时间线分叉    | 对齐时复用 `/step` 与现有流程响应，先补上已有字段                            | phase 2        |
| 时间线把不适用显示成未完成                                    | 不适用节点看起来像还没开始                | 对齐文案时沿用契约五态，不新增状态                                           | phase 2        |
| 旧逐节点写路由仍在，逐步计划才把汇合节点当透明节点            | 联调时容易打到另一套规则                  | phase 4 只把已接受 UI 正在调用的路由列入必测；旧路由单列                     | phase 4        |
| 视频和粉丝只有历史读路径                                      | 发布后出现的 `pending` 任务不会产生新采样 | 单独做采集与开关，不把导入历史当成采集完成                                   | phase 3        |
| 曲线用浏览器本地时区，商单日用上海日历                        | 同一时刻两处标签可能差一天                | 联调时固定期望时区，再决定是否改格式化                                       | phase 4        |
| 金额显示舍去小数                                              | 有角分时摘要与库内值不一致                | 联调用原始小数字符串核对，显示精度另定                                       | phase 4        |
| `deploy.md` 的 `bili-test` 指热重载，这次测试项目是合并 `app` | 用 5173/3000 会连错测试端口               | 联调以本次证据的宿主机 18492 → 容器 3000 为准，并确认项目名实际 Compose 文件 | phase 4        |
| `system-overview.md` 曾把 PostgreSQL 画成未来依赖             | 后续阶段会漏掉已经存在的库和路由          | 已在该页改为指向本审计                                                       | 本文件一并更正 |

## Phase 2：图与今天的时间线对齐

先核对，再补缺口。本基线已经满足的部分：UUID 页的图和时间线读取同一 workflow；汇合节点在逐步计划和时间线上都不作为业务步骤；已接受的前进、一步回退、祖先闭包、阻塞确认、后继拒绝和发布幂等由时间线的 `/step` 进入，不由画布进入。

尚未满足、留到实现阶段的缺口：画布四格仍是 `TODO(I-2)` 空操作；改名被源码明确写成会话内，`TODO(I-2)` 与「commercial API has no rename route yet」独立存在于 `live-project-workflow.tsx` 和 `workflow-live-graph.ts`；画布丢掉 `blockingReason`；不使用库内坐标；不提供计划日。演示图 `/workflow-mock` 和设置页内存模板编辑器不是这条数据库流程。

## Phase 3：视频与粉丝采集

已有：离线导入、视频与粉丝历史表、监控中心图表、项目发布后的只读视频卡、发布时写下的未执行监控任务。

缺少：采集进程、对 B 站的受控采集实现、`monitoring_enabled` 的写接口和页面开关、消费 `monitor_jobs` 的执行者。粉丝与视频要一起做。动态历史是第三条读路径，不是本次采集重点的替代物。

## Phase 4：联调清单

本清单不是本轮已测结果。不要在审计阶段发写入或跑会截断数据的集成套件。

必测读：`GET /health`、`GET /api/health`、`GET /api/v1/commercial/projects`、项目详情、workflow、默认模板、视频与 UP 主的列表、详情和 metrics、动态三条、资产占位与命中、导入批次查询。测试合并进程的宿主端口以实际映射为准，这次是 18492，容器内仍是 3000。

必测写，使用可丢弃数据：时间线正在调用的节点 `/step`、阶段 `/step`、`/plan`。核对已接受规则，包括阻塞确认取消时零写入，以及发布幂等键复用。`POST /imports/csv` 会写导入表，只在明确的测试库上执行。

已实现但当前 UI 未接线，单独记录，不要算成页面已通：项目列表 GET、`advance`、`complete`、`skip`、`rollback`、`block`、`unblock`、`publish`、开放事项 close 与 cancel。

本基线不存在、不能标成已实现：改名、节点坐标保存、监控开关、采集器运行、开放事项列表 GET。

## 假设

- 已接受逐步规则以 `step-plan.ts` 和现有契约为准，本轮没有重跑那些测试。
- 测试环境列清单与迁移表同名，即视为同一套物理模型；未逐项核对约束定义。
- 容器内 `MONITOR_DATA_SOURCE` 的实际值没有出现在脱敏证据里。
- 没有查看生产 Compose 项目，也没有打开其他 PR 的分支。
