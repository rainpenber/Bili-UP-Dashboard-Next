# WP-004R2-A — Domain model & database invariants (REBUILD)

status: implemented on branch `cursor/wp-004r2-a-domain-db-9c9e`

## Goal

Minimal complete PostgreSQL contract for the commercial domain: projects, versioned workflow templates, workflow instances (DAG), open items, publish record, monitoring placeholders, Hermes proposal placeholder, and `domain_audit_events`.

## Migrations

- `004_commercial_domain.sql` — consolidated schema (no legacy WP-004 upgrade path).

## Invariants (DB boundary)

| Invariant                         | Enforcement                                                                                                                                                                       | Tests                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Ownership / no cross-project refs | Composite FKs: `wf_edges (workflow_id, node_id)`, `wf_nodes (workflow_id, project_id)`, `open_items (project_id, node_id)`, `wf_nodes (project_id, primary_block_pinned_item_id)` | `commercial-invariants.test.ts`                             |
| Published template immutability   | Triggers on `wf_template_versions` + child tables                                                                                                                                 | `commercial-invariants.test.ts`                             |
| Template child version scope      | Composite FKs on template packages/nodes/edges                                                                                                                                    | `commercial-invariants.test.ts` (cross-version edge)        |
| DAG (no self-loop / cycle)        | `CHECK (from <> to)` + cycle triggers on `wf_edges` / `wf_template_edges`                                                                                                         | `commercial-invariants.test.ts`                             |
| Applicability                     | `CHECK (status <> 'not_applicable' OR is_optional)`                                                                                                                               | `commercial-invariants.test.ts`                             |
| Idempotent seed                   | `ON CONFLICT DO NOTHING` in migration + fixture seed                                                                                                                              | `commercial-migrate.test.ts`, `commercial-fixtures.test.ts` |

## Out of scope

UI, API behavior, Hermes engine, undo/redo services, collectors, Playwright.
