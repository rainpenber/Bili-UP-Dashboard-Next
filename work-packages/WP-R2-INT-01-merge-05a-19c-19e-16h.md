# WP-R2-INT-01：整合 05A＋19C＋19E＋16H

## 目的

将并行验收的 UP 新内容发现（05A）、商单来源展示态（19C）、软归档（19E）、监控筛选排布（16H）无损合并为单一可部署 head。

## 基线与顺序

- Base：`cursor/wp-r2-05a-creator-content-discovery-8592` @ `1132de0`
- Cherry-pick：19C → 19E → 16H

## 冲突

唯一内容冲突：`docs/architecture/api-inventory.json` 的路由计数。

| 侧   | apiRouteCount | wiredRouteCount | 增量                |
| ---- | ------------: | --------------: | ------------------- |
| 05A  |            67 |              45 | discovery×3         |
| 19E  |            66 |              44 | archive/unarchive×2 |
| 合并 |        **69** |          **47** | 两边路由均保留      |

跑通 HTTP coverage 后 `docs/architecture/http-coverage.{json,md}` 同步为注册/清单/执行 69，同时含 discovery 与 archive 路由。

## 迁移

保留 `017_creator_content_discovery`；19C/19E/16H 无新迁移；schemaVersion 仍以 017 为最新。

## 整合结果

- 商单列表：`businessState` / `originStatusLabel` + 默认排除归档 + 归档折叠 / 恢复
- 监控页：发布事件 scatter 标记与设置开关 + 筛选栅格 / 分类说明 / 隐藏 mid / 单行操作组
- API inventory + HTTP coverage：discovery 与 archive/unarchive 并存
