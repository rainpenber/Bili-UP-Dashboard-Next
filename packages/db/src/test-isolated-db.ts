import { readDbConfigFromEnv } from './config';
import { createSql } from './client';
import { runMigrations } from './migrate';
import { isPostgresRequiredEnv } from './require-postgres';
import { postgresAvailable } from './postgres-available';

export type IsolatedTestDb = {
  sql: ReturnType<typeof createSql>;
  databaseName: string;
};

/** Create a dedicated database for one test file (CI-safe; fails if CREATE DATABASE denied in CI). */
async function provisionEmptyDatabase(): Promise<IsolatedTestDb> {
  const cfg = readDbConfigFromEnv();
  const admin = createSql();
  const databaseName = `studio_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  } catch (err) {
    await admin.end({ timeout: 5 });
    const message = `Isolated test database CREATE DATABASE failed: ${err instanceof Error ? err.message : String(err)}`;
    throw Object.assign(new Error(message), { cause: err });
  }
  await admin.end({ timeout: 5 });
  const sql = createSql({ ...cfg, database: databaseName });
  return { sql, databaseName };
}

/** Empty isolated DB (no migrations). Use for legacy upgrade tests. */
export async function createEmptyIsolatedTestDatabase(): Promise<IsolatedTestDb | null> {
  if (!(await postgresAvailable())) {
    if (isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but unavailable');
    }
    return null;
  }
  try {
    return await provisionEmptyDatabase();
  } catch (err) {
    if (isPostgresRequiredEnv()) throw err;
    return null;
  }
}

/** Isolated DB with all migrations applied (fixture / API integration suites). */
export async function createIsolatedTestDatabase(): Promise<IsolatedTestDb | null> {
  if (!(await postgresAvailable())) {
    if (isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but unavailable');
    }
    return null;
  }
  let isolated: IsolatedTestDb | undefined;
  try {
    isolated = await provisionEmptyDatabase();
    await runMigrations(isolated.sql);
    return isolated;
  } catch (err) {
    if (isolated) {
      await isolated.sql.end({ timeout: 5 }).catch(() => undefined);
      await dropIsolatedTestDatabase(isolated.databaseName).catch(() => undefined);
    }
    if (isPostgresRequiredEnv()) throw err;
    return null;
  }
}

export async function dropIsolatedTestDatabase(databaseName: string): Promise<void> {
  const admin = createSql();
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}
