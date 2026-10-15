import { createSql } from './client';
import { countCommercialFixtureRows, seedCommercialFixtures } from './commercial-fixtures';
import { runMigrations } from './migrate';

const sql = createSql();
try {
  const appliedMigrations = await runMigrations(sql);
  await seedCommercialFixtures(sql);
  const counts = await countCommercialFixtureRows(sql);
  console.log(JSON.stringify({ appliedMigrations, counts }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
