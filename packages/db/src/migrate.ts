import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql } from './client';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const MIGRATION_LOCK_KEY = 915_001;

export async function runMigrations(sql = createSql()): Promise<string[]> {
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    const applied: string[] = [];
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const existing = await sql<{ version: string }[]>`
        SELECT version FROM schema_migrations WHERE version = ${version}
      `;
      if (existing.length > 0) {
        continue;
      }
      const body = readFileSync(join(migrationsDir, file), 'utf8');
      await sql.unsafe(body);
      await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
      applied.push(version);
    }
    return applied;
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
}

if (import.meta.main) {
  const sql = createSql();
  try {
    const applied = await runMigrations(sql);
    console.log(
      applied.length > 0 ? `Applied migrations: ${applied.join(', ')}` : 'No pending migrations',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
