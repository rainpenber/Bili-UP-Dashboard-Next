import { describe, expect, test } from 'bun:test';
import { parseMetadataRunResponse, parseVideoRefreshResponse } from './metadata-refresh';

describe('metadata refresh contracts', () => {
  test('parses a video refresh body and a backfill run', () => {
    expect(
      parseVideoRefreshResponse({
        bvid: 'BV1xx411c7mD',
        cid: '123',
        title: '标题',
        tags: ['测评'],
        metadataState: 'ok',
        coverState: 'failed',
      }).tags,
    ).toEqual(['测评']);
    expect(
      parseMetadataRunResponse({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'aborted',
        requested: 3,
        succeeded: 1,
        failed: 1,
        skipped: 0,
        report: { abortedBizCode: -352 },
      }).status,
    ).toBe('aborted');
  });

  test('rejects a fabricated metadata state', () => {
    expect(() =>
      parseVideoRefreshResponse({
        bvid: 'BV1xx411c7mD',
        cid: null,
        title: null,
        tags: [],
        metadataState: 'done',
        coverState: 'ok',
      }),
    ).toThrow(/metadataState/);
  });
});
