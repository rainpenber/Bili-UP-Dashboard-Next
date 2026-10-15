import { describe, expect, test } from 'bun:test';
import { commercialMockErrorFromSearch } from './use-commercial-queries';

describe('commercial mock error flag', () => {
  test('detects query param', () => {
    expect(commercialMockErrorFromSearch('')).toBe(false);
    expect(commercialMockErrorFromSearch('commercialMockError=1')).toBe(true);
    expect(commercialMockErrorFromSearch('tab=1&commercialMockError=1')).toBe(true);
  });
});
