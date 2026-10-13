import { describe, expect, test } from 'bun:test';
import { parseMonitorSearchParams, writeMonitorSearchParams } from './monitor-url-state';

describe('monitor URL state', () => {
  test('defaults and parsing', () => {
    const state = parseMonitorSearchParams(new URLSearchParams());
    expect(state).toEqual({
      tab: 'videos',
      page: 1,
      category: '',
      q: '',
      selected: null,
    });
  });

  test('write merges and clears empty fields', () => {
    const base = new URLSearchParams('tab=creators&page=2&q=test&selected=abc');
    const next = writeMonitorSearchParams(base, { q: '', selected: null, page: 1 });
    expect(next.get('tab')).toBe('creators');
    expect(next.get('page')).toBe('1');
    expect(next.has('q')).toBe(false);
    expect(next.has('selected')).toBe(false);
  });
});
