# 监控统一搜索与建议（WP-R2-23A）

## UI

- 视频 / UP 主 tab 顶部仅一个「搜索」输入；分类文本框与「标题 / ID」关键词框已合并。
- 输入本地即时更新，**300ms debounce** 后写入 URL `q` 并请求列表；分类精确过滤仍用 `category`（由建议点击写入，新 UI 无独立分类输入）。
- 建议 dropdown 按「视频 / UP主 / 分类」分组；主文案为标题 / UP 名 / 分类名。二级仅显示 UP 名（视频）或固定「UP 主」（UP 建议），**不展示 BV / MID / UID**；粘贴 BV/UID 仍可精确命中，取值仍写在 `value`。
- 「只看我的」为 shadcn `Switch`，开/关均可撤销。

## 接口

| 方法  | 路径                                              | 说明                                                                                |
| ----- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET` | `/api/v1/monitor/search-suggestions?q&type&limit` | 全库建议，每组 ≤5；`type=video\|creator`；空 `q` 返回空组                           |
| `GET` | `/api/v1/monitor/cards?q=…`                       | `q` 匹配 `external_id` / `title` / `target_label` / `category` / UP 名 / 精确 `mid` |

`category` 精确过滤保留向后兼容。LIKE 对 `%` / `_` / `\` 转义；参数化查询，无 SQL 拼接。
