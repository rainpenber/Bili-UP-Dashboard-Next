import { describe, expect, test } from 'bun:test';
import { parsePartitionSeed, realPartitionName } from './partitions';
import { partitionSeedFileFromArgv } from './seed-partitions';

describe('partition seed file', () => {
  test('drops placeholder names and accepts either file shape', () => {
    expect(realPartitionName('  ')).toBeNull();
    expect(realPartitionName('其它')).toBeNull();
    const rows = parsePartitionSeed({
      partitions: [{ tid: 2102, parent_tid: 95, name: '未知', source: 'manual' }],
    });
    expect(rows).toEqual([{ tid: 2102, parentTid: 95, name: null, source: 'manual' }]);
    expect(parsePartitionSeed([{ tid: '95', name: '动画' }])[0]).toEqual({
      tid: 95,
      parentTid: null,
      name: '动画',
      source: 'manual',
    });
  });

  test('reads --file and does not look like a network fetch', () => {
    expect(partitionSeedFileFromArgv(['--file', 'partitions.json'])).toBe('partitions.json');
    expect(() => partitionSeedFileFromArgv([])).toThrow(/--file/);
  });
});
