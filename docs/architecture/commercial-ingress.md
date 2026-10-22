# 商单来源接入基础（WP-R2-19A）

本包只建立**确定性**接入层：外部身份关联、来源快照、单个/批量幂等 upsert、来源过滤。  
实际 79 条迁移、字段/状态证据映射与默认真实视图留给 **WP-R2-19B（Hermes 本机）**。Cloud 不得接触真实客户消息、源项目全量 JSON、微信身份或密钥。

## 数据模型

| 对象                              | 说明                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commercial_projects.origin_kind` | `real` / `fixture` / `manual` / `NULL`（未分类）。仅声明的 fixture UUID 被标为 `fixture`。                                                                                                                                     |
| `commercial_project_sources`      | `(namespace, source_id)` 唯一；一对一绑定 `project_id`。`payload` / `evidence` 为 JSONB **object**。`source_status` / `source_notes` 为来源事实，不驱动工作流。`source_updated_at` 为源版本钟；`content_hash` 用于同版本幂等。 |

迁移：`016_commercial_source_ingress`。

## 不变量（摘要）

1. 身份精确匹配；金额 `null` 不变 `0`；日期不默认今天；创建复制已发布默认模板且节点 `not_reached`；缺模板拒绝。
2. 单个/批量同一服务；dry-run 无写痕；批最大 100；事务原子 + 稳定锁序（`pg_advisory_xact_lock` + `FOR UPDATE`）；更新要 `expectedUpdatedAt`。
3. 样例按 fixture ID 标记并保留；切换 `originKind=real` 无记录时为空态。

## HTTP

| 方法 | 路径                                                        | 说明                            |
| ---- | ----------------------------------------------------------- | ------------------------------- |
| POST | `/api/v1/commercial/ingress/upsert`                         | 单条；body `{ item, dryRun? }`  |
| POST | `/api/v1/commercial/ingress/batch`                          | 批量；body `{ items, dryRun? }` |
| GET  | `/api/v1/commercial/ingress/by-source/:namespace/:sourceId` | 来源查询                        |
| GET  | `/api/v1/commercial/projects?originKind=&limit=&offset=`    | 列表过滤 + `total`              |

契约：`packages/contracts/src/commercial-ingress.ts`。

### curl 占位（无秘密）

```bash
# dry-run create
curl -sS -X POST "$API/api/v1/commercial/ingress/upsert" \
  -H 'content-type: application/json' \
  -d '{
    "dryRun": true,
    "item": {
      "sourceKey": { "namespace": "hermes.fixture", "sourceId": "example-1" },
      "originKind": "fixture",
      "sourceUpdatedAt": "2026-10-01T00:00:00.000Z",
      "name": "受控样例",
      "netAmount": "1000.00",
      "rebateAmount": null,
      "sourceStatus": "跟进中",
      "sourceNotes": null,
      "payload": { "title": "受控样例" },
      "evidence": { "kind": "fixture" }
    }
  }'

# lookup
curl -sS "$API/api/v1/commercial/ingress/by-source/hermes.fixture/example-1"

# filter real (honest empty until 19B)
curl -sS "$API/api/v1/commercial/projects?originKind=real&limit=20&offset=0"
```

### 结果 schema（要点）

- Upsert result：`{ result: { sourceKey, outcome, projectId, workflowId, projectUpdatedAt, contentHash, dryRun } }`
- `outcome`：`created` | `updated` | `idempotent_replay` | `would_*`（dry-run）
- 错误：`{ error, code, sourceKeys? }` — `stale_source_version` / `same_version_content_conflict` / `stale_write` / `expected_updated_at_required` / `duplicate_source_key` / `default_template_missing` 等
- 列表：`{ items, total, limit, offset }`；item 含 `originKind`、`source` 摘要、`updatedAt`

## 前端

项目列表筛选增加「来源」；`originKind=real` 且 `total=0` 时显示诚实空态。详情只读展示来源 metadata。不重做卡片/节点图。
