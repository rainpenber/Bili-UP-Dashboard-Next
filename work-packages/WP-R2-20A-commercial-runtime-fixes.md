# WP-R2-20A 商单运行态修复：HTTP UUID、今日看板、发布总阶段

## 根因

1. **局域网 HTTP 下 `crypto.randomUUID` 不可用**：非安全上下文没有 `randomUUID`，`stage-step-controls` 在 `publish_required` 时直接调用导致弹窗打不开。
2. **今日看板只看 openItems / 阻塞**：真实 active 项目常无开放事项，看板计数全为 0；归档 fixture 又被 19E 排除，页面空。
3. **旧 `POST .../nodes/:id/publish` 未同步 `overall_stage`**：只写发布记录并完成节点；`/step` 才会 `syncOverallStage`，造成 `publish.published=true` 但项目仍停在 `pre_publish`。

## 行为

- Web 端幂等键 helper：优先 `randomUUID` → `getRandomValues` 构造 UUID v4 → 客户端兜底；不要求 HTTPS。
- 今日看板新增「进行中项目」区：默认未归档列表中 `businessState === 'active'`；展示名称、当前节点/整体阶段、来源状态、详情入口；事项数与进行中项目数分计。
- `publishNode()` 在同一事务内调用 `syncOverallStage`（含幂等重放 / 补完成节点路径）。

## 非目标

- 不改归档策略，不回退 05A / 19C / 19E / 16H。
- 不改 `/step` 契约；不部署生产。

## 验收

- `pnpm lint` / `pnpm test` / `pnpm build`（仓库脚本亦可用 `bun run …`）
- 新旧相关 API 集成测试通过
