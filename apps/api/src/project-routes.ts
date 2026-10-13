import {
  createOpenItemBodySchema,
  createProjectBodySchema,
  dashboardTodayResponseSchema,
  hermesChangeProposalSchema,
  hermesProposalBodySchema,
  hermesRejectBodySchema,
  openItemSchema,
  openItemsListResponseSchema,
  parseWithSchema,
  patchOpenItemBodySchema,
  patchProjectBodySchema,
  patchWorkflowNodeBodySchema,
  projectListQuerySchema,
  projectPaginatedResponseSchema,
  projectSummarySchema,
  projectWorkflowResponseSchema,
  teamMembersResponseSchema,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { jsonError } from './api-error';
import { ProjectService } from './project-service';

function jsonValidated<T>(
  c: Context,
  schema: { parse: (v: unknown) => T },
  data: T,
  status: 200 | 201 = 200,
) {
  return c.json(schema.parse(data), status);
}

export function createProjectRoutes(db: Sql) {
  const app = new Hono();
  const service = new ProjectService(db);

  app.get('/team-members', async (c) => {
    const members = await service.listTeamMembers();
    return jsonValidated(c, teamMembersResponseSchema, { items: members });
  });

  app.get('/', async (c) => {
    try {
      const query = projectListQuerySchema.parse({
        page: c.req.query('page'),
        pageSize: c.req.query('pageSize'),
        stage: c.req.query('stage'),
        ownerId: c.req.query('ownerId'),
        risk: c.req.query('risk'),
        dueBefore: c.req.query('dueBefore'),
        includeArchived: c.req.query('includeArchived'),
      });
      const { items, totalItems } = await service.listProjects(query);
      const body = {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
        items,
      };
      return jsonValidated(c, projectPaginatedResponseSchema, body);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.post('/', async (c) => {
    try {
      const body = parseWithSchema(createProjectBodySchema, await c.req.json());
      const created = await service.createProject({
        name: body.name,
        ...(body.brand !== undefined ? { brand: body.brand } : {}),
        ...(body.product !== undefined ? { product: body.product } : {}),
        ...(body.cooperationType !== undefined ? { cooperationType: body.cooperationType } : {}),
        ...(body.plannedPublishAt !== undefined ? { plannedPublishAt: body.plannedPublishAt } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.sourceStatus !== undefined ? { sourceStatus: body.sourceStatus } : {}),
      });
      return jsonValidated(c, projectSummarySchema, created, 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.get('/:id', async (c) => {
    const project = await service.getProject(c.req.param('id'));
    if (!project) return jsonError(c, 404, 'project not found');
    return jsonValidated(c, projectSummarySchema, project);
  });

  app.patch('/:id', async (c) => {
    try {
      const body = parseWithSchema(patchProjectBodySchema, await c.req.json());
      const updated = await service.patchProject(c.req.param('id'), body);
      if (!updated) return jsonError(c, 404, 'project not found');
      return jsonValidated(c, projectSummarySchema, updated);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.post('/:id/archive', async (c) => {
    const updated = await service.archiveProject(c.req.param('id'));
    if (!updated) return jsonError(c, 404, 'project not found');
    return jsonValidated(c, projectSummarySchema, updated);
  });

  app.post('/:id/restore', async (c) => {
    const updated = await service.restoreProject(c.req.param('id'));
    if (!updated) return jsonError(c, 404, 'project not found');
    return jsonValidated(c, projectSummarySchema, updated);
  });

  app.get('/:id/workflow', async (c) => {
    const wf = await service.getWorkflow(c.req.param('id'));
    if (!wf) return jsonError(c, 404, 'workflow not found');
    return jsonValidated(c, projectWorkflowResponseSchema, wf);
  });

  app.patch('/:id/workflow/nodes/:nodeId', async (c) => {
    try {
      const body = parseWithSchema(patchWorkflowNodeBodySchema, await c.req.json());
      const wf = await service.patchWorkflowNode(c.req.param('id'), c.req.param('nodeId'), body);
      if (!wf) return jsonError(c, 404, 'node not found');
      return jsonValidated(c, projectWorkflowResponseSchema, wf);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409) {
        return jsonError(c, 409, err instanceof Error ? err.message : 'conflict');
      }
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.get('/:id/workflow/nodes/:nodeId/downstream', async (c) => {
    const ids = await service.getDownstreamNodes(c.req.param('id'), c.req.param('nodeId'));
    return c.json({ nodeIds: ids });
  });

  app.get('/:id/open-items', async (c) => {
    const project = await service.getProject(c.req.param('id'));
    if (!project) return jsonError(c, 404, 'project not found');
    const items = await service.listOpenItems(c.req.param('id'));
    return jsonValidated(c, openItemsListResponseSchema, { items });
  });

  app.post('/:id/open-items', async (c) => {
    try {
      const body = parseWithSchema(createOpenItemBodySchema, await c.req.json());
      const project = await service.getProject(c.req.param('id'));
      if (!project) return jsonError(c, 404, 'project not found');
      const item = await service.createOpenItem(c.req.param('id'), body);
      return jsonValidated(c, openItemSchema, item, 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.patch('/:id/open-items/:itemId', async (c) => {
    try {
      const body = parseWithSchema(patchOpenItemBodySchema, await c.req.json());
      const item = await service.patchOpenItem(c.req.param('id'), c.req.param('itemId'), body);
      if (!item) return jsonError(c, 404, 'open item not found');
      return jsonValidated(c, openItemSchema, item);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  return app;
}

export function createDashboardRoutes(db: Sql) {
  const app = new Hono();
  const service = new ProjectService(db);
  app.get('/today', async (c) => {
    const ref = c.req.query('referenceNow');
    const dashboard = await service.buildDashboard(ref ? new Date(ref) : undefined);
    return jsonValidated(c, dashboardTodayResponseSchema, dashboard);
  });
  return app;
}

export function createHermesRoutes(db: Sql) {
  const app = new Hono();
  const service = new ProjectService(db);

  app.post('/change-proposals', async (c) => {
    try {
      const body = parseWithSchema(hermesProposalBodySchema, await c.req.json());
      const proposal = await service.createHermesProposal({
        projectId: body.projectId,
        idempotencyKey: body.idempotencyKey,
        suggestedAction: body.suggestedAction,
        payload: body.payload,
        confidence: body.confidence ?? 0,
        ...(body.sourceEvidence !== undefined ? { sourceEvidence: body.sourceEvidence } : {}),
      });
      return jsonValidated(c, hermesChangeProposalSchema, proposal, 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.post('/change-proposals/:id/accept', async (c) => {
    try {
      const proposal = await service.acceptHermesProposal(c.req.param('id'));
      if (!proposal) return jsonError(c, 404, 'proposal not found');
      return jsonValidated(c, hermesChangeProposalSchema, proposal);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 400) {
        return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
      }
      throw err;
    }
  });

  app.post('/change-proposals/:id/reject', async (c) => {
    try {
      const body = parseWithSchema(hermesRejectBodySchema, await c.req.json());
      const proposal = await service.rejectHermesProposal(c.req.param('id'), body.reason);
      if (!proposal) return jsonError(c, 404, 'proposal not found');
      return jsonValidated(c, hermesChangeProposalSchema, proposal);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  return app;
}
