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
  test('shows only platform price, agreed rate, rationale, and quotes', () => {
    render(
      <AmountEvidencePopover
        platformAmount="31922.00"
        agreedRebateRate="0.30"
        rationale="纯现金、无置换无返点"
        evidence={evidence}
      />,
    );

    const trigger = screen.getByTestId('amount-evidence-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('金额依据');
    expect(screen.queryByText('就是按照20000元给咱们结算的噻')).toBeNull();

    fireEvent.click(trigger);
    const popover = screen.getByTestId('amount-evidence-popover');
    expect(popover.textContent).toContain('平台下单价格');
    expect(popover.textContent).toContain('¥31,922');
    expect(popover.textContent).toContain('商议返点比例');
    expect(popover.textContent).toContain('30.0%');
    expect(popover.textContent).toContain('纯现金、无置换无返点');
    expect(popover.textContent).toContain('就是按照20000元给咱们结算的噻');
    expect(popover.textContent).toContain('别动我冰可乐');
    expect(popover.textContent).not.toContain('到手金额');
    expect(popover.textContent).not.toContain('到手');
    expect(popover.textContent).not.toContain('净额');
  });

  test('shows an empty hint instead of a blank panel', () => {
    render(
      <AmountEvidencePopover
        platformAmount={null}
        agreedRebateRate={null}
        rationale={null}
        evidence={[]}
      />,
    );
    fireEvent.click(screen.getByTestId('amount-evidence-trigger'));
    expect(screen.getByText(/暂无原文依据/)).toBeTruthy();
    expect(screen.getByTestId('amount-evidence-popover').textContent).toContain('未填写');
  });

  test('closes on escape', () => {
    render(
      <AmountEvidencePopover
        platformAmount="39000.00"
        agreedRebateRate={null}
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
