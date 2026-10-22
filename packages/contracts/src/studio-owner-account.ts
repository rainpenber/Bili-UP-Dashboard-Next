import { MonitorContractError, externalIdError } from './monitor-targets';

/** Default personal Bilibili UID used by migration seed (狐正正). */
export const DEFAULT_STUDIO_OWNER_MID = '3493141386627335';
export const DEFAULT_STUDIO_OWNER_DISPLAY_NAME = '狐正正';

const MAX_DISPLAY_NAME = 80;

export type StudioOwnerAccount = {
  mid: string;
  displayName: string;
  updatedAt: string;
};

export type UpdateStudioOwnerAccountRequest = {
  mid: string;
  displayName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a personal Bilibili UID as a decimal string (no Number coercion). */
export function parseStudioOwnerMid(raw: string): string {
  const mid = raw.trim();
  if (!mid) {
    throw new MonitorContractError('invalid_owner_mid', '请填写本人 B 站 UID');
  }
  const idError = externalIdError('creator', mid);
  if (idError) {
    throw new MonitorContractError('invalid_owner_mid', idError);
  }
  return mid;
}

export function parseStudioOwnerDisplayName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new MonitorContractError('invalid_owner_display_name', '请填写本人账号显示名');
  }
  if (name.length > MAX_DISPLAY_NAME) {
    throw new MonitorContractError(
      'invalid_owner_display_name',
      `显示名最多 ${MAX_DISPLAY_NAME} 个字符`,
    );
  }
  return name;
}

export function parseUpdateStudioOwnerAccountRequest(
  value: unknown,
): UpdateStudioOwnerAccountRequest {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '请提供本人账号配置');
  }
  if (typeof value.mid !== 'string') {
    throw new MonitorContractError('invalid_owner_mid', '请填写本人 B 站 UID');
  }
  if (typeof value.displayName !== 'string') {
    throw new MonitorContractError('invalid_owner_display_name', '请填写本人账号显示名');
  }
  return {
    mid: parseStudioOwnerMid(value.mid),
    displayName: parseStudioOwnerDisplayName(value.displayName),
  };
}

export function parseStudioOwnerAccount(value: unknown): StudioOwnerAccount {
  if (!isRecord(value)) {
    throw new MonitorContractError('invalid_body', '本人账号配置响应不完整');
  }
  if (typeof value.mid !== 'string' || typeof value.displayName !== 'string') {
    throw new MonitorContractError('invalid_body', '本人账号配置响应不完整');
  }
  if (typeof value.updatedAt !== 'string') {
    throw new MonitorContractError('invalid_body', '本人账号配置响应不完整');
  }
  const mid = parseStudioOwnerMid(value.mid);
  const displayName = parseStudioOwnerDisplayName(value.displayName);
  return { mid, displayName, updatedAt: value.updatedAt };
}

/** Query flag: omit / 0 / false → off; 1 / true → on. */
export function parseOnlyMineFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === null || raw === '') return false;
  const text = raw.trim().toLowerCase();
  if (text === '1' || text === 'true') return true;
  if (text === '0' || text === 'false') return false;
  throw new MonitorContractError('invalid_only_mine', '只看我的参数不正确');
}
