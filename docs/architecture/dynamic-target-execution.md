# 动态目标执行（后台闭环）

WP-R2-16C。这一包把一条已经指定的动态接进现有采集流水线：监控目标、任务、离线或注入的 B 站 provider、同一次事务里的样本和运行结果，以及原来的 HTTP 与操作日志。它不增加动态卡片，也不提供从页面新增或启停动态的入口。后台能跑通，不等于动态监控页面已经完成。

16A 的 `fetchDynamic` 仍是唯一的详情请求。16B 的 `writeDynamicSampleWithin` 仍是唯一的动态样本写入。不新建动态实体、样本表、任务表或调度器。

## 目标

`012_dynamic_monitor_targets.sql` 只放宽 `monitor_targets` 的类型和 `external_id` 检查，并要求动态的 `interval_mode` 为 `fixed`。005 不动。

动态 id 是十进制整数字符串，不能是 `0` 或带前导零，也不经过 `Number`。它不是 BV 号，也不是 UP 主 mid。同一个数字可以同时作为一条动态和一位 UP 主的目标，因为唯一键是 `("type", external_id)`。

本阶段动态只有固定间隔。省略模式时默认固定 60 分钟，允许的范围仍是 5–10080 分钟。请求里显式写 `auto` 会得到可读的 400，并且不插入目标、不改已有行。视频的 15/120/360 和 UP 主的 240 分钟自动策略保持原样。60 分钟只是这一阶段可调整的默认值，不是新的自动算法。

创建、读取、修改固定频率、暂停、恢复、手动采集和软删除都走原来的 `/api/v1/monitor/targets` 路径，并留下原来的操作记录。重复创建命中活动目标时返回原记录：暂停的目标不会被重新打开，也不会再插一条任务。暂停后的目标不会被领取；已经开始的任务可以收尾。恢复只安排下一次，不补历史桶。软删除不删除样本和历史日志。

## 成功

离线 provider 的 `collectDynamic` 用动态 id 和采样分钟做确定性计数，不发上游请求。真实分支在通过账号、熔断和凭据检查之后只调用一次 `fetchDynamic`。限流仍是原来的账号预算，没有第二只计时器。

`commitBilibiliDynamic` 在同一个事务里写入运行、`writeDynamicSampleWithin`、任务成功，以及目标的最后成功时间和下一次计划。样本的 `sampled_at` 用这次任务的 `scheduled_for`，不用 provider 返回的瞬时时间盖掉它。`collected_at` 是这次执行的时间。`source`、账号和 `collector_run_id` 属于这一次调用。离线样本的 `source` 是 `import`，账号为空；注入传输的样本 `source` 是 `bilibili`，并带上这次账号。

`0` 和缺失分开。同一个 `(dynamic_id, sampled_at)` 已有样本时不覆盖，这次运行的 `samples_written` 为 0。事务中途失败时，运行和样本一起回滚。

已有的 `GET /api/v1/monitor/dynamics`、详情和 `metrics` 能读回这次样本。指标先按时间倒序取最近的 N 条，再按时间正序返回，所以 `limit=1` 是最新的桶。

## 失败

`-352`、`-412`、`-509`、过期账号、404 和解析失败沿用原来的分类。过期账号在请求之前推迟任务，上游调用次数是 0。其余失败恰好一次 `dynamic_detail`，不补 WBI、`nav`、二维码或动态列表。失败不会记成成功，也不会用 0 写一条样本。

这次任务的 `collector_requests` 和 `app_logs` 带有本轮的 job 或 run。`GET /api/v1/ops/collector-jobs?type=dynamic`、任务详情、运行详情和操作记录接受 `dynamic`，不会把它显示成 UP 主。动态 id 即使和某位 UP 主的 mid 相同，运维投影也只在 `type = 'dynamic'` 时读取 `dynamics`，封面留空，不使用 UP 主头像。

## 还没有做的部分（16C 当时）

页面上仍然不能新增、暂停或恢复一条动态。监控卡片接口继续只接受视频和 UP 主。没有新动态发现，也没有把动态 id 当成 UP 主去拉粉丝。验收使用新建且保留的 `wp_r2_16c_*` 逻辑库，不访问 B 站。

页面新增 / 启停 / 详情与日志见 WP-R2-16D 与 `docs/architecture/dynamic-monitor-page.md`。卡片 API 仍只接受视频和 UP 主。
