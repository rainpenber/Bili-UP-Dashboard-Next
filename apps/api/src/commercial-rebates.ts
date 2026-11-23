import {
  parseCommercialRebateCreateRequest,
  parseCommercialRebateResponse,
  parseCommercialRebateUpdateRequest,
  parseCommercialRebateListResponse,
  type CommercialRebate,
  type CommercialRebateCreateRequest,
  type CommercialRebateErrorBody,
  type CommercialRebateErrorCode,
  type CommercialRebateUpdateRequest,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import postgres from 'postgres';
import { COMMERCIAL_UPDATED_AT_FORMAT } from './commercial-timestamp';

type Tx = postgres.TransactionSql;

type RebateRow = {
  id: string;
  project_id: string | null;
  project_name: string;
  counterparty: string | null;
  expected_amount: string | null;
  effective_amount: string | null;
  is_returned: boolean;
  returned_at: string | null;
  contract_state: string;
  invoice_state: string;
  note: string | null;
  evidence: unknown;
  stage_since: string;
  created_at: string;
  updated_at: string;
  platform_paid: boolean;
  days_in_stage: number;
};

type RebateCurrentRow = {
  id: string;
  project_id: string | null;
  project_name: string;
  counterparty: string | null;
  expected_amount: string | null;
  is_returned: boolean;
  returned_at: string | null;
  contract_state: string;
  invoice_state: string;
  note: string | null;
  evidence: unknown;
  updated_at: string;
};

class RebateRefusal extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: CommercialRebateErrorCode;

  constructor(status: 400 | 404 | 409, code: CommercialRebateErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get body(): CommercialRebateErrorBody {
    return { error: this.message, code: this.code };
  }
}

function refuse(status: 400 | 404 | 409, code: CommercialRebateErrorCode, message: string): never {
  throw new RebateRefusal(status, code, message);
}

const REBATE_SELECT = `
  SELECT
    r.id,
    r.project_id,
    r.project_name,
    r.counterparty,
    r.expected_amount::text AS expected_amount,
    CASE
      WHEN r.project_id IS NULL THEN r.expected_amount::text
      ELSE p.rebate_amount::text
    END AS effective_amount,
    r.is_returned,
    to_char(r.returned_at, 'YYYY-MM-DD') AS returned_at,
    r.contract_state,
    r.invoice_state,
    r.note,
    r.evidence,
    to_char(r.stage_since AT TIME ZONE 'UTC', '${COMMERCIAL_UPDATED_AT_FORMAT}') AS stage_since,
    to_char(r.created_at AT TIME ZONE 'UTC', '${COMMERCIAL_UPDATED_AT_FORMAT}') AS created_at,
    to_char(r.updated_at AT TIME ZONE 'UTC', '${COMMERCIAL_UPDATED_AT_FORMAT}') AS updated_at,
    CASE
      WHEN r.project_id IS NOT NULL
        AND s.source_status IN ('3.收尾-待提现', '3.收尾-已提现')
      THEN TRUE
      ELSE FALSE
    END AS platform_paid,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - r.stage_since)) / 86400))::int AS days_in_stage
  FROM commercial_rebates r
  LEFT JOIN commercial_projects p ON p.id = r.project_id
  LEFT JOIN commercial_project_sources s ON s.project_id = r.project_id
`;

function toRebate(row: RebateRow): CommercialRebate {
  return parseCommercialRebateResponse({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    counterparty: row.counterparty,
    expectedAmount: row.effective_amount,
    isReturned: row.is_returned,
    returnedAt: row.returned_at,
    contractState: row.contract_state,
    invoiceState: row.invoice_state,
    note: row.note,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    stageSince: row.stage_since,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    platformPaid: row.platform_paid,
    daysInStage: Number(row.days_in_stage),
  });
}

function cents(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function moneyText(value: number): string {
  return (value / 100).toFixed(2);
}

function summarize(items: CommercialRebate[]): {
  outstandingTotal: string;
  outstandingPlatformPaid: string;
  outstandingPlatformUnpaid: string;
  settledThisYear: string;
  openCount: number;
} {
  let outstanding = 0;
  let paid = 0;
  let unpaid = 0;
  let settled = 0;
  let openCount = 0;
  const year = new Date().getUTCFullYear();
  for (const item of items) {
    const amount = cents(item.expectedAmount);
    if (item.isReturned) {
      if (item.returnedAt !== null && Number(item.returnedAt.slice(0, 4)) === year) {
        settled += amount;
      }
      continue;
    }
    openCount += 1;
    outstanding += amount;
    if (item.platformPaid) paid += amount;
    else unpaid += amount;
  }
  return {
    outstandingTotal: moneyText(outstanding),
    outstandingPlatformPaid: moneyText(paid),
    outstandingPlatformUnpaid: moneyText(unpaid),
    settledThisYear: moneyText(settled),
    openCount,
  };
}

async function readAll(tx: Tx | Sql): Promise<CommercialRebate[]> {
  const rows = await tx.unsafe<RebateRow[]>(
    `${REBATE_SELECT} ORDER BY r.is_returned, r.stage_since, r.project_name, r.id`,
  );
  return rows.map(toRebate);
}

async function readOne(tx: Tx | Sql, rebateId: string): Promise<CommercialRebate> {
  const rows = await tx.unsafe<RebateRow[]>(`${REBATE_SELECT} WHERE r.id = $1`, [rebateId]);
  const row = rows[0];
  if (!row) refuse(404, 'not_found', '返点记录不存在');
  return toRebate(row);
}

function audit(
  tx: Tx,
  projectId: string | null,
  rebateId: string,
  action: 'rebate_update' | 'rebate_create',
  detail: Record<string, unknown>,
): Promise<unknown> {
  return tx`
    INSERT INTO domain_audit_events (project_id, entity_type, entity_id, action, detail, source)
    VALUES (
      ${projectId},
      'commercial_rebate',
      ${rebateId},
      ${action},
      ${tx.json(detail as postgres.JSONValue)},
      'web'
    )
  `;
}

function assertToken(actual: string, expected: string): void {
  if (actual !== expected) refuse(409, 'stale_write', '返点记录已被修改，请刷新后重试');
}

async function parseBody<T>(c: Context, parse: (value: unknown) => T): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: '请求体不是合法 JSON', code: 'invalid_body' }, 400);
  }
  try {
    return parse(raw);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : '请求体无效', code: 'invalid_body' },
      400,
    );
  }
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function mapWriteError(c: Context, err: unknown): Response {
  if (err instanceof RebateRefusal) return c.json(err.body, err.status);
  if (err instanceof postgres.PostgresError && ['23505', '23514', '23503'].includes(err.code)) {
    return c.json({ error: '返点记录与现有数据冲突', code: 'constraint_violation' }, 409);
  }
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
}

async function updateRebate(
  tx: Tx,
  rebateId: string,
  input: CommercialRebateUpdateRequest,
): Promise<CommercialRebate> {
  const rows = await tx<RebateCurrentRow[]>`
    SELECT
      id,
      project_id,
      project_name,
      counterparty,
      expected_amount::text AS expected_amount,
      is_returned,
      to_char(returned_at, 'YYYY-MM-DD') AS returned_at,
      contract_state,
      invoice_state,
      note,
      evidence,
      to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM commercial_rebates
    WHERE id = ${rebateId}
    FOR UPDATE
  `;
  const current = rows[0];
  if (!current) refuse(404, 'not_found', '返点记录不存在');
  assertToken(current.updated_at, input.expectedUpdatedAt);

  if (input.expectedAmount !== undefined) {
    if (current.project_id !== null) {
      refuse(
        409,
        'amount_locked',
        '关联项目的返点金额以项目为准，请到项目金额接口修改 rebateAmount',
      );
    }
    if (input.expectedAmount === null) {
      refuse(400, 'invalid_body', '历史返点记录必须保留应返金额');
    }
  }

  const nextReturned = input.isReturned ?? current.is_returned;
  if (!nextReturned && input.returnedAt !== undefined && input.returnedAt !== null) {
    refuse(400, 'invalid_body', '未标记已返时不能填写返款日期');
  }
  const nextContract = input.contractState ?? current.contract_state;
  const nextInvoice = input.invoiceState ?? current.invoice_state;
  const nextCounterparty =
    input.counterparty !== undefined ? input.counterparty : current.counterparty;
  const nextNote = input.note !== undefined ? input.note : current.note;
  const nextEvidence = input.evidence !== undefined ? input.evidence : current.evidence;
  const nextExpected =
    input.expectedAmount !== undefined ? input.expectedAmount : current.expected_amount;
  const stageChanged =
    nextReturned !== current.is_returned ||
    nextContract !== current.contract_state ||
    nextInvoice !== current.invoice_state;

  await tx`
    UPDATE commercial_rebates
    SET
      counterparty = ${nextCounterparty},
      expected_amount = ${nextExpected},
      is_returned = ${nextReturned},
      returned_at = CASE
        WHEN ${nextReturned}::boolean THEN
          COALESCE(${input.returnedAt ?? null}::date, ${current.returned_at}::date, CURRENT_DATE)
        ELSE NULL
      END,
      contract_state = ${nextContract},
      invoice_state = ${nextInvoice},
      note = ${nextNote},
      evidence = ${tx.json(nextEvidence as postgres.JSONValue)},
      stage_since = CASE WHEN ${stageChanged}::boolean THEN now() ELSE stage_since END,
      updated_at = now()
    WHERE id = ${rebateId}
  `;

  const updated = await readOne(tx, rebateId);
  await audit(tx, current.project_id, rebateId, 'rebate_update', {
    before: {
      isReturned: current.is_returned,
      returnedAt: current.returned_at,
      contractState: current.contract_state,
      invoiceState: current.invoice_state,
      expectedAmount: current.expected_amount,
      counterparty: current.counterparty,
      note: current.note,
    },
    after: {
      isReturned: updated.isReturned,
      returnedAt: updated.returnedAt,
      contractState: updated.contractState,
      invoiceState: updated.invoiceState,
      expectedAmount: updated.expectedAmount,
      counterparty: updated.counterparty,
      note: updated.note,
    },
  });
  return updated;
}

async function createRebate(
  tx: Tx,
  input: CommercialRebateCreateRequest,
): Promise<CommercialRebate> {
  const projectId = input.projectId ?? null;
  const projectName = input.projectName.trim();
  if (projectId !== null) {
    const projects = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM commercial_projects WHERE id = ${projectId}
    `;
    if (!projects[0]) refuse(404, 'not_found', '项目不存在');
    const duplicates = await tx<{ id: string }[]>`
      SELECT id FROM commercial_rebates WHERE project_id = ${projectId}
    `;
    if (duplicates[0]) refuse(409, 'duplicate_project', '该项目已有返点记录');
  } else {
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM commercial_rebates
      WHERE project_id IS NULL AND project_name = ${projectName}
    `;
    if (existing[0]) refuse(409, 'duplicate_project', '同名历史返点记录已存在');
    if (input.expectedAmount === null || input.expectedAmount === undefined) {
      refuse(400, 'invalid_body', '历史返点记录必须填写应返金额');
    }
  }

  const isReturned = input.isReturned ?? false;
  if (!isReturned && input.returnedAt !== undefined && input.returnedAt !== null) {
    refuse(400, 'invalid_body', '未标记已返时不能填写返款日期');
  }
  const contractState = input.contractState ?? 'none';
  const invoiceState = input.invoiceState ?? 'none';
  const note = input.note ?? null;
  const counterparty = input.counterparty ?? null;
  const expectedAmount = input.expectedAmount ?? null;
  const evidence = input.evidence ?? [];

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO commercial_rebates (
      project_id, project_name, counterparty, expected_amount,
      is_returned, returned_at, contract_state, invoice_state, note, evidence
    ) VALUES (
      ${projectId},
      ${projectName},
      ${counterparty},
      ${expectedAmount},
      ${isReturned},
      CASE
        WHEN ${isReturned}::boolean THEN COALESCE(${input.returnedAt ?? null}::date, CURRENT_DATE)
        ELSE NULL
      END,
      ${contractState},
      ${invoiceState},
      ${note},
      ${tx.json(evidence as postgres.JSONValue)}
    )
    RETURNING id
  `;
  const id = inserted[0]?.id;
  if (!id) refuse(404, 'not_found', '返点记录创建失败');
  const created = await readOne(tx, id);
  await audit(tx, projectId, id, 'rebate_create', {
    isReturned: created.isReturned,
    returnedAt: created.returnedAt,
    contractState: created.contractState,
    invoiceState: created.invoiceState,
    expectedAmount: created.expectedAmount,
    counterparty: created.counterparty,
    note: created.note,
  });
  return created;
}

export function registerCommercialRebateRoutes(app: Hono, db: Sql): void {
  app.get('/rebates', async (c) => {
    try {
      const items = await readAll(db);
      return c.json(parseCommercialRebateListResponse({ items, summary: summarize(items) }));
    } catch (err) {
      console.error(err);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.patch('/rebates/:rebateId', async (c) => {
    const rebateId = c.req.param('rebateId');
    if (!isUuid(rebateId)) {
      return c.json({ error: '返点 id 不是 uuid', code: 'invalid_body' }, 400);
    }
    const body = await parseBody(c, parseCommercialRebateUpdateRequest);
    if (body instanceof Response) return body;
    try {
      const updated = await db.begin((tx) => updateRebate(tx, rebateId, body));
      return c.json(parseCommercialRebateResponse(updated));
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  app.post('/rebates', async (c) => {
    const body = await parseBody(c, parseCommercialRebateCreateRequest);
    if (body instanceof Response) return body;
    try {
      const created = await db.begin((tx) => createRebate(tx, body));
      return c.json(parseCommercialRebateResponse(created), 201);
    } catch (err) {
      return mapWriteError(c, err);
    }
  });
}
