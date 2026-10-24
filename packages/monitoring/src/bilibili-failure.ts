import {
  FIRST_ACCESS_AWAITING_MANUAL_MARKER,
  FIRST_ACCESS_MAX_ATTEMPTS,
  FIRST_ACCESS_RETRY_MINUTES,
  FIRST_ACCESS_WAITING_MARKER,
  isFirstAccessAwaitingManualError,
  isFirstAccessWaitingError,
  parseFirstAccessFailureCount,
} from '@studio/db';

export type FailureKind =
  'retryable' | 'not_found' | 'risk_control' | 'rate_limited' | 'unauthorized' | 'dry_run';

export type UpstreamEndpoint =
  | 'view'
  | 'online'
  | 'relation_stat'
  | 'nav'
  | 'qr_generate'
  | 'qr_poll'
  | 'dynamic_detail'
  | 'space_arc_search'
  | 'space_dynamic_feed'
  | 'web_interface_card'
  | 'space_acc_info';

export type UpstreamCall = {
  endpoint: UpstreamEndpoint;
  statusCode: number | null;
  bizCode: number | null;
  durationMs: number;
  error: string | null;
};

export {
  FIRST_ACCESS_AWAITING_MANUAL_MARKER,
  FIRST_ACCESS_MAX_ATTEMPTS,
  FIRST_ACCESS_RETRY_MINUTES,
  FIRST_ACCESS_WAITING_MARKER,
  isFirstAccessAwaitingManualError,
  isFirstAccessWaitingError,
  parseFirstAccessFailureCount,
};

export class BilibiliFailure extends Error {
  readonly kind: FailureKind;
  readonly endpoint: UpstreamEndpoint;
  readonly statusCode: number | null;
  readonly bizCode: number | null;
  readonly calls: UpstreamCall[];
  readonly payload: unknown;

  constructor(input: {
    message: string;
    kind: FailureKind;
    endpoint: UpstreamEndpoint;
    statusCode: number | null;
    bizCode: number | null;
    calls: UpstreamCall[];
    payload?: unknown;
  }) {
    super(input.message);
    this.name = 'BilibiliFailure';
    this.kind = input.kind;
    this.endpoint = input.endpoint;
    this.statusCode = input.statusCode;
    this.bizCode = input.bizCode;
    this.calls = input.calls;
    this.payload = input.payload ?? null;
  }
}

export function classifyBilibiliResponse(input: {
  statusCode: number | null;
  bizCode: number | null;
  timedOut: boolean;
}): FailureKind | null {
  if (input.timedOut || input.statusCode === null) return 'retryable';
  if (input.statusCode >= 500) return 'retryable';
  // Auth / risk / rate-limit before inaccessible: HTTP 404 + biz -101 is login expiry,
  // not first-access "稿件不可访问".
  if (input.statusCode === 412 || input.bizCode === -412 || input.bizCode === -352) {
    return 'risk_control';
  }
  if (input.bizCode === -509) return 'rate_limited';
  if (input.bizCode === -101) return 'unauthorized';
  if (input.bizCode === -404 || input.statusCode === 404) return 'not_found';
  if (input.bizCode !== null && input.bizCode !== 0) return 'retryable';
  if (input.statusCode >= 400) return 'retryable';
  return null;
}

export function retryDelayMinutes(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 0), 16);
  return Math.min(2 ** exponent, 30);
}

const RISK_COOLDOWN_MS = 30 * 60 * 1000;
const RATE_COOLDOWN_MS = 60 * 60 * 1000;

export function circuitCooldownMs(kind: FailureKind): number | null {
  if (kind === 'risk_control') return RISK_COOLDOWN_MS;
  if (kind === 'rate_limited') return RATE_COOLDOWN_MS;
  return null;
}

export type FailurePlan =
  | { action: 'retry'; terminal: boolean; retryAt: Date | null }
  | { action: 'first_access_retry'; terminal: boolean; retryAt: Date | null }
  | { action: 'disable'; terminal: true }
  | { action: 'circuit'; resumeAt: Date; terminal: boolean; retryAt: Date | null }
  | { action: 'expire'; deferUntil: Date }
  | { action: 'dry_run'; deferUntil: Date };

/**
 * Plan a collector failure.
 * `firstAccessWait` applies only to never-succeeded video + confirmed inaccessible
 * (`not_found` from upstream -404 / HTTP 404). Other kinds keep prior semantics.
 */
export function planBilibiliFailure(input: {
  kind: FailureKind;
  attempts: number;
  maxAttempts: number;
  now: Date;
  firstAccessWait?: boolean;
}): FailurePlan {
  if (input.kind === 'dry_run') {
    return { action: 'dry_run', deferUntil: new Date(input.now.getTime() + 60_000) };
  }
  if (input.kind === 'not_found') {
    if (input.firstAccessWait) {
      const terminal = input.attempts >= FIRST_ACCESS_MAX_ATTEMPTS;
      const retryAt = terminal
        ? null
        : new Date(input.now.getTime() + FIRST_ACCESS_RETRY_MINUTES * 60_000);
      return { action: 'first_access_retry', terminal, retryAt };
    }
    return { action: 'disable', terminal: true };
  }
  if (input.kind === 'unauthorized') {
    return { action: 'expire', deferUntil: new Date(input.now.getTime() + 60 * 60 * 1000) };
  }
  const cooldown = circuitCooldownMs(input.kind);
  if (cooldown !== null) {
    const resumeAt = new Date(input.now.getTime() + cooldown);
    const terminal = input.attempts >= input.maxAttempts;
    return { action: 'circuit', resumeAt, terminal, retryAt: terminal ? null : resumeAt };
  }
  const terminal = input.attempts >= input.maxAttempts;
  const retryAt = terminal
    ? null
    : new Date(input.now.getTime() + retryDelayMinutes(input.attempts) * 60_000);
  return { action: 'retry', terminal, retryAt };
}

export function circuitIsOpen(resumeAt: Date, now: Date): boolean {
  return resumeAt.getTime() > now.getTime();
}

/**
 * Readable first-access error. Does not assert "未上线" — only that upstream
 * confirmed the稿件 is currently inaccessible (not_found), with attempt count.
 */
export function formatFirstAccessError(input: {
  upstreamMessage: string;
  attempts: number;
  terminal: boolean;
}): string {
  const base = input.upstreamMessage.trim() || '上游返回稿件不可访问';
  const count = `失败 ${input.attempts}/${FIRST_ACCESS_MAX_ATTEMPTS} 次`;
  if (input.terminal) {
    return `${base}；首次采集上游确认暂不可访问，${count}，达到上限待人工介入 ${FIRST_ACCESS_AWAITING_MANUAL_MARKER}`;
  }
  return `${base}；首次采集上游确认暂不可访问，${count}，${FIRST_ACCESS_RETRY_MINUTES} 分钟后重试 ${FIRST_ACCESS_WAITING_MARKER}`;
}
