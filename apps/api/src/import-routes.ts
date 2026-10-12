import {
  mapHttpModeToImportMode,
  parseImportCsvRequest,
  type ImportBatchResponse,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import { runImport } from '@studio/monitoring';
import { resolveMockDataLayout } from '@studio/monitoring';
import { Hono } from 'hono';

export function createImportRoutes(db: Sql) {
  const app = new Hono();

  app.post('/csv', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    let req;
    try {
      req = parseImportCsvRequest(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid request';
      return c.json({ error: message }, 400);
    }
    try {
      const layout = resolveMockDataLayout();
      const mode = mapHttpModeToImportMode(req.mode);
      const sourceTimezone = req.sourceTimezone ?? process.env.SOURCE_TIMEZONE ?? 'Asia/Shanghai';
      process.env.MONITOR_ASSETS_ROOT = layout.assetsRoot;
      const result = await runImport({
        mode,
        backendRoot: layout.backendRoot,
        frontendRoot: layout.frontendRoot,
        assetsRoot: layout.assetsRoot,
        sourceTimezone,
        sql: db,
      });
      if (result.failed) {
        return c.json(
          {
            batchId: result.batchId,
            status: 'failed',
            error: result.report.anomalies.at(-1) ?? 'import failed',
            report: result.report,
          },
          500,
        );
      }
      return c.json({
        batchId: result.batchId,
        status: 'completed',
        report: result.report,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'import failed';
      if (message.includes('MOCK_DATA_ROOT')) {
        return c.json({ error: message }, 503);
      }
      return c.json({ error: message }, 500);
    }
  });

  app.get('/:batchId', async (c) => {
    const batchId = c.req.param('batchId');
    const rows = await db`
      SELECT id, mode, source_timezone, status, importer_version, report_json, error_message, completed_at
      FROM import_batches WHERE id = ${batchId}
    `;
    const row = rows[0] as
      | {
          id: string;
          mode: string;
          source_timezone: string;
          status: string;
          importer_version: string | null;
          report_json: Record<string, unknown> | null;
          error_message: string | null;
          completed_at: Date | null;
        }
      | undefined;
    if (!row) return c.json({ error: 'batch not found' }, 404);

    const evidence = await db`
      SELECT
        (SELECT count(*)::int FROM source_metric_rows WHERE batch_id = ${batchId}) AS staging_rows,
        (SELECT count(*)::int FROM import_conflicts_or_rejects WHERE batch_id = ${batchId}) AS evidence_rows
    `;
    const ev = evidence[0] as { staging_rows: number; evidence_rows: number } | undefined;

    const payload: ImportBatchResponse & {
      evidence: { stagingRows: number; conflictOrRejectRows: number };
    } = {
      batchId: row.id,
      status: row.status as ImportBatchResponse['status'],
      mode: row.mode,
      sourceTimezone: row.source_timezone,
      importerVersion: row.importer_version,
      report: row.report_json,
      errorMessage: row.error_message,
      completedAt: row.completed_at?.toISOString() ?? null,
      evidence: {
        stagingRows: ev?.staging_rows ?? 0,
        conflictOrRejectRows: ev?.evidence_rows ?? 0,
      },
    };
    return c.json(payload);
  });

  return app;
}
