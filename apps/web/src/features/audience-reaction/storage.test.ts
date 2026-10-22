import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  STORAGE_KEY,
  clearStoredForm,
  defaultForm,
  exportConfig,
  importConfig,
  loadForm,
  parseStoredForm,
  saveForm,
} from './storage';
import { restoreLocalStorageMethods } from './storage-test-utils';

beforeEach(() => {
  restoreLocalStorageMethods();
});

afterEach(() => {
  restoreLocalStorageMethods();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

describe('parseStoredForm', () => {
  it('accepts known string fields', () => {
    const form = parseStoredForm({
      product: 'P',
      category: 'C',
      positioning: 'Pos',
      reference_comments: 'r1',
      templateId: 'comment',
    });
    expect(form.product).toBe('P');
    expect(form.templateId).toBe('comment');
  });

  it('rejects unknown fields and non-string values', () => {
    expect(() => parseStoredForm({ product: 1 })).toThrow(/必须是字符串/);
    expect(() => parseStoredForm({ evil: 'x' })).toThrow(/未知字段/);
    expect(() => parseStoredForm({ templateId: 'nope' })).toThrow(/templateId/);
    expect(() => parseStoredForm('<script>alert(1)</script>')).toThrow();
  });

  it('does not treat HTML text as valid form object', () => {
    expect(() => parseStoredForm({ product: '<img onerror=1>' })).not.toThrow();
    const f = parseStoredForm({ product: '<img onerror=1>' });
    expect(f.product).toBe('<img onerror=1>');
  });
});

describe('export/import roundtrip', () => {
  it('roundtrips and accepts legacy-shaped version 1 JSON', () => {
    const form = {
      ...defaultForm(),
      product: '耳机',
      category: '数码',
      positioning: '入门',
      reference_comments: '好用\n便宜',
      templateId: 'comment' as const,
    };
    const json = exportConfig(form);
    const back = importConfig(json);
    expect(back).toEqual(form);

    const legacy = JSON.stringify({
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      form: {
        product: '旧工具',
        category: '',
        positioning: '',
        reference_comments: '',
        templateId: 'danmaku',
      },
    });
    expect(importConfig(legacy).product).toBe('旧工具');
  });

  it('rejects malicious or invalid JSON payloads', () => {
    expect(() => importConfig('not json')).toThrow(/合法 JSON/);
    expect(() => importConfig('[]')).toThrow(/根节点/);
    expect(() => importConfig(JSON.stringify({ version: 2, form: {} }))).toThrow(/version/);
    expect(() =>
      importConfig('{"version":1,"form":{"product":"x","extra":1,"templateId":"danmaku"}}'),
    ).toThrow(/未知字段/);
  });
});

describe('localStorage load/save', () => {
  it('saves and loads under the new namespace', () => {
    const form = { ...defaultForm(), product: '草稿' };
    expect(saveForm(form).ok).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toContain('草稿');
    const loaded = loadForm();
    expect(loaded.ok).toBe(true);
    expect(loaded.form.product).toBe('草稿');
  });

  it('preserves corrupt storage without overwriting on load', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    const loaded = loadForm();
    expect(loaded.ok).toBe(false);
    if (loaded.ok === false) {
      expect(loaded.preservedRaw).toBe(true);
      expect(loaded.error).toMatch(/损坏|格式/);
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{not-json');
  });

  it('getItem throw returns ok:false and does not clear existing draft', () => {
    const legacy = JSON.stringify({
      product: 'Legacy acceptance product',
      category: '',
      positioning: '',
      reference_comments: '',
      templateId: 'danmaku',
    });
    localStorage.setItem(STORAGE_KEY, legacy);
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    Object.defineProperty(localStorage, 'getItem', {
      configurable: true,
      writable: true,
      value(key: string) {
        if (key === STORAGE_KEY) throw new Error('blocked read');
        return proto.getItem.call(localStorage, key);
      },
    });
    try {
      expect(() => localStorage.getItem(STORAGE_KEY)).toThrow(/blocked read/);
      const loaded = loadForm();
      expect(loaded.ok).toBe(false);
      if (loaded.ok === false) {
        expect(loaded.preservedRaw).toBe(true);
        expect(loaded.error).toMatch(/不会覆盖已有草稿/);
      }
      // 在 mock 仍生效时用原型读，确认原草稿未被清除
      expect(proto.getItem.call(localStorage, STORAGE_KEY)).toBe(legacy);
    } finally {
      Object.defineProperty(localStorage, 'getItem', {
        configurable: true,
        writable: true,
        value: proto.getItem.bind(localStorage),
      });
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBe(legacy);
  });

  it('clearStoredForm removes draft', () => {
    saveForm({ ...defaultForm(), product: 'x' });
    expect(clearStoredForm().ok).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
