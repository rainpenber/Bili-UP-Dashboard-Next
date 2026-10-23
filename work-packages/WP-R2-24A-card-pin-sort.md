# WP-R2-24A — 卡片交互去重 + UP主/动态置顶与排序

## 目标

1. 视频/UP 主/动态卡片去掉与整卡点击重复的「详情」入口；分栏选中、网格进详情。
2. `creators` / `dynamics` 增加 `pinned_at`；pin API + 列表 sort（置顶优先）。

## 不做

- 不改采集器、限频、B 站请求、商单页。
- 不为动态猜测发布时间字段。

## 验收

- 迁移可重放；回滚说明见 `docs/architecture/monitor-creator-dynamic-pin-sort.md`
- 分栏点击选中、网格点击进详情；动作不冒泡；无重复「详情」按钮
- 置顶幂等；非法对象 404；非法 sort 400；置顶永远优先
- inventory / http-coverage 已更新；typecheck / test / build / lint / format 绿
