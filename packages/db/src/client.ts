import postgres from 'postgres';
import { buildConnectionString, readDbConfigFromEnv, type DbConfig } from './config';

export type Sql = ReturnType<typeof postgres>;

export function createSql(config?: DbConfig): Sql {
  const resolved = config ?? readDbConfigFromEnv();
  return postgres(buildConnectionString(resolved), {
    max: 10,
    prepare: false,
  });
}
