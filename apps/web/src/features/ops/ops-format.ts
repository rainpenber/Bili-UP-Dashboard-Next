import { scrubString, scrubValue } from '@studio/observability/redact';
import type { OpsJobStatus, OpsOperationAction } from '@studio/contracts';

export function formatShanghaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}:${pick('second')}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function jobStatusLabel(status: OpsJobStatus): string {
  if (status === 'pending') return '排队中';
  if (status === 'running') return '执行中';
  if (status === 'succeeded') return '成功';
  return '失败';
}

export function jobStatusVariant(
  status: OpsJobStatus,
): 'secondary' | 'info' | 'success' | 'destructive' {
  if (status === 'pending') return 'secondary';
  if (status === 'running') return 'info';
  if (status === 'succeeded') return 'success';
  return 'destructive';
}

export function operationLabel(action: OpsOperationAction): string {
  if (action === 'create') return '新增';
  if (action === 'pause') return '暂停';
  if (action === 'resume') return '恢复';
  if (action === 'interval') return '调整频率';
  if (action === 'rename') return '调整名称';
  if (action === 'tags') return '调整标签';
  if (action === 'remove') return '移除';
  return '手动采集';
}

export function safeText(value: string | null | undefined): string {
  if (!value) return '—';
  return scrubString(value);
}

export function safeContext(value: unknown): string {
  try {
    return scrubString(JSON.stringify(scrubValue(value), null, 2));
  } catch {
    return '{}';
  }
}

export function actorLabel(actor: string | null): string {
  return actor && actor.trim().length > 0 ? scrubString(actor) : '未记录';
}

export function sourceLabel(source: string | null): string {
  return source && source.trim().length > 0 ? scrubString(source) : '未记录';
}
