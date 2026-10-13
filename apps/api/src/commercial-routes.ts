import {
  createProjectBodySchema,
  homeDashboardSchema,
  openItemSchema,
  paginatedSchema,
  projectSummarySchema,
  publishProjectBodySchema,
  workflowGraphSchema,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import { Hono } from 'hono';
import { jsonError } from './api-error';
import { CommercialService } from './commercial-service';

export function createCommercialRoutes(db: Sql) {
  const app = new Hono();
  const service = new CommercialService(db);

  app.get('/home', async (c) => {
    const dash = await service.getHomeDashboard();
    return c.json(homeDashboardSchema.parse(dash));
  });

  app.get('/projects', async (c) => {
    const page = Number(c.req.query('page') ?? '1');
    const pageSize = Number(c.req.query('pageSize') ?? '20');
    const qRaw = c.req.query('q');
    const { items, totalItems } = await service.listProjects({
      page,
      pageSize,
      ...(qRaw ? { q: qRaw } : {}),
    });
    const body = {
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      items,
    };
    return c.json(paginatedSchema(projectSummarySchema).parse(body));
  });

  app.post('/projects', async (c) => {
    try {
      const body = createProjectBodySchema.parse(await c.req.json());
      const created = await service.createProject({
        name: body.name,
        ...(body.netAmount !== undefined ? { netAmount: body.netAmount } : {}),
        ...(body.rebateAmount !== undefined ? { rebateAmount: body.rebateAmount } : {}),
      });
      return c.json(projectSummarySchema.parse(created), 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.get('/projects/:id', async (c) => {
    const project = await service.getProject(c.req.param('id'));
    if (!project) return jsonError(c, 404, 'project not found');
    return c.json(projectSummarySchema.parse(project));
  });

  app.get('/projects/:id/workflow', async (c) => {
    const wf = await service.getWorkflow(c.req.param('id'));
    if (!wf) return jsonError(c, 404, 'workflow not found');
    return c.json(workflowGraphSchema.parse(wf));
  });

  app.post('/projects/:id/nodes/:nodeId/advance', async (c) => {
    try {
      const wf = await service.advanceNode(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) return jsonError(c, 404, err instanceof Error ? err.message : 'error');
      if (status === 409) return jsonError(c, 409, err instanceof Error ? err.message : 'error');
      return jsonError(c, 400, err instanceof Error ? err.message : 'error');
    }
  });

  app.post('/projects/:id/nodes/:nodeId/rollback', async (c) => {
    try {
      const wf = await service.rollbackNode(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) return jsonError(c, 404, err instanceof Error ? err.message : 'error');
      if (status === 409) return jsonError(c, 409, err instanceof Error ? err.message : 'error');
      return jsonError(c, 400, err instanceof Error ? err.message : 'error');
    }
  });

  app.get('/projects/:id/open-items', async (c) => {
    const items = await service.listOpenItems(c.req.param('id'));
    return c.json({ items: items.map((i) => openItemSchema.parse(i)) });
  });

  app.post('/projects/:id/open-items', async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const item = await service.createOpenItem(c.req.param('id'), {
        title: String(body.title ?? ''),
        nextActor: (body.nextActor as 'us' | 'client') ?? 'us',
        ...(body.description ? { description: String(body.description) } : {}),
        ...(body.closeCriteria ? { closeCriteria: String(body.closeCriteria) } : {}),
        ...(body.nextAction ? { nextAction: String(body.nextAction) } : {}),
        ...(body.impact ? { impact: body.impact as 'normal' | 'blocking' } : {}),
        ...(body.blocksNodeId ? { blocksNodeId: String(body.blocksNodeId) } : {}),
      });
      return c.json(openItemSchema.parse(item), 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.post('/projects/:id/publish', async (c) => {
    try {
      const body = publishProjectBodySchema.parse(await c.req.json());
      const result = await service.publishProject(c.req.param('id'), body);
      return c.json(result);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  return app;
}
