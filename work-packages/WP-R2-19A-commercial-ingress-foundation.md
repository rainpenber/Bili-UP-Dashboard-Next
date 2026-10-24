# WP-R2-19A 真实商单确定性接入基础

## 行为

- 新增迁移 `016_commercial_source_ingress`：`commercial_projects.origin_kind`（`real` / `fixture` / `manual` / `NULL`）与表 `commercial_project_sources`（namespace+sourceId 唯一、payload/evidence JSONB object、content_hash、source_updated_at、源状态/备注事实）。
- 仅按声明的 `FIXTURE_PROJECT_IDS`（13 条）标记 `origin_kind=fixture`；不把其他旧行一刀切成样例或真数据。
- 共享服务：`POST /api/v1/commercial/ingress/upsert`、`POST /api/v1/commercial/ingress/batch`（最多 100）、`GET .../ingress/by-source/:namespace/:sourceId`。支持 `dryRun`；dry-run 不写项目/实例/来源/审计。
- 创建时复制已发布默认模板，节点默认 `not_reached`；缺默认模板明确拒绝。更新必须带 `expectedUpdatedAt`，无 force 绕过。同版本同内容幂等；同版本不同内容冲突；旧源版本拒绝。
- 列表支持 `originKind` / `limit` / `offset` 与 `total`；前端项目列表增加来源筛选；真实来源无记录时诚实空态。监控 / onlyMine / 内部模拟 / 收藏不动。

## 非目标

- 不访问微信/FNS/飞书/B 站/LLM，不写 79 条真实商单，不做字段/状态证据映射（留 19B）。
- 不推断节点完成、到账、发布 BV 或完成日期；源状态不是资金闭环证明。
- 不改 Compose/CI 拓扑，不部署/合并。

## 验收要点

- format / lint / typecheck / test / build；contracts + api-inventory + http-coverage。
- 真实 Postgres 隔离/保留库；幂等、并发、全批回滚、样例保留。
- 详见 [docs/architecture/commercial-ingress.md](../docs/architecture/commercial-ingress.md)。
