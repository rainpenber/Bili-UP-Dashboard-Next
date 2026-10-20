import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');
const deployCompose = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');
const devPostgresExample = readFileSync(
  join(repoRoot, 'docker-compose.dev-postgres.example.yml'),
  'utf8',
);
const legacySyncOverlay = readFileSync(join(repoRoot, 'docker-compose.legacy-sync.yml'), 'utf8');

function serviceBlock(yaml: string, service: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line === 'volumes:') break;
    if (/^ {2}[a-zA-Z0-9_-]+:/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

function topLevelServices(yaml: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === 'services:');
  if (start === -1) return [];
  const names: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line === 'volumes:') break;
    const m = line.match(/^ {2}([a-z0-9_-]+):$/);
    if (m) names.push(m[1] ?? '');
  }
  return names;
}

describe('deploy docker-compose isolation', () => {
  test('production compose defines postgres, app, and collector', () => {
    expect(topLevelServices(deployCompose).sort()).toEqual(['app', 'collector', 'postgres']);
    expect(deployCompose).not.toMatch(/^\s+api:/m);
    expect(deployCompose).not.toMatch(/^\s+web:/m);
    expect(deployCompose).not.toMatch(/^\s+mock-import:/m);
  });

  test('postgres is not published to the host in default compose', () => {
    const postgres = serviceBlock(deployCompose, 'postgres');
    expect(postgres).not.toMatch(/^\s+ports:/m);
    expect(deployCompose).not.toContain('container_name:');
    expect(deployCompose).not.toMatch(/^\s+networks:/m);
  });

  test('app connects to postgres via internal service DNS and one host port', () => {
    const app = serviceBlock(deployCompose, 'app');
    expect(app).toContain('POSTGRES_HOST: postgres');
    expect(app).toContain('POSTGRES_PORT: 5432');
    expect(app).toContain('${APP_PORT:-8080}:3000');
    expect((app.match(/^\s+- '\$\{APP_PORT:-8080\}:3000'/gm) ?? []).length).toBe(1);
  });

  test('production app uses immutable image build without source or node_modules bind mounts', () => {
    const app = serviceBlock(deployCompose, 'app');
    expect(app).toMatch(/^\s+build:/m);
    expect(app).toContain('dockerfile: Dockerfile');
    expect(app).not.toContain('./:/app');
    expect(app).not.toContain('node_modules');
    expect(deployCompose).not.toContain('nginx');
  });

  test('collector is an internal offline worker without a host port', () => {
    const collector = serviceBlock(deployCompose, 'collector');
    expect(collector).toContain('POSTGRES_HOST: postgres');
    expect(collector).toContain('MONITOR_DATA_SOURCE: collector');
    expect(collector).toContain('MONITOR_PROVIDER: ${COLLECTOR_PROVIDER:-offline}');
    expect(collector).toContain('apps/collector/src/index.ts');
    expect(collector).toContain('/mock-data:ro');
    expect(collector).not.toMatch(/^\s+ports:/m);
    expect(collector).not.toContain('bilibili.com');
    expect(collector).toContain('disable: true');
  });

  test('app depends on healthy postgres', () => {
    expect(deployCompose).toContain('condition: service_healthy');
  });

  test('postgres uses a named volume for data', () => {
    expect(deployCompose).toMatch(/^\s+postgres_data:/m);
    const postgres = serviceBlock(deployCompose, 'postgres');
    expect(postgres).toContain('postgres_data:/var/lib/postgresql/data');
  });

  test('legacy csv sync stays out of the default compose file', () => {
    expect(deployCompose).not.toContain('legacy-sync');
    expect(deployCompose).not.toContain('sync-legacy');
    expect(legacySyncOverlay).toContain('sync-legacy');
    expect(legacySyncOverlay).toContain('/legacy-csv:ro');
    expect(legacySyncOverlay).toContain('disable: true');
    expect(legacySyncOverlay).not.toMatch(/ssh|SMB|SESSDATA/i);
    expect(topLevelServices(legacySyncOverlay)).toEqual(['legacy-sync']);
  });

  test('dev postgres example binds loopback only', () => {
    expect(devPostgresExample).toContain('127.0.0.1:');
    expect(devPostgresExample).not.toMatch(/0\.0\.0\.0:\$\{/);
  });
});
