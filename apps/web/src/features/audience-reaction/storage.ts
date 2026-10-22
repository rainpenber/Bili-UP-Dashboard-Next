/**
 * 浏览器草稿命名空间（与旧站 `v1:fake-comment-prompt:form` 隔离）。
 * 旧工具导出的 version:1 JSON 可通过 importConfig 迁移；不读取跨源 localStorage。
 */
export const STORAGE_KEY = 'studio:audience-reaction:v1:form';

/** 与旧工具导出兼容的配置版本 */
export const EXPORT_VERSION = 1 as const;

export type TemplateId = 'comment' | 'danmaku';

export type StoredForm = {
  product: string;
  category: string;
  positioning: string;
  reference_comments: string;
  templateId: TemplateId;
};

export type LoadFormResult =
  | { ok: true; form: StoredForm; warning?: string }
  | { ok: false; form: StoredForm; error: string; preservedRaw: true };

export type SaveFormResult = { ok: true } | { ok: false; error: string };

export type ExportedConfig = {
  version: 1;
  exportedAt: string;
  form: StoredForm;
};

const FORM_KEYS = [
  'product',
  'category',
  'positioning',
  'reference_comments',
  'templateId',
] as const;

export const defaultForm = (): StoredForm => ({
  product: '',
  category: '',
  positioning: '',
  reference_comments: '',
  templateId: 'danmaku',
});

/** 浏览器草稿后端（默认同 localStorage；测试可注入） */
export type DraftStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

let draftStorageOverride: DraftStorage | null = null;

/** 仅测试使用：注入/清除草稿存储，避免 mock happy-dom Storage 原型 */
export function setDraftStorageForTests(storage: DraftStorage | null): void {
  draftStorageOverride = storage;
}

function resolveDraftStorage(): DraftStorage | null {
  if (draftStorageOverride) return draftStorageOverride;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function isTemplateId(id: unknown): id is TemplateId {
  return id === 'comment' || id === 'danmaku';
}

export function normalizeTemplateId(id: unknown): TemplateId {
  return isTemplateId(id) ? id : 'danmaku';
}

function asStringField(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new Error(`字段 ${field} 必须是字符串`);
  }
  return value;
}

/**
 * 仅接受已知字段与类型，不把任意对象展开进状态。
 */
export function parseStoredForm(raw: unknown): StoredForm {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('配置 form 必须是对象');
  }
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!(FORM_KEYS as readonly string[]).includes(key)) {
      throw new Error(`含有未知字段: ${key}`);
    }
  }
  const form = defaultForm();
  form.product = asStringField(o.product, 'product');
  form.category = asStringField(o.category, 'category');
  form.positioning = asStringField(o.positioning, 'positioning');
  form.reference_comments = asStringField(o.reference_comments, 'reference_comments');
  if (o.templateId !== undefined) {
    if (!isTemplateId(o.templateId)) {
      throw new Error('templateId 必须是 comment 或 danmaku');
    }
    form.templateId = o.templateId;
  }
  return form;
}

export function loadForm(): LoadFormResult {
  const storage = resolveDraftStorage();
  if (!storage) {
    return {
      ok: true,
      form: defaultForm(),
      warning: '当前环境无 localStorage，草稿仅在本会话有效',
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    // 读失败但写可能仍可用：必须 ok:false 以阻止页面挂载时用空白表单覆盖原草稿
    return {
      ok: false,
      form: defaultForm(),
      error:
        '无法读取本地草稿（存储不可用），已使用空白表单；不会覆盖已有草稿。可导入 JSON 或清除本地草稿后继续。',
      preservedRaw: true,
    };
  }
  if (!raw) return { ok: true, form: defaultForm() };
  try {
    const parsed: unknown = JSON.parse(raw);
    const form = parseStoredForm(parsed);
    return { ok: true, form };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      form: defaultForm(),
      error: `本地草稿损坏或格式无效（${message}）。已保留原存储内容，未覆盖；可「清除本地草稿」或导入有效 JSON。`,
      preservedRaw: true,
    };
  }
}

export function saveForm(data: StoredForm): SaveFormResult {
  const storage = resolveDraftStorage();
  if (!storage) {
    return { ok: false, error: '当前环境无 localStorage，无法保存草稿' };
  }
  try {
    // 只序列化白名单字段
    const safe: StoredForm = {
      product: data.product,
      category: data.category,
      positioning: data.positioning,
      reference_comments: data.reference_comments,
      templateId: normalizeTemplateId(data.templateId),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(safe));
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/quota/i.test(message) || (e instanceof DOMException && e.name === 'QuotaExceededError')) {
      return {
        ok: false,
        error: '本地存储配额不足，草稿未写入。请导出 JSON 备份或清除部分浏览器数据后重试。',
      };
    }
    return { ok: false, error: `保存草稿失败：${message}` };
  }
}

export function clearStoredForm(): SaveFormResult {
  const storage = resolveDraftStorage();
  if (!storage) {
    return { ok: false, error: '当前环境无 localStorage' };
  }
  try {
    storage.removeItem(STORAGE_KEY);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `清除草稿失败：${message}` };
  }
}

export function exportConfig(form: StoredForm): string {
  const payload: ExportedConfig = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    form: {
      product: form.product,
      category: form.category,
      positioning: form.positioning,
      reference_comments: form.reference_comments,
      templateId: normalizeTemplateId(form.templateId),
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function importConfig(json: string): StoredForm {
  let p: unknown;
  try {
    p = JSON.parse(json);
  } catch {
    throw new Error('无效的配置文件：不是合法 JSON');
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('无效的配置文件：根节点必须是对象');
  }
  const root = p as Record<string, unknown>;
  if (root.version !== EXPORT_VERSION) {
    throw new Error(`无效的配置文件：需要 version ${EXPORT_VERSION}`);
  }
  if (!('form' in root)) {
    throw new Error('无效的配置文件：缺少 form');
  }
  // 兼容旧导出：允许 form 内仅含部分字段；未知字段拒绝
  return parseStoredForm(root.form);
}
