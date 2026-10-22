import {
  MonitorContractError,
  parseStudioOwnerAccount,
  parseUpdateStudioOwnerAccountRequest,
} from '@studio/contracts';
import { getStudioOwnerAccount, updateStudioOwnerAccount, type Sql } from '@studio/db';
import type { Hono } from 'hono';

function jsonError(err: unknown): {
  status: 400 | 404 | 500;
  body: { error: string; code: string };
} {
  if (err instanceof MonitorContractError) {
    return { status: 400, body: { error: err.message, code: err.code } };
  }
  const message = err instanceof Error ? err.message : '请求无法处理';
  return { status: 500, body: { error: message, code: 'internal' } };
}

export function registerStudioOwnerRoutes(app: Hono, db: Sql): void {
  app.get('/settings/owner-account', async (c) => {
    try {
      const row = await getStudioOwnerAccount(db);
      if (!row) {
        return c.json(
          {
            error: '尚未配置本人 B 站账号，请到集成与设置中填写 UID',
            code: 'owner_account_not_configured',
          },
          404,
        );
      }
      return c.json(
        parseStudioOwnerAccount({
          mid: row.mid,
          displayName: row.displayName,
          updatedAt: row.updatedAt.toISOString(),
        }),
      );
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.put('/settings/owner-account', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as unknown;
      const input = parseUpdateStudioOwnerAccountRequest(body);
      const row = await updateStudioOwnerAccount(db, input);
      return c.json(
        parseStudioOwnerAccount({
          mid: row.mid,
          displayName: row.displayName,
          updatedAt: row.updatedAt.toISOString(),
        }),
      );
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });
}
