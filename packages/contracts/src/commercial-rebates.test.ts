import { describe, expect, test } from 'bun:test';
import {
  COMMERCIAL_REBATE_CONTRACT_STATES,
  COMMERCIAL_REBATE_INVOICE_STATES,
  parseCommercialRebateCreateRequest,
  parseCommercialRebateError,
  parseCommercialRebateListResponse,
  parseCommercialRebateResponse,
  parseCommercialRebateUpdateRequest,
} from './commercial';

const REBATE_ID = 'c0b00009-0000-4000-8000-000000000009';
const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';

const REBATE = {
  id: REBATE_ID,
  projectId: null,
  projectName: '大疆 Pocket4',
  counterparty: null,
  expectedAmount: '5320.00',
  isReturned: false,
  returnedAt: null,
  contractState: 'signed',
  invoiceState: 'none',
  note: '待开票；11/20 已催',
  evidence: [],
  stageSince: '2026-11-23T00:00:00.000000Z',
  createdAt: '2026-11-23T00:00:00.000000Z',
  updatedAt: '2026-11-23T00:00:00.000000Z',
  platformPaid: false,
  daysInStage: 3,
};

describe('commercial rebate contracts', () => {
  test('states are the frozen boolean-step vocabularies', () => {
    expect([...COMMERCIAL_REBATE_CONTRACT_STATES]).toEqual(['none', 'sent', 'signed']);
    expect([...COMMERCIAL_REBATE_INVOICE_STATES]).toEqual(['none', 'received']);
  });

  test('parses a rebate row including derived platformPaid and daysInStage', () => {
    const parsed = parseCommercialRebateResponse(REBATE);
    expect(parsed.id).toBe(REBATE_ID);
    expect(parsed.expectedAmount).toBe('5320.00');
    expect(parsed.contractState).toBe('signed');
    expect(parsed.daysInStage).toBe(3);
    expect(parsed.platformPaid).toBe(false);
  });

  test('accepts a linked row with a null project-side amount', () => {
    const parsed = parseCommercialRebateResponse({
      ...REBATE,
      projectId: PROJECT_ID,
      expectedAmount: null,
      platformPaid: true,
    });
    expect(parsed.projectId).toBe(PROJECT_ID);
    expect(parsed.expectedAmount).toBeNull();
    expect(parsed.platformPaid).toBe(true);
  });

  test('parses list totals and open count', () => {
    const parsed = parseCommercialRebateListResponse({
      items: [REBATE],
      summary: {
        outstandingTotal: '30912.40',
        outstandingPlatformPaid: '0.00',
        outstandingPlatformUnpaid: '30912.40',
        settledThisYear: '79500.00',
        openCount: 4,
      },
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.summary.outstandingTotal).toBe('30912.40');
    expect(parsed.summary.openCount).toBe(4);
  });

  test('parses partial update requests and keeps absent fields undefined', () => {
    const parsed = parseCommercialRebateUpdateRequest({
      isReturned: true,
      expectedUpdatedAt: '2026-11-23T00:00:00.000000Z',
    });
    expect(parsed.isReturned).toBe(true);
    expect(parsed.returnedAt).toBeUndefined();
    expect(parsed.contractState).toBeUndefined();
    expect(parsed.expectedAmount).toBeUndefined();
  });

  test('rejects invalid states, dates and amounts', () => {
    expect(() => parseCommercialRebateResponse({ ...REBATE, contractState: 'faxed' })).toThrow(
      /contractState/,
    );
    expect(() => parseCommercialRebateResponse({ ...REBATE, invoiceState: 'paid' })).toThrow(
      /invoiceState/,
    );
    expect(() => parseCommercialRebateResponse({ ...REBATE, returnedAt: '2026-02-30' })).toThrow(
      /returnedAt/,
    );
    expect(() => parseCommercialRebateResponse({ ...REBATE, expectedAmount: '1.234' })).toThrow(
      /expectedAmount/,
    );
    expect(() =>
      parseCommercialRebateUpdateRequest({
        expectedAmount: '12.345',
        expectedUpdatedAt: '2026-11-23T00:00:00.000000Z',
      }),
    ).toThrow(/expectedAmount/);
  });

  test('parses create requests with an optional project id and required name', () => {
    const parsed = parseCommercialRebateCreateRequest({
      projectName: '树新风空气净化器',
      expectedAmount: '10920.00',
      contractState: 'signed',
    });
    expect(parsed.projectId).toBeUndefined();
    expect(parsed.projectName).toBe('树新风空气净化器');
    expect(() => parseCommercialRebateCreateRequest({ projectName: ' ' })).toThrow(/projectName/);
  });

  test('parses the amount-locked refusal', () => {
    const parsed = parseCommercialRebateError({
      error: '关联项目的返点金额以项目为准',
      code: 'amount_locked',
    });
    expect(parsed.code).toBe('amount_locked');
    expect(() => parseCommercialRebateError({ error: 'x', code: 'nope' })).toThrow(/code/);
  });
});
