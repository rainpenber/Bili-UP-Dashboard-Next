import {
  deriveBiliAccountExpiryState,
  MonitorContractError,
  parseCreateBiliAccountRequest,
  parsePatchBiliAccountRequest,
  type BiliAccountListItem,
} from '@studio/contracts';
import {
  BiliAccountStoreError,
  createBiliAccount,
  getBiliAccount,
  listBiliAccounts,
  markBiliAccountVerified,
  markBiliAccountVerifyFailed,
  patchBiliAccount,
  readBiliAccountSecret,
  revokeBiliAccount,
  type BiliAccountRecord,
  type Sql,
} from '@studio/db';
import {
  bilibiliHeaders,
  cookieHeader,
  createLiveBilibiliTransport,
  decryptCookieJar,
  encryptCookieJar,
  isBilibiliRealAccessEnabled,
  loadCollectorSecretKey,
  parseCookieHeaderString,
  parseNav,
  readBizCode,
  scrubSensitive,
  type EncryptedCookie,
  type HttpTransport,
} from '@studio/monitoring';
import type { StudioLogger } from '@studio/observability';
import { Hono } from 'hono';
import type { ApiEnv } from './app';
import { readMonitorDataSource } from './data-source';

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function contextLogger(c: { get?: (key: string) => unknown }): StudioLogger | null {
  if (!c.get) return null;
  try {
    const value = c.get('log');
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as StudioLogger).info === 'function'
    ) {
      return value as StudioLogger;
    }
    return null;
  } catch {
    return null;
  }
}

export type AccountsRouteOptions = {
  transport?: HttpTransport;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
};

function toListItem(row: BiliAccountRecord, now: Date): BiliAccountListItem {
  return {
    id: row.id,
    mid: row.mid,
    uname: row.uname,
    status: row.status,
    isDefault: row.isDefault,
    cookieExpiresAt: row.cookieExpiresAt?.toISOString() ?? null,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    note: row.note,
    secretPresent: row.secretPresent,
    derivedExpiryState: deriveBiliAccountExpiryState({
      status: row.status,
      secretPresent: row.secretPresent,
      cookieExpiresAt: row.cookieExpiresAt,
      now,
    }),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function jsonError(err: unknown): {
  status: 400 | 404 | 409 | 500;
  body: { error: string; code: string };
} {
  if (err instanceof MonitorContractError) {
    return { status: 400, body: { error: err.message, code: err.code } };
  }
  if (err instanceof BiliAccountStoreError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  const message = err instanceof Error ? scrubSensitive(err.message) : '请求无法处理';
  return { status: 500, body: { error: message, code: 'internal' } };
}

function assertAccountId(raw: string): string {
  if (!UUID_RE.test(raw)) {
    throw new BiliAccountStoreError('not_found', '账号不存在', 404);
  }
  return raw;
}

function requireSecretKey(env: NodeJS.ProcessEnv): Buffer {
  const key = loadCollectorSecretKey(env.COLLECTOR_SECRET_KEY);
  if (!key) {
    throw new BiliAccountStoreError(
      'secret_key_missing',
      'COLLECTOR_SECRET_KEY 未配置，无法加密或校验凭据',
      409,
    );
  }
  return key;
}

function assertRealAccess(env: NodeJS.ProcessEnv): void {
  try {
    if (readMonitorDataSource(env) === 'mock' || !isBilibiliRealAccessEnabled(env)) {
      throw new BiliAccountStoreError(
        'real_access_disabled',
        '当前为 mock / 未开启真实 B 站访问，不能校验登录态',
        409,
      );
    }
  } catch (err) {
    if (err instanceof BiliAccountStoreError) throw err;
    throw new BiliAccountStoreError(
      'real_access_disabled',
      '当前为 mock / 未开启真实 B 站访问，不能校验登录态',
      409,
    );
  }
}

export function createAccountsRoutes(db: Sql, options: AccountsRouteOptions = {}) {
  const app = new Hono<ApiEnv>();
  const envOf = () => options.env ?? process.env;
  const nowOf = () => options.now?.() ?? new Date();

  app.get('/', async (c) => {
    try {
      const rows = await listBiliAccounts(db);
      const now = nowOf();
      const env = envOf();
      let realAccessEnabled = false;
      try {
        realAccessEnabled =
          readMonitorDataSource(env) !== 'mock' && isBilibiliRealAccessEnabled(env);
      } catch {
        realAccessEnabled = false;
      }
      return c.json({
        items: rows.map((row) => toListItem(row, now)),
        realAccessEnabled,
      });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.post('/', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as unknown;
      const input = parseCreateBiliAccountRequest(body);
      const { jar, mid: cookieMid } = parseCookieHeaderString(input.cookie);
      const mid = input.mid ?? cookieMid;
      if (!mid) {
        throw new MonitorContractError(
          'invalid_cookie',
          'Cookie 中缺少 DedeUserID，或请在请求中提供 mid',
        );
      }
      if (!jar.SESSDATA) {
        throw new MonitorContractError('invalid_cookie', 'Cookie 中缺少 SESSDATA');
      }
      const key = requireSecretKey(envOf());
      const secret = encryptCookieJar(jar, key);
      const account = await createBiliAccount(db, {
        id: crypto.randomUUID(),
        mid,
        uname: null,
        note: input.note ?? '',
        cookieExpiresAt: null,
        secret: {
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.authTag,
          keyVersion: secret.keyVersion,
        },
        replace: input.replace === true,
      });
      contextLogger(c)?.info('bili account created', {
        event: 'accounts.create',
        context: { accountId: account.id, action: 'create', replace: input.replace === true },
      });
      return c.json(toListItem(account, nowOf()), 201);
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.patch('/:id', async (c) => {
    try {
      const id = assertAccountId(c.req.param('id'));
      const body = (await c.req.json().catch(() => null)) as unknown;
      const input = parsePatchBiliAccountRequest(body);
      const account = await patchBiliAccount(db, id, input);
      contextLogger(c)?.info('bili account patched', {
        event: 'accounts.patch',
        context: {
          accountId: account.id,
          action: 'patch',
          fields: Object.keys(input),
        },
      });
      return c.json(toListItem(account, nowOf()));
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.post('/:id/verify', async (c) => {
    try {
      const id = assertAccountId(c.req.param('id'));
      assertRealAccess(envOf());
      const existing = await getBiliAccount(db, id);
      if (!existing) {
        throw new BiliAccountStoreError('not_found', '账号不存在', 404);
      }
      if (existing.status === 'revoked') {
        throw new BiliAccountStoreError('revoked', '账号已撤销，无法校验', 409);
      }
      if (!existing.secretPresent) {
        throw new BiliAccountStoreError('missing_secret', '账号缺少凭据，无法校验', 409);
      }
      const key = requireSecretKey(envOf());
      const secret = await readBiliAccountSecret(db, id);
      if (!secret) {
        throw new BiliAccountStoreError('missing_secret', '账号缺少凭据，无法校验', 409);
      }
      const payload: EncryptedCookie = {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        authTag: secret.authTag,
        keyVersion: secret.keyVersion,
      };
      const jar = decryptCookieJar(payload, key);
      const cookie = cookieHeader(jar);
      const transport =
        options.transport ?? createLiveBilibiliTransport(10_000);
      let response;
      try {
        response = await transport({
          url: NAV_URL,
          method: 'GET',
          headers: bilibiliHeaders(cookie),
        });
      } catch (err) {
        const message = scrubSensitive(err instanceof Error ? err.message : '网络错误');
        contextLogger(c)?.warn('bili account verify network error', {
          event: 'accounts.verify',
          context: { accountId: id, action: 'verify', errorKind: 'network' },
        });
        throw new BiliAccountStoreError('network_error', `校验失败：网络错误（${message}）`, 409);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body) as unknown;
      } catch {
        throw new BiliAccountStoreError('network_error', '校验失败：nav 响应不是 JSON', 409);
      }
      const biz = readBizCode(parsed);
      if (biz.code === -101) {
        await markBiliAccountVerifyFailed(db, id, 'expired');
        contextLogger(c)?.info('bili account verify expired', {
          event: 'accounts.verify',
          context: { accountId: id, action: 'verify', errorKind: 'not_login' },
        });
        throw new BiliAccountStoreError('not_login', '校验失败：未登录（-101）', 409);
      }
      if (biz.code === -352 || biz.code === -412) {
        contextLogger(c)?.info('bili account verify risk', {
          event: 'accounts.verify',
          context: { accountId: id, action: 'verify', errorKind: 'risk_control' },
        });
        throw new BiliAccountStoreError('risk_control', `校验失败：风控（${biz.code}）`, 409);
      }
      if (biz.code !== 0 && biz.code !== null) {
        throw new BiliAccountStoreError(
          'verify_failed',
          `校验失败：业务码 ${biz.code}`,
          409,
        );
      }
      const nav = parseNav(parsed);
      if (!nav.isLogin) {
        await markBiliAccountVerifyFailed(db, id, 'expired');
        throw new BiliAccountStoreError('not_login', '校验失败：未登录', 409);
      }
      const account = await markBiliAccountVerified(db, {
        id,
        mid: nav.mid,
        uname: nav.uname,
        avatarUrl: nav.face,
        status: 'active',
      });
      contextLogger(c)?.info('bili account verified', {
        event: 'accounts.verify',
        context: { accountId: id, action: 'verify' },
      });
      return c.json({ account: toListItem(account, nowOf()), verified: true as const });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.delete('/:id', async (c) => {
    try {
      const id = assertAccountId(c.req.param('id'));
      const result = await revokeBiliAccount(db, id);
      contextLogger(c)?.info('bili account revoked', {
        event: 'accounts.revoke',
        context: { accountId: id, action: 'revoke' },
      });
      const message = result.noDefaultRemaining
        ? '账号已撤销并删除凭据；当前没有默认采集账号'
        : '账号已撤销并删除凭据';
      return c.json({
        account: toListItem(result.account, nowOf()),
        noDefaultRemaining: result.noDefaultRemaining,
        message,
      });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  return app;
}
