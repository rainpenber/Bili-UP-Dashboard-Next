import type { Sql } from '@studio/db';
import { scrubString, scrubValue } from './redact';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AppLogInsert = {
  ts: Date;
  level: string;
  service: string;
  instance: string | null;
  event: string | null;
  message: string;
  requestId: string | null;
  jobId: string | null;
  runId: string | null;
  targetId: string | null;
  context: Record<string, unknown>;
};

export type LogSinkFailure = {
  ok: false;
  reported: boolean;
  error?: unknown;
};

export type LogSink = {
  write(rows: readonly AppLogInsert[]): Promise<void | LogSinkFailure>;
};

function asUuid(value: string | null): string | null {
  if (!value || !UUID.test(value)) return null;
  return value;
}

function asJson(value: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = scrubValue(value);
  if (!scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) return {};
  return JSON.parse(JSON.stringify(scrubbed)) as Record<string, unknown>;
}

function sinkFailureLine(input: {
  service: string;
  instance: string | null;
  envName: string;
  error: unknown;
}): string {
  const message = scrubString(
    input.error instanceof Error ? input.error.message : 'app_logs sink failed',
  );
  return `${JSON.stringify({
    level: 'error',
    time: new Date().toISOString(),
    service: input.service,
    instance: input.instance,
    env: input.envName,
    msg: 'app_logs 写入失败，已降级到 stdout',
    event: 'log.sink_failed',
    requestId: null,
    jobId: null,
    runId: null,
    targetId: null,
    context: { error: message },
  })}\n`;
}

export function createPgLogSink(
  sql: Sql,
  meta: {
    destination: (line: string) => void;
    service: string;
    instance: string | null;
    envName: string;
  },
): LogSink {
  return {
    async write(rows) {
      if (rows.length === 0) return;
      try {
        await sql.begin(async (tx) => {
          for (const row of rows) {
            const level = ['debug', 'info', 'warn', 'error'].includes(row.level)
              ? row.level
              : 'error';
            const service = row.service === 'collector' ? 'collector' : 'api';
            const context = asJson(row.context);
            await tx`
              INSERT INTO app_logs (
                ts, level, service, instance, event, message,
                request_id, job_id, run_id, target_id, context
              ) VALUES (
                ${row.ts},
                ${level},
                ${service},
                ${row.instance},
                ${row.event},
                ${scrubString(row.message).slice(0, 4000)},
                ${row.requestId},
                ${asUuid(row.jobId)}::uuid,
                ${asUuid(row.runId)}::uuid,
                ${asUuid(row.targetId)}::uuid,
                ${tx.json(JSON.parse(JSON.stringify(context)))}
              )
            `;
          }
        });
      } catch (error) {
        try {
          meta.destination(sinkFailureLine({ ...meta, error }));
        } catch {
          // degrade quietly
        }
        return { ok: false, reported: true, error };
      }
    },
  };
}
