# Phase 1 — UI / 后端契约审计

基线 `9d9370e0b2c0d3b5b5e6cb92f68d5416f48b641b`。本包只更新记录，不改应用、契约、数据库或运行配置。

当前事实、端口和分阶段缺口写在 [docs/architecture/ui-backend-contract-audit.md](../docs/architecture/ui-backend-contract-audit.md)。已注册路由的机器可读清单是 [docs/architecture/api-inventory.json](../docs/architecture/api-inventory.json)，按源码去重后为 30 条 API，另有 SPA 静态回退，不计入该数。

本包不实现图对齐、采集器或 API 联调。后续联调范围是清单中的全部 30 条已注册 API，包含未接线的旧写路由和导入；没有页面调用方不是排除理由。
