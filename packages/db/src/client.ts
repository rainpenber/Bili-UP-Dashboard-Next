import postgres from 'postgres';
import { buildConnectionString, readDbConfigFromEnv, type DbConfig } from './config';

export type Sql = ReturnType<typeof postgres>;

export function createSql(config?: DbConfig, max = 10): Sql {
  const resolved = config ?? readDbConfigFromEnv();
  return postgres(buildConnectionString(resolved), {
    max,
    prepare: false,
  });
}
