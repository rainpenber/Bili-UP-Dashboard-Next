import type postgres from 'postgres';
import type { Sql } from './client';
import type { BiliAccountStatus, EncryptedSecretRow } from './real-collector';

type Queryable = postgres.Sql | postgres.TransactionSql;

export class BiliAccountStoreError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 500;

  constructor(code: string, message: string, status: 400 | 404 | 409 | 500 = 400) {
    super(message);
    this.name = 'BiliAccountStoreError';
    this.code = code;
    this.status = status;
  }
}

export type BiliAccountRecord = {
  id: string;
  mid: string | null;
  uname: string | null;
  status: BiliAccountStatus;
  isDefault: boolean;
  cookieExpiresAt: Date | null;
  lastVerifiedAt: Date | null;
  lastUsedAt: Date | null;
  note: string;
  revokedAt: Date | null;
  secretPresent: boolean;
};

type AccountRow = {
  id: string;
  mid: string | null;
  uname: string | null;
  status: BiliAccountStatus;
  is_default: boolean;
  cookie_expires_at: Date | null;
  last_verified_at: Date | null;
  last_used_at: Date | null;
  note: string;
  revoked_at: Date | null;
  secret_present: boolean;
};

function mapRow(row: AccountRow): BiliAccountRecord {
  return {
    id: row.id,
    mid: row.mid,
    uname: row.uname,
    status: row.status,
    isDefault: row.is_default,
    cookieExpiresAt: row.cookie_expires_at,
    lastVerifiedAt: row.last_verified_at,
    lastUsedAt: row.last_used_at,
    note: row.note,
    revokedAt: row.revoked_at,
    secretPresent: row.secret_present,
  };
}

async function loadAccount(sql: Queryable, id: string): Promise<BiliAccountRecord | null> {
  const rows = await sql<AccountRow[]>`
    SELECT
      a.id::text AS id,
      a.mid::text AS mid,
      a.uname,
      a.status,
      a.is_default,
      a.cookie_expires_at,
      a.last_verified_at,
      a.last_used_at,
      a.note,
      a.revoked_at,
      (s.account_id IS NOT NULL) AS secret_present
    FROM bili_accounts a
    LEFT JOIN bili_account_secrets s ON s.account_id = a.id
    WHERE a.id = ${id}::uuid
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listBiliAccounts(sql: Queryable): Promise<BiliAccountRecord[]> {
  const rows = await sql<AccountRow[]>`
    SELECT
      a.id::text AS id,
      a.mid::text AS mid,
      a.uname,
      a.status,
      a.is_default,
      a.cookie_expires_at,
      a.last_verified_at,
      a.last_used_at,
      a.note,
      a.revoked_at,
      (s.account_id IS NOT NULL) AS secret_present
    FROM bili_accounts a
    LEFT JOIN bili_account_secrets s ON s.account_id = a.id
    ORDER BY a.is_default DESC, a.created_at ASC
  `;
  return rows.map(mapRow);
}

export async function getBiliAccount(
  sql: Queryable,
  id: string,
): Promise<BiliAccountRecord | null> {
  return loadAccount(sql, id);
}

export async function createBiliAccount(
  sql: Sql,
  input: {
    id: string;
    mid: string;
    uname: string | null;
    note: string;
    cookieExpiresAt: Date | null;
    secret: EncryptedSecretRow;
    replace: boolean;
  },
): Promise<BiliAccountRecord> {
  return sql.begin(async (tx) => {
    const existing = await tx<{ id: string; status: string }[]>`
      SELECT id::text AS id, status FROM bili_accounts WHERE mid = ${input.mid}::bigint
    `;
    if (existing[0] && !input.replace) {
      throw new BiliAccountStoreError(
        'mid_conflict',
        `mid ${input.mid} 已存在；若要覆盖请显式设置 replace:true`,
        409,
      );
    }
    const accountId = existing[0]?.id ?? input.id;
    if (existing[0]) {
      await tx`
        UPDATE bili_accounts
        SET uname = ${input.uname},
            status = 'active',
            note = ${input.note},
            cookie_expires_at = ${input.cookieExpiresAt},
            revoked_at = NULL,
            last_verified_at = NULL,
            updated_at = statement_timestamp()
        WHERE id = ${accountId}::uuid
      `;
    } else {
      const defaults = await tx<{ id: string }[]>`
        SELECT id::text AS id
        FROM bili_accounts
        WHERE is_default = true AND status = 'active'
        LIMIT 1
      `;
      const makeDefault = !defaults[0];
      await tx`
        INSERT INTO bili_accounts (
          id, mid, uname, status, is_default, cookie_expires_at, note
        ) VALUES (
          ${accountId}::uuid,
          ${input.mid}::bigint,
          ${input.uname},
          'active',
          ${makeDefault},
          ${input.cookieExpiresAt},
          ${input.note}
        )
      `;
    }
    await tx`
      INSERT INTO bili_account_secrets (account_id, ciphertext, iv, auth_tag, key_version)
      VALUES (
        ${accountId}::uuid,
        ${input.secret.ciphertext},
        ${input.secret.iv},
        ${input.secret.authTag},
        ${input.secret.keyVersion}
      )
      ON CONFLICT (account_id) DO UPDATE SET
        ciphertext = EXCLUDED.ciphertext,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        key_version = EXCLUDED.key_version,
        updated_at = statement_timestamp()
    `;
    const row = await loadAccount(tx, accountId);
    if (!row) throw new BiliAccountStoreError('internal', '账号写入后无法读取', 500);
    return row;
  });
}

export async function patchBiliAccount(
  sql: Sql,
  id: string,
  input: { note?: string; isDefault?: boolean },
): Promise<BiliAccountRecord> {
  return sql.begin(async (tx) => {
    const existing = await loadAccount(tx, id);
    if (!existing) {
      throw new BiliAccountStoreError('not_found', '账号不存在', 404);
    }
    if (input.isDefault === true) {
      if (existing.status !== 'active') {
        throw new BiliAccountStoreError('invalid_default', '只有 active 账号可以设为默认', 409);
      }
      await tx`
        UPDATE bili_accounts
        SET is_default = false, updated_at = statement_timestamp()
        WHERE is_default = true AND id <> ${id}::uuid
      `;
      if (input.note !== undefined) {
        await tx`
          UPDATE bili_accounts
          SET is_default = true,
              note = ${input.note},
              updated_at = statement_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        await tx`
          UPDATE bili_accounts
          SET is_default = true, updated_at = statement_timestamp()
          WHERE id = ${id}::uuid
        `;
      }
    } else if (input.isDefault === false) {
      if (input.note !== undefined) {
        await tx`
          UPDATE bili_accounts
          SET is_default = false,
              note = ${input.note},
              updated_at = statement_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        await tx`
          UPDATE bili_accounts
          SET is_default = false, updated_at = statement_timestamp()
          WHERE id = ${id}::uuid
        `;
      }
    } else if (input.note !== undefined) {
      await tx`
        UPDATE bili_accounts
        SET note = ${input.note}, updated_at = statement_timestamp()
        WHERE id = ${id}::uuid
      `;
    }
    const row = await loadAccount(tx, id);
    if (!row) throw new BiliAccountStoreError('not_found', '账号不存在', 404);
    return row;
  });
}

export async function revokeBiliAccount(
  sql: Sql,
  id: string,
): Promise<{ account: BiliAccountRecord; noDefaultRemaining: boolean }> {
  return sql.begin(async (tx) => {
    const existing = await loadAccount(tx, id);
    if (!existing) {
      throw new BiliAccountStoreError('not_found', '账号不存在', 404);
    }
    if (existing.status === 'revoked') {
      const defaults = await tx<{ c: string }[]>`
        SELECT count(*)::text AS c
        FROM bili_accounts
        WHERE is_default = true AND status = 'active'
      `;
      return {
        account: existing,
        noDefaultRemaining: Number(defaults[0]?.c ?? '0') === 0,
      };
    }
    await tx`DELETE FROM bili_account_secrets WHERE account_id = ${id}::uuid`;
    await tx`
      UPDATE bili_accounts
      SET status = 'revoked',
          is_default = false,
          revoked_at = statement_timestamp(),
          updated_at = statement_timestamp()
      WHERE id = ${id}::uuid
    `;
    const row = await loadAccount(tx, id);
    if (!row) throw new BiliAccountStoreError('not_found', '账号不存在', 404);
    const defaults = await tx<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM bili_accounts
      WHERE is_default = true AND status = 'active'
    `;
    return {
      account: row,
      noDefaultRemaining: Number(defaults[0]?.c ?? '0') === 0,
    };
  });
}

export async function markBiliAccountVerified(
  sql: Sql,
  input: {
    id: string;
    mid: string;
    uname: string;
    avatarUrl: string | null;
    status?: 'active' | 'expired';
  },
): Promise<BiliAccountRecord> {
  await sql`
    UPDATE bili_accounts
    SET mid = ${input.mid}::bigint,
        uname = ${input.uname},
        avatar_url = ${input.avatarUrl},
        status = ${input.status ?? 'active'},
        last_verified_at = statement_timestamp(),
        updated_at = statement_timestamp()
    WHERE id = ${input.id}::uuid
  `;
  const row = await loadAccount(sql, input.id);
  if (!row) throw new BiliAccountStoreError('not_found', '账号不存在', 404);
  return row;
}

export async function markBiliAccountVerifyFailed(
  sql: Sql,
  id: string,
  status: 'expired' | 'blocked' | 'active',
): Promise<BiliAccountRecord> {
  await sql`
    UPDATE bili_accounts
    SET status = ${status},
        last_verified_at = statement_timestamp(),
        updated_at = statement_timestamp()
    WHERE id = ${id}::uuid
  `;
  const row = await loadAccount(sql, id);
  if (!row) throw new BiliAccountStoreError('not_found', '账号不存在', 404);
  return row;
}
