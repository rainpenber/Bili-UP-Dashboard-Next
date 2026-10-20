# WP-R2-09 作者与视频的双向反查

> 基线：PR #30 head（`479156e8`，本地导入与刷新接口已就绪）。
> 纯查询与展示，不改表结构、不改采集。

## 1. 业务目的

用户的原话：

> 「我不是有监控视频数据和监控博主数据吗？那我能不能在页面上去做两种反查：通过视频，去查对应作者的粉丝数量变化；或者在粉丝监控页，去倒查这个博主所有视频的情况。」

数据层已经具备：`videos.mid → creators.mid` 外键 + `idx_videos_mid`；视频样本按 `bvid`、粉丝样本按 `mid`。缺的是查询与页面。46 个历史视频已在上一包补齐 `mid`，新采集天然带 `owner.mid`。

## 2. 接口

### 2.1 视频详情嵌作者

`GET /api/v1/monitor/videos/:bvid` 的响应增加：

```jsonc
{
  "creator": {                     // mid 为空时为 null
    "mid": "3493141386627335",
    "uname": "狐正正",
    "faceAssetId": "a_...",        // 无头像时 null
    "followerLatest": 51733,       // 最近一条粉丝样本，NULL 时 null
    "followerSampledAt": "2026-10-19T18:59:59Z",
    "monitoringEnabled": true
  }
}
```

一次左连（`videos.mid = creators.mid`）+ 一个 `LATERAL` 取最近样本，不要 N+1。

### 2.2 作者详情返回其视频

`GET /api/v1/monitor/creators/:mid/videos?limit=&offset=`（默认 20，最大 100）：

```jsonc
{
  "mid": "3493141386627335",
  "total": 46,
  "items": [{
    "bvid": "BV1jHnn63EEi",
    "title": "…",
    "coverAssetId": "a_…",
    "pubdate": "2026-10-19T…Z",
    "partitionName": null,
    "latest": { "sampledAt": "…", "viewCount": 623, "likeCount": 34, "commentCount": 8, "onlineViewers": 1 }
  }]
}
```

- 按 `pubdate DESC NULLS LAST, bvid` 排序；`latest` 用 `LATERAL` 取每个视频最近一条样本；
- 只返回未软删除的视频（`deleted_at IS NULL`），`archived_at` 原样返回；
- 空列表返回 `200 { mid, total: 0, items: [] }`，作者不存在返回 404。

### 2.3 类型与合同

- 类型放 `packages/contracts`，与现有命名风格一致；
- 两个接口都要有 API 合同测试（有数据 / 无数据 / 404 / 分页边界）。

## 3. 页面

### 3.1 视频详情页

- 头部下方加一行「作者」卡：头像（走 `/api/v1/assets/:id`，缺失走占位）、昵称、当前粉丝数、最近采样时间，点击进入作者详情；
- 右侧或下方一条迷你折线（复用现有图表组件），数据来自 `/api/v1/monitor/creators/:mid/metrics`（已有接口，`mid` 为空则不请求）；
- `mid` 为空时整块显示「作者信息待补齐」空态，不报错。

### 3.2 作者（粉丝监控）详情页

- 新增「该 UP 的视频」区块：列表/卡片，展示封面、标题、发布时间、最新播放/评论，点击进入视频详情；
- 支持「显示全部」分页加载；`total` 显示数量；
- 没有视频时显示空态，不显示 0 条的表头。

### 3.3 交互与响应式

- 390px：卡片纵向堆叠，不横向溢出；1440px：作者卡在右栏、视频列表两列；
- 骨架屏/加载/错误态齐全；图表在无数据时显示「暂无样本」而不是空白。

## 4. 测试

- API：视频详情在有/无 `mid`、作者无粉丝样本时的三种形状；作者视频列表排序、`latest` 取值、软删除过滤、分页。
- 前端：`/ops` 之外新增断言——视频详情作者卡渲染、作者页视频列表渲染、空态不崩；390/1440 无横向溢出。
- 全部现有门槛命令通过；不得引入真实网络请求（图表与素材用固定装置）。

## 5. 不做

- 不做跨作者对比、不做标签聚合页、不做导出。
- 不改 `videos`/`creators` 表结构，不改采集与回填逻辑。
