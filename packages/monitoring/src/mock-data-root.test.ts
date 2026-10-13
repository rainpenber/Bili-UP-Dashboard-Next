import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMockDataLayout } from './mock-data-root';

describe('resolveMockDataLayout', () => {
  let tempRoot = '';

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  test('requires backend/ and frontend/ and exposes assets when present', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'mock-data-'));
    mkdirSync(join(tempRoot, 'backend'));
    mkdirSync(join(tempRoot, 'frontend'));
    mkdirSync(join(tempRoot, 'assets'));
    const layout = resolveMockDataLayout({ MOCK_DATA_ROOT: tempRoot });
    expect(layout.root).toBe(tempRoot);
    expect(layout.backendRoot).toBe(join(tempRoot, 'backend'));
    expect(layout.frontendRoot).toBe(join(tempRoot, 'frontend'));
    expect(layout.assetsRoot).toBe(join(tempRoot, 'assets'));
    expect(layout.assetsMode).toBe('filesystem');
  });

  test('placeholder assets mode when assets/ missing', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'mock-data-'));
    mkdirSync(join(tempRoot, 'backend'));
    mkdirSync(join(tempRoot, 'frontend'));
    const layout = resolveMockDataLayout({ MOCK_DATA_ROOT: tempRoot });
    expect(layout.assetsRoot).toBeNull();
    expect(layout.assetsMode).toBe('placeholder_only');
  });

  test('throws when backend/ missing', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'mock-data-'));
    mkdirSync(join(tempRoot, 'frontend'));
    expect(() => resolveMockDataLayout({ MOCK_DATA_ROOT: tempRoot })).toThrow(/backend/);
  });
});
