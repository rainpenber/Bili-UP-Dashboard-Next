import { beforeEach, describe, expect, test } from 'bun:test';
import {
  ACCENT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isThemeAccent,
  isThemeMode,
  persistTheme,
  readStoredAccent,
  readStoredThemeMode,
} from '@/lib/theme';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  globalThis.localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('theme persistence', () => {
  test('validates modes and accents', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('invalid')).toBe(false);
    expect(isThemeAccent('violet')).toBe(true);
    expect(isThemeAccent('blue')).toBe(false);
  });

  test('reads defaults when storage empty', () => {
    expect(readStoredThemeMode()).toBe('system');
    expect(readStoredAccent()).toBe('indigo');
  });

  test('persists selections', () => {
    persistTheme('dark', 'rose');
    expect(readStoredThemeMode()).toBe('dark');
    expect(readStoredAccent()).toBe('rose');
    expect(memory.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(memory.get(ACCENT_STORAGE_KEY)).toBe('rose');
  });
});
