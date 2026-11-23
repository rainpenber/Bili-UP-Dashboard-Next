import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { CommercialRebate } from '@studio/contracts';
import { fireEvent, waitFor } from '@testing-library/react';
import { RebateChip, rebateChipText } from './rebate-chip';

afterEach(cleanup);

function rebate(overrides: Partial<CommercialRebate> = {}): CommercialRebate {
  return {
    id: 'c0b00009-0000-4000-8000-000000000009',
    projectId: null,
    projectName: 'plaud ai录音笔',
    counterparty: null,
    expectedAmount: '4950.00',
    isReturned: false,
    returnedAt: null,
    contractState: 'sent',
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

describe('rebate chip', () => {
  test('shows amount and stage labels', () => {
    expect(rebateChipText(rebate())).toBe('返点 ¥4,950.00 · 合同已发 · 未开票 · 待转款');
  });

  test('checkbox changes call back with the field patch', async () => {
    const calls: unknown[] = [];
    render(<RebateChip rebate={rebate()} onPatch={async (patch) => void calls.push(patch)} />);
    fireEvent.click(screen.getByTestId('rebate-chip'));
    fireEvent.click(screen.getByLabelText('合同已回寄'));
    await waitFor(() => expect(calls).toEqual([{ contractState: 'signed' }]));
    fireEvent.click(screen.getByLabelText('发票已收到'));
    await waitFor(() => expect(calls).toContainEqual({ invoiceState: 'received' }));
    fireEvent.click(screen.getByLabelText('已返'));
    await waitFor(() => expect(calls).toContainEqual({ isReturned: true }));
  });

  test('returned rows render read-only', () => {
    render(
      <RebateChip
        rebate={rebate({ isReturned: true, returnedAt: '2026-11-23' })}
        onPatch={async () => undefined}
      />,
    );
    expect(screen.getByTestId('rebate-chip').textContent).toContain('已返');
    expect(screen.queryByTestId('rebate-chip-panel')).toBeNull();
  });
});
