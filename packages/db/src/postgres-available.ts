import { createSql } from './client';

let cached: boolean | null = null;

/** True when Postgres is configured and accepts a connection (CI service or local .env). */
export async function postgresAvailable(): Promise<boolean> {
  if (!(process.env.CI || process.env.POSTGRES_PASSWORD)) return false;
  if (cached !== null) return cached;
  const sql = createSql();
  try {
    await sql`SELECT 1`;
    cached = true;
    return true;
  } catch {
    cached = false;
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
