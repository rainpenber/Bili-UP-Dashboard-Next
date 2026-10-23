import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  parseBiliAccountListItem,
  parseBiliAccountListResponse,
  parseRevokeBiliAccountResponse,
} from '@studio/contracts';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  readBiliAccountSecret,
  readUsableCollectorAccount,
  resolveCollectorAccount,
  type Sql,
} from '@studio/db';
import { installOfflineFetchGuard, type HttpTransport } from '@studio/monitoring';
import { Hono } from 'hono';
import { createAccountsRoutes } from './accounts-routes';

const SECRET_COOKIE =
  'SESSDATA=plain-sess-fixture-9f3a; DedeUserID=900001; bili_jct=plain-jct-9f3a';
const SECRET_KEY = randomBytes(32).toString('base64');

describe('bili accounts API (WP-R2-25A)', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: Hono | null = null;
  const createdIds: string[] = [];

  beforeAll(async () => {
    installOfflineFetchGuard();
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    app = new Hono();
    app.route(
      '/api/v1/accounts',
      createAccountsRoutes(sql, {
        env: {
          MONITOR_DATA_SOURCE: 'mock',
          COLLECTOR_PROVIDER: 'offline',
          COLLECTOR_SECRET_KEY: SECRET_KEY,
        },
      }),
    );
  }, 30_000);

  afterAll(async () => {
    if (sql) {
      for (const id of createdIds) {
        await sql`DELETE FROM bili_account_secrets WHERE account_id = ${id}::uuid`.catch(
          () => undefined,
        );
        await sql`DELETE FROM bili_accounts WHERE id = ${id}::uuid`.catch(() => undefined);
      }
      await sql.end({ timeout: 5 });
    }
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  function http(): Hono {
    if (!app) throw new Error('app missing');
    return app;
  }

  function assertNoSecretLeak(payload: unknown): void {
    const text = JSON.stringify(payload);
    expect(text).not.toContain('plain-sess-fixture-9f3a');
    expect(text).not.toContain('plain-jct-9f3a');
    expect(text).not.toMatch(/"ciphertext"/i);
    expect(text).not.toMatch(/"auth_tag"|"authTag"/i);
    expect(text).not.toContain(SECRET_COOKIE);
  }

  test('list/create/duplicate 409/replace/set default/revoke/mock verify', async () => {
    if (!sql || !app) return;

    const listed = await http().request('/api/v1/accounts');
    expect(listed.status).toBe(200);
    const empty = parseBiliAccountListResponse(await listed.json());
    expect(empty.realAccessEnabled).toBe(false);
    assertNoSecretLeak(empty);

    const createdRes = await http().request('/api/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: SECRET_COOKIE, note: 'fixture-a' }),
    });
    expect(createdRes.status).toBe(201);
    const created = parseBiliAccountListItem(await createdRes.json());
    createdIds.push(created.id);
    expect(created.mid).toBe('900001');
    expect(created.secretPresent).toBe(true);
    expect(created.derivedExpiryState).toBe('ok');
    expect(created.isDefault).toBe(true);
    assertNoSecretLeak(created);

    const secret = await readBiliAccountSecret(sql, created.id);
    expect(secret).not.toBeNull();
    expect(secret!.ciphertext.length).toBeGreaterThan(0);

    const dup = await http().request('/api/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: SECRET_COOKIE, note: 'dup' }),
    });
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as { code: string };
    expect(dupBody.code).toBe('mid_conflict');
    assertNoSecretLeak(dupBody);

    const secondCookie =
      'SESSDATA=plain-sess-fixture-bbbb; DedeUserID=900002; bili_jct=plain-jct-bbbb';
    const secondRes = await http().request('/api/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: secondCookie, note: 'fixture-b' }),
    });
    expect(secondRes.status).toBe(201);
    const second = parseBiliAccountListItem(await secondRes.json());
    createdIds.push(second.id);
    expect(second.isDefault).toBe(false);

    const setDefault = await http().request(`/api/v1/accounts/${second.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    expect(setDefault.status).toBe(200);
    const defaulted = parseBiliAccountListItem(await setDefault.json());
    expect(defaulted.isDefault).toBe(true);
    const afterDefault = parseBiliAccountListResponse(
      await (await http().request('/api/v1/accounts')).json(),
    );
    const defaults = afterDefault.items.filter((item) => item.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(second.id);

    const missing = await http().request(
      `/api/v1/accounts/${'00000000-0000-4000-8000-000000000099'}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'x' }),
      },
    );
    expect(missing.status).toBe(404);

    const verifyMock = await http().request(`/api/v1/accounts/${created.id}/verify`, {
      method: 'POST',
    });
    expect(verifyMock.status).toBe(409);
    expect(((await verifyMock.json()) as { code: string }).code).toBe('real_access_disabled');

    const resolvedBefore = await resolveCollectorAccount(sql, {
      targetAccountId: null,
      forcedAccountId: null,
    });
    expect(resolvedBefore?.id).toBe(second.id);

    const revokedRes = await http().request(`/api/v1/accounts/${second.id}`, {
      method: 'DELETE',
    });
    expect(revokedRes.status).toBe(200);
    const revoked = parseRevokeBiliAccountResponse(await revokedRes.json());
    expect(revoked.account.status).toBe('revoked');
    expect(revoked.account.secretPresent).toBe(false);
    expect(revoked.account.derivedExpiryState).toBe('revoked');
    assertNoSecretLeak(revoked);

    const secretAfter = await readBiliAccountSecret(sql, second.id);
    expect(secretAfter).toBeNull();

    const usable = await readUsableCollectorAccount(sql, second.id);
    expect(usable.account).toBeNull();
    expect(usable.skipReason ?? '').toMatch(/撤销/);

    const resolvedAfter = await resolveCollectorAccount(sql, {
      targetAccountId: null,
      forcedAccountId: second.id,
    });
    expect(resolvedAfter).toBeNull();

    const replaceRes = await http().request('/api/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cookie: 'SESSDATA=plain-sess-fixture-cccc; DedeUserID=900001; bili_jct=plain-jct-cccc',
        note: 'replaced',
        replace: true,
      }),
    });
    expect(replaceRes.status).toBe(201);
    const replaced = parseBiliAccountListItem(await replaceRes.json());
    expect(replaced.id).toBe(created.id);
    expect(replaced.note).toBe('replaced');
    assertNoSecretLeak(replaced);
  });

  test('verify with injected transport updates lastVerifiedAt', async () => {
    if (!sql) return;
    const transport: HttpTransport = async () => ({
      status: 200,
      body: JSON.stringify({
        code: 0,
        data: { isLogin: true, mid: 900003, uname: '校验号', face: '' },
      }),
      headers: {},
      durationMs: 1,
    });
    const verifyApp = new Hono();
    verifyApp.route(
      '/api/v1/accounts',
      createAccountsRoutes(sql, {
        transport,
        env: {
          MONITOR_DATA_SOURCE: 'collector',
          COLLECTOR_PROVIDER: 'bilibili',
          COLLECTOR_SECRET_KEY: SECRET_KEY,
        },
      }),
    );
    const createRes = await verifyApp.request('/api/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cookie: 'SESSDATA=plain-sess-fixture-dddd; DedeUserID=900003; bili_jct=plain-jct-dddd',
        note: 'verify',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = parseBiliAccountListItem(await createRes.json());
    createdIds.push(created.id);

    const verifiedRes = await verifyApp.request(`/api/v1/accounts/${created.id}/verify`, {
      method: 'POST',
    });
    expect(verifiedRes.status).toBe(200);
    const body = (await verifiedRes.json()) as {
      verified: boolean;
      account: { uname: string | null; lastVerifiedAt: string | null };
    };
    expect(body.verified).toBe(true);
    expect(body.account.uname).toBe('校验号');
    expect(body.account.lastVerifiedAt).toBeTruthy();
    assertNoSecretLeak(body);
  });
});
