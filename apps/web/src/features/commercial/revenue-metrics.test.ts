import { describe, expect, test } from 'bun:test';
import type { CommercialProjectDetail, CommercialRebate } from '@studio/contracts';
import { matchRebateForProject, revenueMonthMetrics } from './revenue-metrics';

function project(overrides: Record<string, unknown>): CommercialProjectDetail {
  return {
    id: 'f0010001-0001-4001-8001-000000000001',
    name: '样例',
    netAmount: null,
    rebateAmount: null,
    platformAmount: null,
    agreedRebateRate: null,
    actualRebateRate: null,
    amountGap: null,
    amountRationale: null,
    amountEvidence: [],
    overallStage: 'pre_publish',
    phase: 'pending',
    currentStageNames: [],
    anyNodeBlocked: false,
    blockingReason: null,
    createdAt: '2026-11-01T00:00:00.000000Z',
    updatedAt: '2026-11-01T00:00:00.000000Z',
    userDeadlineAt: null,
    blockedSinceAt: null,
    archivedAt: null,
    stageEnteredAt: '2026-11-01T00:00:00.000000Z',
    businessClosedAt: null,
    originKind: 'fixture',
    source: null,
    businessState: null,
    originStatusLabel: null,
    sourceWindow: null,
    blockedNodeNames: [],
    openItems: [],
    publish: {
      published: false,
      platform: 'bilibili',
      bvid: null,
      publishedAt: null,
      publishSource: null,
      idempotencyKey: null,
      contentKind: 'video',
      contentUrl: null,
      externalId: null,
    },
    ...overrides,
  } as CommercialProjectDetail;
}

const NOW = new Date('2026-11-23T04:00:00.000Z');

describe('revenue month metrics', () => {
  test('uses publish month and falls back to createdAt', () => {
    const metrics = revenueMonthMetrics(
      [
        project({
          platformAmount: '39000.00',
          rebateAmount: '10920.00',
          netAmount: '28080.00',
          publish: {
            published: true,
            platform: 'bilibili',
            bvid: 'BV1',
            publishedAt: '2026-11-11T10:00:00.000Z',
            publishSource: 'web',
            idempotencyKey: 'k',
            contentKind: 'video',
            contentUrl: null,
            externalId: null,
          },
        }),
        project({
          platformAmount: '100.00',
          rebateAmount: '10.00',
          netAmount: '90.00',
          createdAt: '2026-11-20T00:00:00.000000Z',
        }),
        project({ createdAt: '2026-10-31T00:00:00.000000Z' }),
      ],
      NOW,
    );
    expect(metrics).toEqual({
      count: 2,
      platformTotal: '39100.00',
      rebateTotal: '10930.00',
      netTotal: '28170.00',
    });
  });

  test('treats a UTC previous-month instant as the Shanghai publish month', () => {
    const metrics = revenueMonthMetrics(
      [
        project({
          publish: {
            published: true,
            platform: 'bilibili',
            bvid: 'BV1',
            publishedAt: '2026-10-31T17:00:00.000Z',
            publishSource: 'web',
            idempotencyKey: 'k',
            contentKind: 'video',
            contentUrl: null,
            externalId: null,
          },
        }),
      ],
      NOW,
    );
    expect(metrics.count).toBe(1);
  });
});

function rebate(overrides: Partial<CommercialRebate>): CommercialRebate {
  return {
    id: 'c0b00009-0000-4000-8000-000000000009',
    projectId: null,
    projectName: '大疆 Pocket4',
    counterparty: null,
    expectedAmount: '5320.00',
    isReturned: false,
    returnedAt: null,
    contractState: 'signed',
    invoiceState: 'none',
    note: null,
    evidence: [],
    stageSince: '2026-11-23T00:00:00.000000Z',
    createdAt: '2026-11-23T00:00:00.000000Z',
    updatedAt: '2026-11-23T00:00:00.000000Z',
    platformPaid: false,
    daysInStage: 0,
    ...overrides,
  };
}

describe('rebate project matching', () => {
  test('linked rows win over name matches', () => {
    const linked = rebate({ projectId: 'p-linked', projectName: '其他名字' });
    const historical = rebate({ projectName: '大疆 Pocket4' });
    expect(matchRebateForProject([historical, linked], 'p-linked', '大疆 Pocket4')).toBe(linked);
  });

  test('matches historical rows by normalized name and prefix', () => {
    const pocket = rebate({ projectName: '大疆 Pocket4' });
    expect(matchRebateForProject([pocket], 'p1', '大疆 Pocket4 寄拍')).toBe(pocket);
    expect(matchRebateForProject([pocket], 'p1', 'PLAUD AI 录音笔')).toBeNull();
  });

  test('prefers an exact normalized name over a prefix', () => {
    const exact = rebate({ id: 'exact', projectName: '海信E8S_2026' });
    const prefix = rebate({ id: 'prefix', projectName: '海信E8S' });
    expect(matchRebateForProject([prefix, exact], 'p1', '海信e8s_2026')).toBe(exact);
  });
});
