export type DbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export function readDbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = Number(env.POSTGRES_PORT ?? 5432);
  const database = env.POSTGRES_DB ?? 'studio_dev';
  const user = env.POSTGRES_USER ?? 'studio_dev';
  const password = env.POSTGRES_PASSWORD ?? '';
  return { host, port, database, user, password };
}

export function buildConnectionString(config: DbConfig): string {
  const encodedUser = encodeURIComponent(config.user);
  const encodedPassword = encodeURIComponent(config.password);
  return `postgres://${encodedUser}:${encodedPassword}@${config.host}:${config.port}/${config.database}`;
}
