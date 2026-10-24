# WP-R2-27A2 — 媒体回填必须真的落成资源（头像/封面 asset）

基线：`wp-r2-int03`（PR #72）。只补 27A 的缺口，不改 UI。

## 缺口

`POST /creators/:mid/media/backfill` 原先只写 `face_url` / `cover_url`，未走资源化，导致 `face_asset_id` / `cover_asset_id` 为空、页面占位图。

## 行为

1. 写入 URL 后复用 metadata-refresh 同源资源化（`assetizeHdslbImage` → `downloadHdslbImage` + `storeImageBytes`），回写 asset id。
2. 单条资源化失败软处理：`metadata_error` / `cover_state='failed'`，整轮继续。
3. 幂等：已有 asset_id 或同 `source_url` 复用；`force=1` 再跑 `assetsReused>0`，不新增 `static_assets` 行。
4. 响应增加 `faceAssetId`、`coversAssetized`、`coversFailed`、`assetsReused`。
5. `force=1` 可补历史 `cover_state='ok'` 缺 asset 的行。
6. 不改图片代理与列表过滤。

## 验收

- `POST .../media/backfill?force=1` 后头像/封面 asset 非空。
- 同参再跑：`assetsReused>0`，assets 行数不增。
- 单测：成功 / 404 软失败 / 重复 URL 复用；`format` / `lint` / `typecheck` / `build` 全绿。
