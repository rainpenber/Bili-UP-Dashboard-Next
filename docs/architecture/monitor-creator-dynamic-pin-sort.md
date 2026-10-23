# UP 主 / 动态置顶与排序（WP-R2-24A）

## 数据

迁移 `018_creator_dynamic_pinned_at`：

- `creators.pinned_at timestamptz NULL`
- `dynamics.pinned_at timestamptz NULL`
- 部分索引 `creators_pinned_at_partial_idx` / `dynamics_pinned_at_partial_idx`（`WHERE pinned_at IS NOT NULL`）
- 辅助索引：`creators_uname_asc_idx`、`dynamics_dynamic_id_asc_idx`

回滚：

```sql
DROP INDEX IF EXISTS creators_pinned_at_partial_idx;
DROP INDEX IF EXISTS dynamics_pinned_at_partial_idx;
DROP INDEX IF EXISTS creators_uname_asc_idx;
DROP INDEX IF EXISTS dynamics_dynamic_id_asc_idx;
ALTER TABLE creators DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE dynamics DROP COLUMN IF EXISTS pinned_at;
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| `PATCH` | `/api/v1/monitor/creators/:mid/pin` | body `{ pinned: boolean }` → `{ pinned, pinnedAt }` |
| `PATCH` | `/api/v1/monitor/dynamics/:dynamicId/pin` | 同上 |
| `GET` | `/api/v1/monitor/cards?type=creator&sort=…` | `sampled_desc`（默认）/ `followers_desc` / `name_asc` |
| `GET` | `/api/v1/monitor/dynamics?sort=…` | `sampled_desc`（默认）/ `likes_desc` / `comments_desc` |

所有列表排序均为：`(pinned_at IS NOT NULL) DESC`，再按所选字段，再按稳定 id 升序。非法 `sort` → 400。

## UI

- UP 主 / 动态卡片封面角置顶按钮（与视频同图标与 `aria-label`）
- 筛选栏单行「排序」选择；URL `sort` 非默认时写入，切换 tab 重置为该 tab 默认
- 动态 tab 补齐与视频一致的单行工具条（说明文案 + 排序 + 布局）

## 卡片交互去重

- 分栏：整卡点击 = 选中右栏；删除列表「详情」按钮
- 网格：整卡点击 = 进入详情页；删除「详情」链接
- 暂停/恢复、置顶等动作 `stopPropagation`
