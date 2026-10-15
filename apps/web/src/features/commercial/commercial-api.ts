import {
  parseCommercialDefaultTemplate,
  parseCommercialNodeWriteResponse,
  parseCommercialOpenItemWriteResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  parseCommercialPublishResponse,
  parseCommercialWriteError,
  type CommercialBlockRequest,
  type CommercialCancelItemRequest,
  type CommercialCloseItemRequest,
  type CommercialDefaultTemplate,
  type CommercialNodeWriteResponse,
  type CommercialOpenItemWriteResponse,
  type CommercialProjectDetail,
  type CommercialProjectListResponse,
  type CommercialProjectWorkflow,
  type CommercialPublishRequest,
  type CommercialPublishResponse,
  type CommercialWriteErrorCode,
} from '@studio/contracts';

const API_BASE = '/api/v1/commercial';

export class CommercialApiError extends Error {
  readonly status: number;
  readonly code: CommercialWriteErrorCode | null;
  readonly names: string[];

  constructor(
    message: string,
    status: number,
    code: CommercialWriteErrorCode | null = null,
    names: string[] = [],
  ) {
    super(message);
    this.name = 'CommercialApiError';
    this.status = status;
    this.code = code;
    this.names = names;
  }
}

export type WriteFeedback =
  | { kind: 'ok' }
  | { kind: 'stale'; message: string }
  | { kind: 'refused'; message: string; names: string[]; code: string };

export const STALE_WRITE_MESSAGE =
  '数据已在别处更新，页面已重新加载。请核对当前内容后再操作，系统不会用新的令牌自动重试。';

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function errorFromResponse(status: number, body: unknown): CommercialApiError {
  if (body && typeof body === 'object') {
    try {
      const parsed = parseCommercialWriteError(body);
      return new CommercialApiError(parsed.error, status, parsed.code, parsed.names ?? []);
    } catch {
      const record = body as { error?: unknown };
      if (typeof record.error === 'string' && record.error.trim().length > 0) {
        return new CommercialApiError(record.error, status);
      }
    }
  }
  return new CommercialApiError(`请求失败（${status}）`, status);
}

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const body = await readBody(res);
  if (!res.ok) throw errorFromResponse(res.status, body);
  return parse(body);
}

async function postJson<T>(path: string, body: unknown, parse: (value: unknown) => T): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsedBody = await readBody(res);
  if (!res.ok) throw errorFromResponse(res.status, parsedBody);
  return parse(parsedBody);
}

function projectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function fetchCommercialProjectList(): Promise<CommercialProjectListResponse> {
  return getJson('/projects', parseCommercialProjectList);
}

export function fetchCommercialProjectDetail(projectId: string): Promise<CommercialProjectDetail> {
  return getJson(projectPath(projectId), parseCommercialProjectDetail);
}

export function fetchCommercialWorkflow(projectId: string): Promise<CommercialProjectWorkflow> {
  return getJson(`${projectPath(projectId)}/workflow`, parseCommercialProjectWorkflow);
}

export function fetchDefaultCommercialTemplate(): Promise<CommercialDefaultTemplate> {
  return getJson('/templates/default', parseCommercialDefaultTemplate);
}

export function advanceCommercialNode(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  return postNode(projectId, nodeId, 'advance', { expectedUpdatedAt });
}

export function completeCommercialNode(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  return postNode(projectId, nodeId, 'complete', { expectedUpdatedAt });
}

export function skipCommercialNode(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  return postNode(projectId, nodeId, 'skip', { expectedUpdatedAt });
}

export function rollbackCommercialNode(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  return postNode(projectId, nodeId, 'rollback', { expectedUpdatedAt });
}

export function unblockCommercialNode(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  return postNode(projectId, nodeId, 'unblock', { expectedUpdatedAt });
}

export function blockCommercialNode(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
  reason: string | null,
): Promise<CommercialNodeWriteResponse> {
  const body: CommercialBlockRequest = { expectedUpdatedAt, reason };
  return postNode(projectId, nodeId, 'block', body);
}

export function publishCommercialNode(
  projectId: string,
  nodeId: string,
  body: CommercialPublishRequest,
): Promise<CommercialPublishResponse> {
  return postJson(
    `${projectPath(projectId)}/nodes/${encodeURIComponent(nodeId)}/publish`,
    body,
    parseCommercialPublishResponse,
  );
}

export function closeCommercialOpenItem(
  projectId: string,
  itemId: string,
  body: CommercialCloseItemRequest,
): Promise<CommercialOpenItemWriteResponse> {
  return postJson(
    `${projectPath(projectId)}/open-items/${encodeURIComponent(itemId)}/close`,
    body,
    parseCommercialOpenItemWriteResponse,
  );
}

export function cancelCommercialOpenItem(
  projectId: string,
  itemId: string,
  body: CommercialCancelItemRequest,
): Promise<CommercialOpenItemWriteResponse> {
  return postJson(
    `${projectPath(projectId)}/open-items/${encodeURIComponent(itemId)}/cancel`,
    body,
    parseCommercialOpenItemWriteResponse,
  );
}

function postNode(
  projectId: string,
  nodeId: string,
  action: 'advance' | 'complete' | 'skip' | 'rollback' | 'block' | 'unblock',
  body: unknown,
): Promise<CommercialNodeWriteResponse> {
  return postJson(
    `${projectPath(projectId)}/nodes/${encodeURIComponent(nodeId)}/${action}`,
    body,
    parseCommercialNodeWriteResponse,
  );
}

/**
 * Sends one write. On success or stale_write, refetches.
 * A stale token is never replaced and sent again inside this function.
 */
async function refetchQuietly(refetch: () => Promise<void>): Promise<void> {
  try {
    await refetch();
  } catch {
    // The write already finished. A failed reload leaves the query in its error state.
  }
}

export async function executeCommercialWrite<T>(options: {
  send: () => Promise<T>;
  refetch: () => Promise<void>;
}): Promise<{ feedback: WriteFeedback; result: T | null }> {
  try {
    const result = await options.send();
    await refetchQuietly(options.refetch);
    return { feedback: { kind: 'ok' }, result };
  } catch (error) {
    if (error instanceof CommercialApiError && error.code === 'stale_write') {
      await refetchQuietly(options.refetch);
      return { feedback: { kind: 'stale', message: STALE_WRITE_MESSAGE }, result: null };
    }
    if (error instanceof CommercialApiError) {
      return {
        feedback: {
          kind: 'refused',
          message: error.message,
          names: error.names,
          code: error.code ?? 'invalid_body',
        },
        result: null,
      };
    }
    const message = error instanceof Error ? error.message : '操作失败';
    return {
      feedback: { kind: 'refused', message, names: [], code: 'invalid_body' },
      result: null,
    };
  }
}
