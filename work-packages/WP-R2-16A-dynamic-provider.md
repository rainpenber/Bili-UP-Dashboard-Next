# WP-R2-16A 指定单条动态详情：上游适配

## 边界

只解析并请求一条已经指定的动态详情。复用现有 B 站传输、账号限流和错误分类。不接目标、调度、入库、HTTP API 或 UI。没有新的验收页面，也不能把整个动态监控算作完成。

起点是 `cursor/monitor-layout-view-71ba` 的 `c736d215a4b97994110eaed2f71652be29b0185d`。视图切换那条已验收链路留在原分支，本包用独立分支和独立 PR。

## 实现

- `packages/monitoring/src/bilibili-dynamic.ts`：`assertDynamicId` 与 `parseDynamicDetail`。
- `createBilibiliProvider` 增加必选方法 `fetchDynamic`。它在校验 id 之后调用同一个 `request` 闭包，端点名 `dynamic_detail`。
- `UpstreamEndpoint` 增加 `dynamic_detail`。`classifyBilibiliResponse` 未改。
- 离线夹具放在 `packages/monitoring/fixtures/dynamic/`。字段对照和未接入说明见 `docs/architecture/dynamic-detail-provider.md`。

采集任务的测试桩补了 `fetchDynamic`，调用即抛出「尚未接入」。现有视频任务测试因此仍能证明 runner 不会走到动态详情。检索过 `UpstreamEndpoint` 的使用处：库表 `collector_requests.endpoint` 是文本，运行记录页面按字符串显示，没有必须穷尽的标签映射，所以没有改 `apps/web`、`apps/api`、`packages/contracts` 或 `packages/db`。

## 不变量

1. 动态 id 全程是字符串。请求前校验。响应 `data.item.id_str` 必须与请求相同。点赞、评论、转发只取本条 `module_stat` 的 `like` / `comment` / `forward` 的 `count`。`0` 与缺失分开，缺失是 `null`。计数是 `bigint`，拒绝负数、非整数和不安全 `Number`。
2. 成功时恰好一个详情请求，并消耗账号上原有的那一份配额。dry-run 零请求。错误沿用现有类别，不隐式重试，不补 WBI、`nav` 或列表请求。
3. 视频和 UP 主的请求次数、错误行为、runner、数据库和页面保持原样。离线模式不出现 `fetchDynamic`。

## 明确不做

不发现新动态，不分析正文或粉丝关系，不抓评论和弹幕，不改限流算法，不绕过 `-352`。详情文档里的 `4101139` 没有类别说明，保持通用 `retryable`。
