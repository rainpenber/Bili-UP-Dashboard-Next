import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import type { ApiErrorBody } from '@studio/contracts';

export function jsonError(
  c: Context,
  status: 400 | 404 | 409 | 500,
  message: string,
  details?: unknown,
) {
  const body: ApiErrorBody = {
    error: message,
    requestId: randomUUID(),
    ...(details !== undefined ? { details } : {}),
  };
  return c.json(body, status);
}
