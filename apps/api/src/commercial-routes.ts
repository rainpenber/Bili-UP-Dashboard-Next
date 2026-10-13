import {
  createGraphEdgeBodySchema,
  createGraphNodeBodySchema,
  createOpenItemBodySchema,
  createProjectBodySchema,
  hermesWriteBodySchema,
  homeDashboardSchema,
  openItemSchema,
  patchOpenItemBodySchema,
  projectDetailSchema,
  projectListGroupedSchema,
  publishProjectBodySchema,
  publishResultSchema,
  updateGraphNodeBodySchema,
  workflowGraphSchema,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import { Hono } from 'hono';
import { jsonError } from './api-error';
import { CommercialEngine } from './commercial/engine';
import { TemplateEngine } from './commercial/template-engine';
import { acceptHermesProposal, rejectHermesProposal } from './commercial/hermes';

export function createCommercialRoutes(db: Sql) {
  const app = new Hono();
  const engine = new CommercialEngine(db);
  const templates = new TemplateEngine(db);

  app.get('/home', async (c) => {
    return c.json(homeDashboardSchema.parse(await engine.getHomeDashboard()));
  });

  app.get('/projects/grouped', async (c) => {
    const q = c.req.query('q');
    const dateFrom = c.req.query('dateFrom');
    const dateTo = c.req.query('dateTo');
    const body = await engine.listProjectsGrouped({
      ...(q ? { q } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    });
    return c.json(projectListGroupedSchema.parse(body));
  });

  app.post('/projects', async (c) => {
    try {
      const body = createProjectBodySchema.parse(await c.req.json());
      const created = await engine.createProject({
        name: body.name,
        ...(body.netAmount !== undefined ? { netAmount: body.netAmount } : {}),
        ...(body.rebateAmount !== undefined ? { rebateAmount: body.rebateAmount } : {}),
      });
      return c.json(projectDetailSchema.parse(created), 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.get('/projects/:id', async (c) => {
    const project = await engine.getProjectDetail(c.req.param('id'));
    if (!project) return jsonError(c, 404, 'project not found');
    return c.json(projectDetailSchema.parse(project));
  });

  app.get('/projects/:id/workflow', async (c) => {
    const wf = await engine.getWorkflow(c.req.param('id'));
    if (!wf) return jsonError(c, 404, 'workflow not found');
    return c.json(workflowGraphSchema.parse(wf));
  });

  app.post('/projects/:id/nodes/:nodeId/advance-to', async (c) => {
    try {
      const wf = await engine.advanceToNode(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/nodes/:nodeId/complete', async (c) => {
    try {
      const wf = await engine.completeNode(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/nodes/:nodeId/rollback', async (c) => {
    try {
      const wf = await engine.rollbackNode(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/nodes/:nodeId/not-applicable', async (c) => {
    try {
      const wf = await engine.markNodeNotApplicable(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/nodes', async (c) => {
    try {
      const body = createGraphNodeBodySchema.parse(await c.req.json());
      const wf = await engine.createGraphNode(c.req.param('id'), {
        name: body.name,
        posX: body.posX,
        posY: body.posY,
        ...(body.phase ? { phase: body.phase } : {}),
      });
      return c.json(workflowGraphSchema.parse(wf), 201);
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.patch('/projects/:id/nodes/:nodeId', async (c) => {
    try {
      const body = updateGraphNodeBodySchema.parse(await c.req.json());
      const wf = await engine.updateGraphNode(c.req.param('id'), c.req.param('nodeId'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.posX !== undefined ? { posX: body.posX } : {}),
        ...(body.posY !== undefined ? { posY: body.posY } : {}),
        ...(body.plannedAt !== undefined ? { plannedAt: body.plannedAt } : {}),
      });
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.delete('/projects/:id/nodes/:nodeId', async (c) => {
    try {
      const wf = await engine.deleteGraphNode(c.req.param('id'), c.req.param('nodeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/edges', async (c) => {
    try {
      const body = createGraphEdgeBodySchema.parse(await c.req.json());
      const wf = await engine.createGraphEdge(c.req.param('id'), body.fromNodeId, body.toNodeId);
      return c.json(workflowGraphSchema.parse(wf), 201);
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.delete('/projects/:id/edges/:edgeId', async (c) => {
    try {
      const wf = await engine.deleteGraphEdge(c.req.param('id'), c.req.param('edgeId'));
      return c.json(workflowGraphSchema.parse(wf));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.get('/projects/:id/open-items', async (c) => {
    const items = await engine.listOpenItems(c.req.param('id'));
    return c.json({ items: items.map((i) => openItemSchema.parse(i)) });
  });

  app.post('/projects/:id/open-items', async (c) => {
    try {
      const body = createOpenItemBodySchema.parse(await c.req.json());
      const item = await engine.createOpenItem(c.req.param('id'), body);
      return c.json(openItemSchema.parse(item), 201);
    } catch (err) {
      return jsonError(c, 400, err instanceof Error ? err.message : 'bad request');
    }
  });

  app.patch('/projects/:id/open-items/:itemId', async (c) => {
    try {
      const body = patchOpenItemBodySchema.parse(await c.req.json());
      const item = await engine.patchOpenItem(c.req.param('id'), c.req.param('itemId'), body);
      return c.json(openItemSchema.parse(item));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/open-items/:itemId/close', async (c) => {
    try {
      const body = (await c.req.json()) as { conclusion?: string };
      const item = await engine.closeOpenItem(
        c.req.param('id'),
        c.req.param('itemId'),
        body.conclusion ?? '',
      );
      return c.json(openItemSchema.parse(item));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/open-items/:itemId/cancel', async (c) => {
    try {
      const item = await engine.cancelOpenItem(c.req.param('id'), c.req.param('itemId'));
      return c.json(openItemSchema.parse(item));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/projects/:id/publish', async (c) => {
    try {
      const body = publishProjectBodySchema.parse(await c.req.json());
      const result = await engine.publishProject(c.req.param('id'), body);
      return c.json(publishResultSchema.parse(result));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/hermes/write', async (c) => {
    try {
      const body = hermesWriteBodySchema.parse(await c.req.json());
      return c.json(await engine.runHermes(body));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.get('/hermes/proposals/:id', async (c) => {
    const rows = await db<
      { id: string; status: string; operation: string; payload: unknown; confidence: number }[]
    >`SELECT id, status, operation, payload, confidence FROM hermes_write_proposals WHERE id = ${c.req.param('id')}`;
    if (!rows[0]) return jsonError(c, 404, 'proposal not found');
    return c.json(rows[0]);
  });

  app.post('/hermes/proposals/:id/accept', async (c) => {
    try {
      return c.json(await acceptHermesProposal(engine, c.req.param('id')));
    } catch (err) {
      return routeErr(c, err);
    }
  });

  app.post('/hermes/proposals/:id/reject', async (c) => {
    const body = (await c.req.json()) as { reason?: string };
    return c.json(await rejectHermesProposal(engine, c.req.param('id'), body.reason ?? ''));
  });

  app.get('/templates/versions', async (c) => c.json({ items: await templates.listVersions() }));

  app.get('/templates/versions/:id/graph', async (c) =>
    c.json(await templates.getTemplateGraph(c.req.param('id'))),
  );

  app.post('/templates/draft-from-default', async (c) =>
    c.json(await templates.createDraftFromDefault()),
  );

  app.post('/templates/versions/:id/publish', async (c) =>
    c.json(await templates.publishDraft(c.req.param('id'))),
  );

  app.post('/templates/versions/:id/edges', async (c) => {
    const body = createGraphEdgeBodySchema.parse(await c.req.json());
    await templates.addTemplateEdge(c.req.param('id'), body.fromNodeId, body.toNodeId);
    return c.json(await templates.getTemplateGraph(c.req.param('id')));
  });

  app.post('/projects/:id/open-items/:itemId/pin-primary-block', async (c) => {
    const itemId = c.req.param('itemId');
    const projectId = c.req.param('id');
    await db`
      UPDATE wf_nodes n SET primary_block_pinned_item_id = ${itemId}
      FROM open_items o
      WHERE o.id = ${itemId} AND o.project_id = ${projectId} AND o.blocks_node_id = n.id
    `;
    return c.json({ ok: true });
  });

  return app;
}

function routeErr(c: Parameters<typeof jsonError>[0], err: unknown) {
  const status = (err as Error & { status?: number }).status;
  if (status === 404) return jsonError(c, 404, err instanceof Error ? err.message : 'error');
  if (status === 409) return jsonError(c, 409, err instanceof Error ? err.message : 'error');
  return jsonError(c, 400, err instanceof Error ? err.message : 'error');
}
