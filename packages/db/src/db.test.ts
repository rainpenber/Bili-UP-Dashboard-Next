import { describe, expect, test } from 'bun:test';
import { buildConnectionString, readDbConfigFromEnv } from './config';

describe('db config', () => {
  test('builds connection string', () => {
    const cfg = readDbConfigFromEnv({
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'studio',
      POSTGRES_USER: 'u',
      POSTGRES_PASSWORD: 'p',
    });
    expect(buildConnectionString(cfg)).toContain('postgres://');
  });
});
