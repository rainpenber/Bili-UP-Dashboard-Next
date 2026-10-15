import { createSql } from './client';
import { postgresAvailable } from './postgres-available';

/** In CI or when REQUIRE_POSTGRES=1, fail fast if PostgreSQL is not reachable. */
export async function requirePostgres(): Promise<ReturnType<typeof createSql>> {
  const required = Boolean(process.env.CI || process.env.REQUIRE_POSTGRES === '1');
  if (!required) {
    throw new Error(
      'requirePostgres() called outside CI/REQUIRE_POSTGRES — use postgresAvailable()',
    );
  }
  const sql = createSql();
  try {
    await sql`SELECT 1 AS ok`;
    return sql;
  } catch (err) {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    throw Object.assign(
      new Error(
        `PostgreSQL required but unavailable: ${err instanceof Error ? err.message : String(err)}`,
      ),
      { status: 503 },
    );
  }
}

export function isPostgresRequiredEnv(): boolean {
  return Boolean(process.env.CI || process.env.REQUIRE_POSTGRES === '1');
}

/** Integration tests: require Postgres in CI; optional skip locally when DB is down. */
export async function integrationTestSql(): Promise<ReturnType<typeof createSql> | null> {
  if (isPostgresRequiredEnv()) {
    return requirePostgres();
  }
  if (!(await postgresAvailable())) return null;
  return createSql();
}

export function assertIntegrationSql(
  sql: ReturnType<typeof createSql> | null,
): asserts sql is ReturnType<typeof createSql> {
  if (!sql) {
    if (isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but integrationTestSql returned null');
    }
    throw new Error('skip: postgres unavailable');
  }
}
