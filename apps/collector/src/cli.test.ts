import { describe, expect, test } from 'bun:test';
import { parseCollectorCli } from './cli';

describe('collector cli', () => {
  test('parses webui import and metadata fetch flags', () => {
    expect(parseCollectorCli(['import-webui', '--root', '/tmp/meta'])).toEqual({
      command: 'import-webui',
      root: '/tmp/meta',
      dryRun: false,
    });
    const dryImport = parseCollectorCli(['import-webui', '--root', '/tmp/meta', '--dry-run']);
    expect(dryImport.command === 'import-webui' && dryImport.dryRun).toBe(true);
    const dry = parseCollectorCli([
      'fetch',
      'metadata',
      '--kind',
      'video',
      '--bvid',
      'BV1xx411c7mD',
    ]);
    expect(dry).toMatchObject({
      command: 'fetch-metadata',
      kind: 'video',
      bvid: 'BV1xx411c7mD',
      dryRun: true,
      force: false,
    });
    const live = parseCollectorCli([
      'fetch',
      'metadata',
      '--kind',
      'creator',
      '--all-missing',
      '--limit',
      '5',
      '--force',
      '--execute',
    ]);
    expect(live).toMatchObject({
      command: 'fetch-metadata',
      kind: 'creator',
      allMissing: true,
      limit: 5,
      force: true,
      dryRun: false,
    });
    expect(() =>
      parseCollectorCli(['fetch', 'metadata', '--kind', 'video', '--bvid', 'BV1', '--dir', '/tmp']),
    ).toThrow(/只能指定/);
  });
});
