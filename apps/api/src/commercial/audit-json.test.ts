import { describe, expect, test } from 'bun:test';
import { normalizeAuditDetail } from './audit-json';

describe('normalizeAuditDetail', () => {
  test('passes through object detail', () => {
    expect(normalizeAuditDetail({ conclusion: 'OK' })).toEqual({ conclusion: 'OK' });
  });

  test('unwraps legacy double-encoded json string', () => {
    expect(normalizeAuditDetail(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });
});
