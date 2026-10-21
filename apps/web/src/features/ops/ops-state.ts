export type OpsTab = 'jobs' | 'operations' | 'logs';

export type OpsView = {
  tab: OpsTab;
  targetId: string;
  targetType: string;
  externalId: string;
  type: string;
  status: string;
  since: string;
  until: string;
  projectId: string;
  group: 'time' | 'target';
  page: number;
  q: string;
  job: string;
  action: string;
  level: string;
  service: string;
  logQ: string;
  runId: string;
  attention: boolean;
  opPage: number;
  logCursor: string;
  attemptPage: number;
};

const JOB_STATUS = new Set(['pending', 'running', 'succeeded', 'failed']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string | null): string {
  const text = value?.trim() ?? '';
  return DAY.test(text) ? text : '';
}

function pageOf(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const number = Number(value);
  return number >= 1 && number <= 10000 ? number : 1;
}

export function readOpsView(params: URLSearchParams): OpsView {
  const tabRaw = params.get('tab');
  const tab: OpsTab = tabRaw === 'operations' || tabRaw === 'logs' ? tabRaw : 'jobs';
  const type = params.get('type');
  const targetType = params.get('targetType');
  const group = params.get('group') === 'target' ? 'target' : 'time';
  const status = params.get('status') ?? '';
  return {
    tab,
    targetId: params.get('targetId')?.trim() ?? '',
    targetType: targetType === 'video' || targetType === 'creator' ? targetType : '',
    externalId: params.get('externalId')?.trim() ?? '',
    type: type === 'video' || type === 'creator' ? type : '',
    status: JOB_STATUS.has(status) ? status : '',
    since: day(params.get('since')),
    until: day(params.get('until')),
    projectId: params.get('projectId')?.trim() ?? '',
    group,
    page: pageOf(params.get('page')),
    q: params.get('q')?.trim() ?? '',
    job: params.get('job')?.trim() ?? '',
    action: params.get('action')?.trim() ?? '',
    level: params.get('level')?.trim() ?? '',
    service: params.get('service')?.trim() ?? '',
    logQ: params.get('logQ')?.trim() ?? '',
    runId: params.get('runId')?.trim() ?? '',
    attention: params.get('attention') === '1',
    opPage: pageOf(params.get('opPage')),
    logCursor: params.get('logCursor')?.trim() ?? '',
    attemptPage: pageOf(params.get('attemptPage')),
  };
}

export function patchOpsView(
  current: URLSearchParams,
  patch: Partial<Record<keyof OpsView, string | number | boolean | null>>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
  }
  if (next.get('tab') === 'jobs') next.delete('tab');
  if (next.get('group') === 'time') next.delete('group');
  if (next.get('page') === '1') next.delete('page');
  if (next.get('opPage') === '1') next.delete('opPage');
  if (next.get('attemptPage') === '1') next.delete('attemptPage');
  return next;
}

export function shanghaiDayBounds(day: string): { since: string; until: string } | null {
  if (!DAY.test(day)) return null;
  return {
    since: `${day}T00:00:00.000+08:00`,
    until: `${day}T23:59:59.999+08:00`,
  };
}
