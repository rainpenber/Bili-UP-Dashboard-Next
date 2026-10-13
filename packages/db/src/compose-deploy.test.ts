import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');
const deployCompose = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');
const devPostgresExample = readFileSync(
  join(repoRoot, 'docker-compose.dev-postgres.example.yml'),
  'utf8',
);

function serviceBlock(yaml: string, service: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line === 'volumes:') break;
    if (/^  [a-zA-Z0-9_-]+:/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

describe('deploy docker-compose isolation', () => {
  test('postgres is not published to the host in default compose', () => {
    const postgres = serviceBlock(deployCompose, 'postgres');
    expect(postgres).not.toMatch(/^\s+ports:/m);
    expect(deployCompose).not.toContain('container_name:');
  });

  test('api connects to postgres via internal service DNS', () => {
    const api = serviceBlock(deployCompose, 'api');
    expect(api).toContain('POSTGRES_HOST: postgres');
    expect(api).toContain('POSTGRES_PORT: 5432');
  });

  test('postgres uses a named volume for data', () => {
    expect(deployCompose).toMatch(/^\s+postgres_data:/m);
    const postgres = serviceBlock(deployCompose, 'postgres');
    expect(postgres).toContain('postgres_data:/var/lib/postgresql/data');
  });

  test('dev postgres example binds loopback only', () => {
    expect(devPostgresExample).toContain('127.0.0.1:');
    expect(devPostgresExample).not.toMatch(/0\.0\.0\.0:\$\{/);
  });
});
