import { MonitorContractError } from './monitor-targets';

export const BILI_ACCOUNT_EXPIRY_STATES = [
  'ok',
  'expiring_soon',
  'expired',
  'missing_secret',
  'revoked',
] as const;

export type BiliAccountExpiryState = (typeof BILI_ACCOUNT_EXPIRY_STATES)[number];

export const BILI_ACCOUNT_STATUSES = [
  'pending',
  'active',
  'expired',
  'revoked',
  'blocked',
] as const;

export type BiliAccountStatus = (typeof BILI_ACCOUNT_STATUSES)[number];

const MAX_NOTE = 500;
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type BiliAccountListItem = {
  id: string;
  mid: string | null;
  uname: string | null;
  status: BiliAccountStatus;
  isDefault: boolean;
  cookieExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  note: string;
  secretPresent: boolean;
  derivedExpiryState: BiliAccountExpiryState;
  revokedAt: string | null;
};

export type BiliAccountListResponse = {
  items: BiliAccountListItem[];
  /** False when MONITOR_DATA_SOURCE=mock or COLLECTOR_PROVIDER is not bilibili. */
  realAccessEnabled: boolean;
};

export type CreateBiliAccountRequest = {
  cookie: string;
  note?: string;
  mid?: string;
  replace?: boolean;
};

export type PatchBiliAccountRequest = {
  note?: string;
  isDefault?: boolean;
};

export type RevokeBiliAccountResponse = {
  account: BiliAccountListItem;
  /** True when no active default remains after revoke. */
  noDefaultRemaining: boolean;
  message: string;
};

export type VerifyBiliAccountResponse = {
  account: BiliAccountListItem;
  verified: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is BiliAccountStatus {
  return typeof value === 'string' && (BILI_ACCOUNT_STATUSES as readonly string[]).includes(value);
}

function isExpiryState(value: unknown): value is BiliAccountExpiryState {
  return (
    typeof value === 'string' && (BILI_ACCOUNT_EXPIRY_STATES as readonly string[]).includes(value)
  );
}

function optionalIso(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MonitorContractError('invalid_body', `${field} 格式不正确`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new MonitorContractError('invalid_body', `${field} 格式不正确`);
  }
  return value;
}

export function parseBiliAccountNote(raw: string | undefined): string {
  if (raw === undefined) return '';
  const note = raw.trim();
  if (note.length > MAX_NOTE) {
    throw new MonitorContractError('invalid_note', `备注最多 ${MAX_NOTE} 个字符`);
  }
  return note;
}

export function deriveBiliAccountExpiryState(input: {
  status: BiliAccountStatus;
  secretPresent: boolean;
  cookieExpiresAt: Date | string | null;
  now?: Date;
}): BiliAccountExpiryState {
  if (input.status === 'revoked') return 'revoked';
  if (!input.secretPresent) return 'missing_secret';
  const now = input.now ?? new Date();
  const expires =
    input.cookieExpiresAt === null || input.cookieExpiresAt === undefined
      ? null
      : typeof input.cookieExpiresAt === 'string'
        ? new Date(input.cookieExpiresAt)
        : input.cookieExpiresAt;
  if (input.status === 'expired') return 'expired';
  if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
    return 'expired';
  }
  if (
    expires &&
    !Number.isNaN(expires.getTime()) &&
    expires.getTime() <= now.getTime() + EXPIRING_SOON_MS
  ) {
    return 'expiring_soon';
  }
  return 'ok';
}

export function parseCreateBiliAccountRequest(value: unknown): CreateBiliAccountRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请提供账号 Cookie');
  }
  if (typeof value.cookie !== 'string' || value.cookie.trim() === '') {
    throw new MonitorContractError('invalid_cookie', '请粘贴 B 站 Cookie 字符串');
  }
  const result: CreateBiliAccountRequest = { cookie: value.cookie };
  if (value.note !== undefined) {
    if (typeof value.note !== 'string') {
      throw new MonitorContractError('invalid_note', '备注格式不正确');
    }
    result.note = parseBiliAccountNote(value.note);
  }
  if (value.mid !== undefined) {
    if (typeof value.mid !== 'string' && typeof value.mid !== 'number') {
      throw new MonitorContractError('invalid_mid', 'mid 格式不正确');
    }
    const mid = String(value.mid).trim();
    if (!/^\d{1,20}$/.test(mid) || mid.startsWith('0')) {
      throw new MonitorContractError('invalid_mid', 'mid 必须是正整数字符串');
    }
    result.mid = mid;
  }
  if (value.replace !== undefined) {
    if (typeof value.replace !== 'boolean') {
      throw new MonitorContractError('invalid_replace', 'replace 必须是布尔值');
    }
    result.replace = value.replace;
  }
  return result;
}

export function parsePatchBiliAccountRequest(value: unknown): PatchBiliAccountRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请提供要更新的字段');
  }
  const result: PatchBiliAccountRequest = {};
  if (value.note !== undefined) {
    if (typeof value.note !== 'string') {
      throw new MonitorContractError('invalid_note', '备注格式不正确');
    }
    result.note = parseBiliAccountNote(value.note);
  }
  if (value.isDefault !== undefined) {
    if (typeof value.isDefault !== 'boolean') {
      throw new MonitorContractError('invalid_is_default', 'isDefault 必须是布尔值');
    }
    result.isDefault = value.isDefault;
  }
  if (result.note === undefined && result.isDefault === undefined) {
    throw new MonitorContractError('invalid_body', '请至少提供 note 或 isDefault');
  }
  return result;
}

export function parseBiliAccountListItem(value: unknown): BiliAccountListItem {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '账号响应不完整');
  }
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    throw new MonitorContractError('invalid_body', '账号响应缺少 id');
  }
  if (!isStatus(value.status)) {
    throw new MonitorContractError('invalid_body', '账号 status 无效');
  }
  if (typeof value.isDefault !== 'boolean') {
    throw new MonitorContractError('invalid_body', '账号 isDefault 无效');
  }
  if (typeof value.secretPresent !== 'boolean') {
    throw new MonitorContractError('invalid_body', '账号 secretPresent 无效');
  }
  if (!isExpiryState(value.derivedExpiryState)) {
    throw new MonitorContractError('invalid_body', '账号 derivedExpiryState 无效');
  }
  if (typeof value.note !== 'string') {
    throw new MonitorContractError('invalid_body', '账号 note 无效');
  }
  return {
    id: value.id,
    mid: optionalString(value.mid, 'mid'),
    uname: optionalString(value.uname, 'uname'),
    status: value.status,
    isDefault: value.isDefault,
    cookieExpiresAt: optionalIso(value.cookieExpiresAt, 'cookieExpiresAt'),
    lastVerifiedAt: optionalIso(value.lastVerifiedAt, 'lastVerifiedAt'),
    lastUsedAt: optionalIso(value.lastUsedAt, 'lastUsedAt'),
    note: value.note,
    secretPresent: value.secretPresent,
    derivedExpiryState: value.derivedExpiryState,
    revokedAt: optionalIso(value.revokedAt, 'revokedAt'),
  };
}

export function parseBiliAccountListResponse(value: unknown): BiliAccountListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MonitorContractError('invalid_body', '账号列表响应不完整');
  }
  if (typeof value.realAccessEnabled !== 'boolean') {
    throw new MonitorContractError('invalid_body', '账号列表缺少 realAccessEnabled');
  }
  return {
    items: value.items.map(parseBiliAccountListItem),
    realAccessEnabled: value.realAccessEnabled,
  };
}

export function parseRevokeBiliAccountResponse(value: unknown): RevokeBiliAccountResponse {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '撤销响应不完整');
  }
  if (typeof value.noDefaultRemaining !== 'boolean') {
    throw new MonitorContractError('invalid_body', '撤销响应缺少 noDefaultRemaining');
  }
  if (typeof value.message !== 'string') {
    throw new MonitorContractError('invalid_body', '撤销响应缺少 message');
  }
  return {
    account: parseBiliAccountListItem(value.account),
    noDefaultRemaining: value.noDefaultRemaining,
    message: value.message,
  };
}

export function parseVerifyBiliAccountResponse(value: unknown): VerifyBiliAccountResponse {
  if (!isRecord(value) || value.verified !== true) {
    throw new MonitorContractError('invalid_body', '校验响应不完整');
  }
  return {
    account: parseBiliAccountListItem(value.account),
    verified: true,
  };
}

/** Forbidden response keys that must never appear in API payloads. */
export const BILI_ACCOUNT_SECRET_RESPONSE_KEYS = [
  'cookie',
  'ciphertext',
  'iv',
  'authTag',
  'auth_tag',
  'SESSDATA',
  'bili_jct',
  'DedeUserID__ckMd5',
] as const;
