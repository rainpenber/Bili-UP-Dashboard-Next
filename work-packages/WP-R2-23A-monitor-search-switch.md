# WP-R2-23A — 监控筛选：可撤销 Switch + 统一可读搜索建议

## 行为

1. **只看我的**：筛选栏改用 shadcn `Switch`（非 Toggle）；label「只看我的」；开→URL `onlyMine=1`，关→移除并恢复列表；切换重置 `page=1`、`selected=null`。
2. **统一搜索**：视频 tab 合并「分类」与「关键词」为一个搜索框（分类 / 标题 / UP 名 / BV）；监控状态、排序、只看我的仍为独立控件。输入 250–350ms debounce 后请求；取消过期请求。
3. **建议**：`GET /api/v1/monitor/search-suggestions` 按类型分组，主文案可读；BV/UID 仅次要信息。键盘上下/Enter/Escape。
4. **后端 `q`**：视频列表补齐 UP 主 `uname` 与分类匹配；保留 `category` 精确过滤兼容。

## 非目标

不改监控新增/暂停/删除、采集器、B 站请求、详情页布局。

## 验收

Switch 开→关可逆；debounce 与建议键盘/可读标签；`format:check` / `lint` / `build` / 相关测试绿。
