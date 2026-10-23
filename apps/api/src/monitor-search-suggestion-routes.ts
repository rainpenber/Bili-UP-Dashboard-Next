import {
  MonitorContractError,
  parseMonitorSearchSuggestionsQuery,
  parseMonitorSearchSuggestionsResponse,
} from '@studio/contracts';
import { listMonitorSearchSuggestions, type Sql } from '@studio/db';
import type { Hono } from 'hono';

function jsonError(err: unknown): {
  status: 400 | 404 | 500;
  body: { error: string; code: string };
} {
  if (err instanceof MonitorContractError) {
    return { status: 400, body: { error: err.message, code: err.code } };
  }
  const message = err instanceof Error ? err.message : '请求无法处理';
  return { status: 500, body: { error: message, code: 'internal' } };
}

export function registerMonitorSearchSuggestionRoutes(app: Hono, db: Sql): void {
  app.get('/search-suggestions', async (c) => {
    try {
      const query = parseMonitorSearchSuggestionsQuery({
        q: c.req.query('q'),
        type: c.req.query('type'),
        limit: c.req.query('limit'),
      });
      const listed = await listMonitorSearchSuggestions(db, query);
      return c.json(
        parseMonitorSearchSuggestionsResponse({
          q: query.q,
          type: query.type,
          limit: query.limit,
          videos: listed.videos,
          creators: listed.creators,
          categories: listed.categories,
        }),
      );
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });
}
