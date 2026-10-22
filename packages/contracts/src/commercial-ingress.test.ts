import { describe, expect, test } from 'bun:test';
import {
  COMMERCIAL_INGRESS_BATCH_MAX,
  parseCommercialIngressBatchRequest,
  parseCommercialIngressError,
  parseCommercialIngressUpsertRequest,
  parseCommercialIngressUpsertResponse,
  parseCommercialSourceLookupResponse,
} from './commercial-ingress';

const ITEM = {
  sourceKey: { namespace: 'hermes.fixture', sourceId: 'proj-001' },
  originKind: 'fixture',
  sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
  name: '受控样例接入',
  netAmount: '1000.50',
  rebateAmount: null,
  sourceStatus: '跟进中',
  sourceNotes: '不推断节点',
  payload: { title: '受控样例接入', tags: ['fixture'] },
  evidence: { kind: 'fixture', ref: 'proj-001' },
};

describe('commercial ingress contracts', () => {
  test('parses upsert and dry-run flags', () => {
    const parsed = parseCommercialIngressUpsertRequest({ item: ITEM, dryRun: true });
    expect(parsed.dryRun).toBe(true);
    expect(parsed.item.netAmount).toBe('1000.50');
    expect(parsed.item.rebateAmount).toBeNull();
    expect(parsed.item.payload).toEqual({ title: '受控样例接入', tags: ['fixture'] });
  });

  test('rejects stringified payload and numeric money', () => {
    expect(() =>
      parseCommercialIngressUpsertRequest({
        item: { ...ITEM, payload: JSON.stringify(ITEM.payload) },
      }),
    ).toThrow(/payload/);
    expect(() =>
      parseCommercialIngressUpsertRequest({ item: { ...ITEM, netAmount: 1000 } }),
    ).toThrow(/netAmount/);
  });

  test('rejects oversized batches and duplicate-key detection stays for the service', () => {
    expect(() => parseCommercialIngressBatchRequest({ items: [] })).toThrow(/empty/);
    const tooMany = Array.from({ length: COMMERCIAL_INGRESS_BATCH_MAX + 1 }, (_, i) => ({
      ...ITEM,
      sourceKey: { namespace: 'hermes.fixture', sourceId: `proj-${i}` },
    }));
    expect(() => parseCommercialIngressBatchRequest({ items: tooMany })).toThrow(/100/);
  });

  test('parses upsert response and lookup snapshot', () => {
    const response = parseCommercialIngressUpsertResponse({
      result: {
        sourceKey: ITEM.sourceKey,
        outcome: 'created',
        projectId: 'a1000001-0001-4001-8001-000000000001',
        workflowId: 'a2000001-0001-4001-8001-000000000001',
        projectUpdatedAt: '2026-10-01T00:00:00.000Z',
        contentHash: 'abc',
        dryRun: false,
      },
    });
    expect(response.result.outcome).toBe('created');

    const lookup = parseCommercialSourceLookupResponse({
      projectId: 'a1000001-0001-4001-8001-000000000001',
      projectUpdatedAt: '2026-10-01T00:00:00.000Z',
      originKind: 'fixture',
      source: {
        namespace: 'hermes.fixture',
        sourceId: 'proj-001',
        originKind: 'fixture',
        sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
        importedAt: '2026-10-01T01:00:00.000Z',
        contentHash: 'abc',
        sourceStatus: '跟进中',
        sourceNotes: null,
        payload: { title: 'x' },
        evidence: {},
      },
    });
    expect(lookup.source.payload).toEqual({ title: 'x' });
  });

  test('parses typed ingress errors', () => {
    expect(
      parseCommercialIngressError({
        error: '旧源版本不得覆盖',
        code: 'stale_source_version',
        sourceKeys: [ITEM.sourceKey],
      }).code,
    ).toBe('stale_source_version');
  });
});
