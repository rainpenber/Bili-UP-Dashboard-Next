# WP-R2-19C 真实商单「展示态」

## 行为

- 共享契约新增 `businessState: 'not_started' | 'active' | 'finished' | null` 与 `originStatusLabel`。
- 纯函数 `deriveCommercialBusinessState` / `commercialDisplayStateFromSource`：仅从来源快照 `sourceStatus` 映射；无来源绑定则为 `null`（不显示误导徽标）。
- 固定覆盖来源 13 种 `detail_status`；未知标签不猜测，返回 `active` 并原样保留标签。
- 列表 / 详情读接口返回上述字段；**不加迁移**、不改节点真实状态、不伪造完成时间 / BV。
- 前端：finished 全绿只读；not_started 全灰只读；列表徽标显示真实来源标签。

## 非目标

- 不批量导入 71 条历史；不改排期日期字段；不合并 / 部署；不改飞书 / 微信；不改监控 / 采集。

## 验收

- `format` / `lint` / `typecheck` / `test` / `build`
- contracts 13 状态表驱动；web 列表 / 详情渲染测试；既有商业套件不回归
