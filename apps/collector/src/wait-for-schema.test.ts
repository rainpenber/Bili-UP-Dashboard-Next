import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitForReady } from './wait-for-schema';
import { parseCollectorCli } from './cli';

describe('collector schema wait', () => {
  test('retries until the probe succeeds', async () => {
    let checks = 0;
    const sleeps: number[] = [];
    await waitForReady(
      async () => {
        checks += 1;
        return checks === 3;
      },
      {
        attempts: 5,
        delayMs: 25,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(checks).toBe(3);
    expect(sleeps).toEqual([25, 25]);
  });

  test('fails closed when the schema never appears', async () => {
    await expect(
      waitForReady(async () => false, {
        attempts: 2,
        delayMs: 1,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/不会自行建表/);
  });
});

describe('collector process boundaries', () => {
  test('the worker does not run migrations', () => {
    const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');
    expect(source).not.toContain('runMigrations');
    expect(source).toContain('waitForReady');
    expect(source).toContain('readCollectorProviderKind');
    expect(source).toContain("providerKind === 'offline'");
  });

  test('cli parses login and legacy import', () => {
    expect(parseCollectorCli(['login', '--qr'])).toEqual({
      command: 'login',
      pngPath: 'bilibili-login-qr.png',
    });
    expect(parseCollectorCli(['login', '--qr', '--png', 'out.png'])).toEqual({
      command: 'login',
      pngPath: 'out.png',
    });
    expect(parseCollectorCli(['import-legacy', '--dir', '/legacy-csv'])).toEqual({
      command: 'import-legacy',
      dir: '/legacy-csv',
    });
    expect(() => parseCollectorCli(['login'])).toThrow(/--qr/);
    expect(() => parseCollectorCli(['import-legacy'])).toThrow(/--dir/);
  });
});
