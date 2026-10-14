# Commercial domain database (WP-004R2-A)

Aggregate root: **`commercial_projects`**. All workflow instance rows carry `project_id`; references use composite foreign keys so a row cannot point at another project's nodes, edges, packages, or open items.

## Template versioning

- `wf_template_versions.is_draft`: only draft versions accept structural edits.
- Publishing flips `is_draft` to `FALSE` and sets `published_at` (one-way); triggers block further mutation of published versions and their packages/nodes/edges.

## Workflow instance graph

- `project_workflows`: one workflow per project, pinned to a `template_version_id`.
- `wf_nodes` / `wf_edges`: DAG with cycle detection on insert/update.
- Optional nodes may use status `not_applicable`; required nodes may not.

## Audit

- `domain_audit_events`: append-only audit base table; `project_id` nullable for pre-project system events.

## Local verification

```bash
cp .env.example .env
docker compose up -d postgres
cd packages/db && bun run migrate
CI=true bun test
```
