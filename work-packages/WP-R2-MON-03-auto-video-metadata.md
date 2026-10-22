# WP-R2-MON-03：新视频封面与完整元数据自动补全

## 目标

视频目标每次采集成功后，若仍缺封面资产（`cover_asset_id IS NULL`），自动走既有 `POST /metadata/refresh` 同源能力，使列表/卡片无需人工点刷新即可拿到真实封面；失败可读、可重试、不污染指标采集。

## 不变量

1. **触发**：仅 video；**每次**采集成功且缺 cover 时入队（含「已成功过但封面仍 pending」）；按 bvid 幂等；不阻塞创建请求；不为历史批量无条件补采。
2. **隔离**：补全失败不影响样本与目标 enabled；复用既有节流与凭据；失败后再试只随下一轮采集。
3. **可验收**：注入 transport 断言 detail → 图片 → `static_assets` → 读 API 非空 `imageAssetId` / `coverAssetId`。

## FIX1

入队不再依赖 `last_success_at IS NULL`。否则部署前已采成功、封面仍缺的目标永远不会自动补全。

## 实现落点

- `packages/monitoring/src/auto-video-metadata.ts`
- `packages/monitoring/src/metadata-refresh.ts`（`requestedIds` / 已有 cover 跳过下载）
- `bilibili-job` / `collector-runner` / `apps/collector`
- 文档：`docs/architecture/auto-video-metadata.md`
- 测试：`apps/api/src/auto-video-metadata.integration.test.ts`（保留库 `wp_r2_mon03_*`）
