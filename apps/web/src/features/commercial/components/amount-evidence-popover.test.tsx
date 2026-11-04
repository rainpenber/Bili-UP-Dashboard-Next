import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { AmountEvidencePopover } from './amount-evidence-popover';

const evidence = [
  {
    text: '纯现金的话，一个产品2W',
    speaker: '我方',
    at: '2026-08-06T04:58:00Z',
    conversationId: 1,
    role: 'us' as const,
  },
  {
    text: '就是按照20000元给咱们结算的噻',
    speaker: '别动我冰可乐，大疆市场部',
    at: '2026-11-04T07:11:00Z',
    conversationId: 1,
    role: 'client' as const,
  },
];

afterEach(() => cleanup());

describe('amount evidence popover', () => {
  test('opens from the question mark and shows the rationale with quotes', () => {
    render(
      <AmountEvidencePopover
        netAmount="20000.00"
        rebateAmount="0.00"
        rationale="纯现金、无置换无返点"
        evidence={evidence}
      />,
    );

    const trigger = screen.getByTestId('amount-evidence-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('金额依据');
    expect(screen.queryByText('就是按照20000元给咱们结算的噻')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByText('纯现金、无置换无返点')).toBeTruthy();
    expect(screen.getByText(/20000元给咱们结算/)).toBeTruthy();
    expect(screen.getByText(/别动我冰可乐/)).toBeTruthy();
  });

  test('shows an empty hint instead of a blank panel', () => {
    render(
      <AmountEvidencePopover netAmount={null} rebateAmount={null} rationale={null} evidence={[]} />,
    );
    fireEvent.click(screen.getByTestId('amount-evidence-trigger'));
    expect(screen.getByText(/暂无原文依据/)).toBeTruthy();
  });

  test('closes on escape', () => {
    render(
      <AmountEvidencePopover
        netAmount="20000.00"
        rebateAmount={null}
        rationale="理由"
        evidence={evidence}
      />,
    );
    fireEvent.click(screen.getByTestId('amount-evidence-trigger'));
    expect(screen.getByText('理由')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('理由')).toBeNull();
  });
});
