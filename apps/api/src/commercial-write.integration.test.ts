import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCommercialOpenItemWriteResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectWorkflow,
  parseCommercialPublishResponse,
  parseCommercialNodeWriteResponse,
  parseCommercialWriteError,
  type CommercialNodeWriteResponse,
  type CommercialWriteErrorBody,
} from '@studio/contracts';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  isPostgresRequiredEnv,
  type Sql,
} from '@studio/db';
import { predecessorRefusalMessage, successorRefusalMessage } from '@studio/workflow';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const DEFAULT_TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';

type App = ReturnType<typeof createApp>;

type Tokens = Map<string, { id: string; updatedAt: string; status: string }>;

describe('commercial workflow write API', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: App | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) {
      if (isPostgresRequiredEnv()) {
        throw new Error('PostgreSQL required in CI but isolated database setup failed');
      }
      return;
    }
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('advance names unmet predecessors, then the join waits on 文案 and 预拍摄', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;

    const blocked = await postNode(ctx.app, projectId, tokens, '汇合节点', 'advance');
    const body = await expectRefusal(blocked, 409, 'predecessors_incomplete', ['文案', '预拍摄']);
    expect(body.error).toBe(predecessorRefusalMessage(['文案', '预拍摄']));
    expect(await statusOf(ctx.sql, projectId, '汇合节点')).toBe('not_reached');
    expect(await auditCount(ctx.sql, projectId, 'advance')).toBe(0);

    await completeThrough(ctx, ['询单', '大纲']);
    const stillBlocked = await postNode(ctx.app, projectId, tokens, '汇合节点', 'advance');
    await expectRefusal(stillBlocked, 409, 'predecessors_incomplete', ['文案', '预拍摄']);

    await completeThrough(ctx, ['文案', '预拍摄']);
    const advanced = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'advance'),
    );
    expect(advanced.node.status).toBe('in_progress');
    expect(advanced.node.name).toBe('汇合节点');
    expect(advanced.node.kind).toBe('merge');
    remember(tokens, advanced);
  }, 30_000);

  test('the join node gates A-roll, B-roll, and AI 后期', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    await completeThrough(ctx, ['询单', '大纲', '文案', '预拍摄']);

    for (const name of ['A-roll 拍摄', 'B-roll 素材', 'AI 后期']) {
      const refused = await postNode(ctx.app, projectId, tokens, name, 'advance');
      const body = await expectRefusal(refused, 409, 'predecessors_incomplete', ['汇合节点']);
      expect(body.error).toBe('须先完成前置节点：汇合节点');
    }

    await completeThrough(ctx, ['汇合节点']);
    for (const name of ['A-roll 拍摄', 'B-roll 素材', 'AI 后期']) {
      const advanced = await mustNode(await postNode(ctx.app, projectId, tokens, name, 'advance'));
      expect(advanced.node.status).toBe('in_progress');
      remember(tokens, advanced);
    }
  }, 30_000);

  test('skipping the optional join lets its successors advance, and passthrough still names upstream', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    await completeThrough(ctx, ['询单', '大纲']);

    const skippedEarly = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'skip'),
    );
    expect(skippedEarly.node.status).toBe('not_applicable');
    remember(tokens, skippedEarly);

    const passed = await postNode(ctx.app, projectId, tokens, 'A-roll 拍摄', 'advance');
    const passedBody = await expectRefusal(passed, 409, 'predecessors_incomplete', [
      '文案',
      '预拍摄',
    ]);
    expect(passedBody.error).toBe(predecessorRefusalMessage(['文案', '预拍摄']));
    expect(passedBody.names).not.toContain('汇合节点');

    await completeThrough(ctx, ['文案', '预拍摄']);
    for (const name of ['A-roll 拍摄', 'B-roll 素材', 'AI 后期']) {
      const advanced = await mustNode(await postNode(ctx.app, projectId, tokens, name, 'advance'));
      expect(advanced.node.status).toBe('in_progress');
      remember(tokens, advanced);
    }
  }, 30_000);

  test('skipping a required node marks it not_applicable and its successors can advance', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens, sql } = ctx;
    const [required] = await sql<{ is_optional: boolean }[]>`
      SELECT is_optional FROM wf_nodes WHERE project_id = ${projectId} AND name = '文案'
    `;
    expect(required?.is_optional).toBe(false);

    await completeThrough(ctx, ['询单', '大纲']);
    const skipped = await mustNode(await postNode(ctx.app, projectId, tokens, '文案', 'skip'));
    expect(skipped.node.status).toBe('not_applicable');
    remember(tokens, skipped);
    const skippedPre = await mustNode(await postNode(ctx.app, projectId, tokens, '预拍摄', 'skip'));
    expect(skippedPre.node.status).toBe('not_applicable');
    remember(tokens, skippedPre);
    expect(await statusOf(sql, projectId, '文案')).toBe('not_applicable');
    expect(await auditCount(sql, projectId, 'skip')).toBe(2);

    const merge = await mustNode(await postNode(ctx.app, projectId, tokens, '汇合节点', 'advance'));
    expect(merge.node.status).toBe('in_progress');
    remember(tokens, merge);
    await completeThrough(ctx, ['汇合节点']);
    const aRoll = await mustNode(
      await postNode(ctx.app, projectId, tokens, 'A-roll 拍摄', 'advance'),
    );
    expect(aRoll.node.status).toBe('in_progress');
    remember(tokens, aRoll);
  }, 30_000);

  test('skipping a completed node is refused and writes nothing', async () => {
    const ctx = await ready();
    if (!ctx) return;
    await completeThrough(ctx, ['询单']);
    const refused = await postNode(ctx.app, ctx.projectId, ctx.tokens, '询单', 'skip');
    const body = await expectRefusal(refused, 409, 'invalid_transition');
    expect(body.error).toBe('已完成的节点不能标记为不适用');
    expect(await statusOf(ctx.sql, ctx.projectId, '询单')).toBe('completed');
    expect(await auditCount(ctx.sql, ctx.projectId, 'skip')).toBe(0);
  }, 30_000);

  test('blocking with an empty reason stores no open item, and lifting restores the previous status', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    const started = await mustNode(await postNode(ctx.app, projectId, tokens, '询单', 'advance'));
    remember(tokens, started);

    const blocked = await mustNode(
      await postNode(ctx.app, projectId, tokens, '询单', 'block', { reason: ' \n\t ' }),
    );
    expect(blocked.node.status).toBe('blocked');
    expect(blocked.node.statusBeforeBlock).toBe('in_progress');
    expect(blocked.blockingReason).toBeNull();
    expect(blocked.pinnedItem).toBeNull();
    expect(JSON.stringify(blocked)).not.toContain('""');
    expect(await openItemCount(ctx.sql, projectId)).toBe(0);
    remember(tokens, blocked);

    const lifted = await mustNode(await postNode(ctx.app, projectId, tokens, '询单', 'unblock'));
    expect(lifted.node.status).toBe('in_progress');
    expect(lifted.node.statusBeforeBlock).toBeNull();
    expect(lifted.blockingReason).toBeNull();
    const [row] = await ctx.sql<{ status: string; status_before_block: string | null }[]>`
      SELECT status, status_before_block FROM wf_nodes WHERE id = ${lifted.node.id}
    `;
    expect(row).toEqual({ status: 'in_progress', status_before_block: null });
  }, 30_000);

  test('closing a pinned blocking item lifts the block', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    const started = await mustNode(await postNode(ctx.app, projectId, tokens, '询单', 'advance'));
    remember(tokens, started);
    const blocked = await mustNode(
      await postNode(ctx.app, projectId, tokens, '询单', 'block', { reason: '  等甲方确认 \n' }),
    );
    expect(blocked.blockingReason).toBe('等甲方确认');
    expect(blocked.pinnedItem?.title).toBe('等甲方确认');
    expect(blocked.node.status).toBe('blocked');
    const pin = blocked.pinnedItem;
    if (!pin) throw new Error('expected a pinned item');
    expect(await openItemCount(ctx.sql, projectId)).toBe(1);

    const closedRes = await ctx.app.request(
      `/api/v1/commercial/projects/${projectId}/open-items/${pin.id}/close`,
      json({ expectedUpdatedAt: pin.updatedAt, closeConclusion: '甲方确认了' }),
    );
    expect(closedRes.status).toBe(200);
    const closed = parseCommercialOpenItemWriteResponse(await closedRes.json());
    expect(closed.item.lifecycle).toBe('closed');
    expect(closed.liftedNodes).toHaveLength(1);
    expect(closed.liftedNodes[0]).toMatchObject({
      id: blocked.node.id,
      status: 'in_progress',
      statusBeforeBlock: null,
      primaryBlockItemId: null,
    });
    expect(await statusOf(ctx.sql, projectId, '询单')).toBe('in_progress');
  }, 30_000);

  test('cancelling a pinned blocking item lifts the block, and a blank cancel reason is a constraint 409', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    const started = await mustNode(await postNode(ctx.app, projectId, tokens, '询单', 'advance'));
    remember(tokens, started);
    const blocked = await mustNode(
      await postNode(ctx.app, projectId, tokens, '询单', 'block', { reason: '等素材' }),
    );
    const pin = blocked.pinnedItem;
    if (!pin) throw new Error('expected a pinned item');

    const blank = await ctx.app.request(
      `/api/v1/commercial/projects/${projectId}/open-items/${pin.id}/cancel`,
      json({ expectedUpdatedAt: pin.updatedAt, cancelReason: '   ' }),
    );
    const blankBody = await expectRefusal(blank, 409, 'constraint_violation');
    expect(blankBody.error).toMatch(/check constraint|open_items_check/i);
    expect(await statusOf(ctx.sql, projectId, '询单')).toBe('blocked');

    const cancelledRes = await ctx.app.request(
      `/api/v1/commercial/projects/${projectId}/open-items/${pin.id}/cancel`,
      json({ expectedUpdatedAt: pin.updatedAt, cancelReason: '不做了' }),
    );
    expect(cancelledRes.status).toBe(200);
    const cancelled = parseCommercialOpenItemWriteResponse(await cancelledRes.json());
    expect(cancelled.item.lifecycle).toBe('cancelled');
    expect(cancelled.item.cancelReason).toBe('不做了');
    expect(cancelled.liftedNodes[0]?.status).toBe('in_progress');
  }, 30_000);

  test('a not_applicable marker cannot carry a primary block item, and clears only while successors are untouched', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    await completeThrough(ctx, ['询单', '大纲', '文案', '预拍摄']);
    const started = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'advance'),
    );
    remember(tokens, started);
    const blocked = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'block', { reason: '等齐' }),
    );
    remember(tokens, blocked);
    const skipRefused = await postNode(ctx.app, projectId, tokens, '汇合节点', 'skip');
    const skipBody = await expectRefusal(skipRefused, 409, 'not_applicable_block');
    expect(skipBody.error).toBe('不适用节点不能挂主阻塞事项');
    expect(await statusOf(ctx.sql, projectId, '汇合节点')).toBe('blocked');

    const lifted = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'unblock'),
    );
    remember(tokens, lifted);
    const rolled = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'rollback'),
    );
    expect(rolled.node.status).toBe('not_reached');
    remember(tokens, rolled);
    const skipped = await mustNode(await postNode(ctx.app, projectId, tokens, '汇合节点', 'skip'));
    expect(skipped.node.status).toBe('not_applicable');
    remember(tokens, skipped);

    const cleared = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'rollback'),
    );
    expect(cleared.node.status).toBe('not_reached');
    remember(tokens, cleared);

    const skippedAgain = await mustNode(
      await postNode(ctx.app, projectId, tokens, '汇合节点', 'skip'),
    );
    remember(tokens, skippedAgain);
    const moved = await mustNode(
      await postNode(ctx.app, projectId, tokens, 'A-roll 拍摄', 'advance'),
    );
    remember(tokens, moved);
    const rollback = await postNode(ctx.app, projectId, tokens, '汇合节点', 'rollback');
    const rollbackBody = await expectRefusal(rollback, 409, 'successors_advanced', ['A-roll 拍摄']);
    expect(rollbackBody.error).toBe(successorRefusalMessage(['A-roll 拍摄']));
    expect(await statusOf(ctx.sql, projectId, '汇合节点')).toBe('not_applicable');
  }, 30_000);

  test('rollback is refused when a successor has moved, and succeeds while successors are untouched', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    await completeThrough(ctx, ['询单']);
    const outline = await mustNode(await postNode(ctx.app, projectId, tokens, '大纲', 'advance'));
    remember(tokens, outline);

    const refused = await postNode(ctx.app, projectId, tokens, '询单', 'rollback');
    const body = await expectRefusal(refused, 409, 'successors_advanced', ['大纲']);
    expect(body.error).toBe(successorRefusalMessage(['大纲']));
    expect(await statusOf(ctx.sql, projectId, '询单')).toBe('completed');

    const rolled = await mustNode(await postNode(ctx.app, projectId, tokens, '大纲', 'rollback'));
    expect(rolled.node.status).toBe('not_reached');
    expect(await statusOf(ctx.sql, projectId, '文案')).toBe('not_reached');
    expect(await statusOf(ctx.sql, projectId, '预拍摄')).toBe('not_reached');
  }, 30_000);

  test('publishing is idempotent and creates one pending metadata job and one pending metrics job', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens } = ctx;
    await completeThrough(ctx, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
      '审核',
    ]);
    const publishNode = await mustNode(
      await postNode(ctx.app, projectId, tokens, '发布', 'advance'),
    );
    remember(tokens, publishNode);
    const staleToken = publishNode.node.updatedAt;

    const completeOnly = await postNode(ctx.app, projectId, tokens, '发布', 'complete');
    const required = await expectRefusal(completeOnly, 400, 'publish_required');
    expect(required.error).toMatch(/发布信息/);

    const firstRes = await postNode(ctx.app, projectId, tokens, '发布', 'publish', {
      idempotencyKey: `publish-${projectId}`,
      platform: 'bilibili',
      bvid: 'BV1writeapi01',
      videoUrl: 'https://www.bilibili.com/video/BV1writeapi01',
      publishSource: 'web',
    });
    expect(firstRes.status).toBe(200);
    const first = parseCommercialPublishResponse(await firstRes.json());
    expect(first.idempotentReplay).toBe(false);
    expect(first.node.status).toBe('completed');
    expect(first.publish).toMatchObject({
      bvid: 'BV1writeapi01',
      platform: 'bilibili',
      publishSource: 'web',
      videoUrl: 'https://www.bilibili.com/video/BV1writeapi01',
    });
    if (!first.monitor) throw new Error('missing monitor');
    expect(first.monitor.metadataTaskStatus).toBe('pending');
    expect(first.monitor.jobs.map((job) => ({ jobType: job.jobType, status: job.status }))).toEqual(
      [
        { jobType: 'metadata', status: 'pending' },
        { jobType: 'metrics', status: 'pending' },
      ],
    );

    const secondRes = await ctx.app.request(
      `/api/v1/commercial/projects/${projectId}/nodes/${publishNode.node.id}/publish`,
      json({
        expectedUpdatedAt: staleToken,
        idempotencyKey: `publish-${projectId}`,
        platform: 'bilibili',
        bvid: 'BV1writeapi01',
      }),
    );
    expect(secondRes.status).toBe(200);
    const second = parseCommercialPublishResponse(await secondRes.json());
    expect(second.idempotentReplay).toBe(true);
    if (!second.monitor) throw new Error('missing monitor');
    expect(second.monitor.contractId).toBe(first.monitor.contractId);
    expect(second.monitor.jobs.map((job) => job.id)).toEqual(
      first.monitor.jobs.map((job) => job.id),
    );

    const jobs = await ctx.sql<
      { job_type: string; status: string; result_json: unknown; retry_count: number }[]
    >`
      SELECT job_type, status, result_json, retry_count
      FROM monitor_jobs
      WHERE project_id = ${projectId}
      ORDER BY job_type
    `;
    expect(
      jobs.map((job) => ({
        job_type: job.job_type,
        status: job.status,
        result_json: job.result_json,
        retry_count: job.retry_count,
      })),
    ).toEqual([
      { job_type: 'metadata', status: 'pending', result_json: null, retry_count: 0 },
      { job_type: 'metrics', status: 'pending', result_json: null, retry_count: 0 },
    ]);
    const [contract] = await ctx.sql<
      {
        bvid: string;
        metadata_task_status: string;
        linked_bvid: string | null;
        metadata_fetched_at: Date | null;
      }[]
    >`
      SELECT bvid, metadata_task_status, linked_bvid, metadata_fetched_at
      FROM project_monitor_contracts
      WHERE project_id = ${projectId}
    `;
    expect(contract).toEqual({
      bvid: 'BV1writeapi01',
      metadata_task_status: 'pending',
      linked_bvid: null,
      metadata_fetched_at: null,
    });
    const [records] = await ctx.sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM project_publish_records WHERE project_id = ${projectId}
    `;
    expect(records?.c).toBe('1');
    const [auditsAfterReplay] = await ctx.sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM domain_audit_events
      WHERE project_id = ${projectId} AND action = 'record'
    `;
    expect(auditsAfterReplay?.c).toBe('1');

    const conflict = await ctx.app.request(
      `/api/v1/commercial/projects/${projectId}/nodes/${publishNode.node.id}/publish`,
      json({
        expectedUpdatedAt: first.node.updatedAt,
        idempotencyKey: `publish-${projectId}-other`,
        platform: 'bilibili',
        bvid: 'BV1writeapi01',
      }),
    );
    await expectRefusal(conflict, 409, 'publish_conflict');
  }, 30_000);

  test('legacy publish endpoint syncs overall_stage to published_winding_down', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens, app, sql } = ctx;
    await completeThrough(ctx, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
      '审核',
    ]);
    const publishNode = await mustNode(await postNode(app, projectId, tokens, '发布', 'advance'));
    remember(tokens, publishNode);

    const [before] = await sql<{ overall_stage: string }[]>`
      SELECT overall_stage FROM commercial_projects WHERE id = ${projectId}
    `;
    expect(before?.overall_stage).toBe('pre_publish');

    const firstRes = await app.request(
      `/api/v1/commercial/projects/${projectId}/nodes/${publishNode.node.id}/publish`,
      json({
        expectedUpdatedAt: publishNode.node.updatedAt,
        idempotencyKey: `stage-sync-${projectId}`,
        platform: 'bilibili',
        bvid: 'BV1stagesync01',
        publishSource: 'web',
      }),
    );
    expect(firstRes.status).toBe(200);
    const first = parseCommercialPublishResponse(await firstRes.json());
    expect(first.idempotentReplay).toBe(false);
    expect(first.node.status).toBe('completed');

    const detailRes = await app.request(`/api/v1/commercial/projects/${projectId}`);
    expect(detailRes.status).toBe(200);
    const detail = parseCommercialProjectDetail(await detailRes.json());
    expect(detail.publish.published).toBe(true);
    expect(detail.publish.bvid).toBe('BV1stagesync01');
    expect(detail.overallStage).toBe('published_winding_down');

    await sql`
      UPDATE commercial_projects
      SET overall_stage = 'pre_publish', updated_at = now()
      WHERE id = ${projectId}
    `;
    const [drifted] = await sql<{ overall_stage: string }[]>`
      SELECT overall_stage FROM commercial_projects WHERE id = ${projectId}
    `;
    expect(drifted?.overall_stage).toBe('pre_publish');

    const replayRes = await app.request(
      `/api/v1/commercial/projects/${projectId}/nodes/${publishNode.node.id}/publish`,
      json({
        expectedUpdatedAt: first.node.updatedAt,
        idempotencyKey: `stage-sync-${projectId}`,
        platform: 'bilibili',
        bvid: 'BV1stagesync01',
      }),
    );
    expect(replayRes.status).toBe(200);
    const replay = parseCommercialPublishResponse(await replayRes.json());
    expect(replay.idempotentReplay).toBe(true);

    const healedRes = await app.request(`/api/v1/commercial/projects/${projectId}`);
    expect(healedRes.status).toBe(200);
    const healed = parseCommercialProjectDetail(await healedRes.json());
    expect(healed.publish.published).toBe(true);
    expect(healed.overallStage).toBe('published_winding_down');
  }, 30_000);

  test('a video URL is stored as bvid and a non-bilibili platform writes nothing', async () => {
    const ctx = await ready();
    if (!ctx) return;
    await completeThrough(ctx, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
      '审核',
    ]);
    const publishNode = await mustNode(
      await postNode(ctx.app, ctx.projectId, ctx.tokens, '发布', 'advance'),
    );
    remember(ctx.tokens, publishNode);

    const wrongPlatform = await postNode(ctx.app, ctx.projectId, ctx.tokens, '发布', 'publish', {
      idempotencyKey: `platform-${ctx.projectId}`,
      platform: 'youtube',
      videoUrl: 'https://www.youtube.com/watch?v=abc',
      bvid: 'BV1notused000',
    });
    await expectRefusal(wrongPlatform, 400, 'unsupported_platform');
    expect(await statusOf(ctx.sql, ctx.projectId, '发布')).toBe('in_progress');
    expect(await openCount(ctx.sql, 'project_publish_records', ctx.projectId)).toBe(0);
    expect(await openCount(ctx.sql, 'monitor_jobs', ctx.projectId)).toBe(0);

    const fromUrl = await postNode(ctx.app, ctx.projectId, ctx.tokens, '发布', 'publish', {
      idempotencyKey: `url-${ctx.projectId}`,
      platform: 'bilibili',
      videoUrl: 'https://www.bilibili.com/video/BV1fromurl001/?spm_id=1',
    });
    expect(fromUrl.status).toBe(200);
    const published = parseCommercialPublishResponse(await fromUrl.json());
    expect(published.publish.bvid).toBe('BV1fromurl001');
    if (!published.monitor) throw new Error('missing monitor');
    expect(published.monitor.bvid).toBe('BV1fromurl001');
    expect(published.monitor.jobs).toHaveLength(2);
  }, 30_000);

  test('a post delivery completes publish without a bvid or monitor contract', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens, app, sql } = ctx;
    await completeThrough(ctx, [
      '询单',
      '大纲',
      '文案',
      '预拍摄',
      '汇合节点',
      'A-roll 拍摄',
      'B-roll 素材',
      'AI 后期',
      '审核',
    ]);
    const publishNode = await mustNode(await postNode(app, projectId, tokens, '发布', 'advance'));
    remember(tokens, publishNode);

    const res = await postNode(app, projectId, tokens, '发布', 'publish', {
      idempotencyKey: `post-${projectId}`,
      platform: 'bilibili',
      contentKind: 'post',
      contentUrl: 'https://t.bilibili.com/1262617308018245635',
    });
    expect(res.status).toBe(200);
    const published = parseCommercialPublishResponse(await res.json());
    expect(published.idempotentReplay).toBe(false);
    expect(published.node.status).toBe('completed');
    expect(published.publish).toMatchObject({
      bvid: null,
      contentKind: 'post',
      contentUrl: 'https://t.bilibili.com/1262617308018245635',
      externalId: '1262617308018245635',
      platform: 'bilibili',
      publishSource: 'web',
    });
    expect(published.monitor).toBeNull();
    expect(await statusOf(sql, projectId, '发布')).toBe('completed');

    const [record] = await sql<
      {
        bvid: string | null;
        content_kind: string;
        content_url: string | null;
        external_id: string | null;
      }[]
    >`
      SELECT bvid, content_kind, content_url, external_id
      FROM project_publish_records
      WHERE project_id = ${projectId}
    `;
    expect(record).toEqual({
      bvid: null,
      content_kind: 'post',
      content_url: 'https://t.bilibili.com/1262617308018245635',
      external_id: '1262617308018245635',
    });
    const [contracts] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM project_monitor_contracts
      WHERE project_id = ${projectId}
    `;
    expect(contracts?.c).toBe('0');
    expect(await openCount(sql, 'monitor_jobs', projectId)).toBe(0);

    const conflict = await postNode(app, projectId, tokens, '发布', 'publish', {
      idempotencyKey: `post-${projectId}-other`,
      platform: 'bilibili',
      contentKind: 'post',
      contentUrl: 'https://t.bilibili.com/1262617308018245636',
    });
    await expectRefusal(conflict, 409, 'publish_conflict');
    expect(await openCount(sql, 'project_publish_records', projectId)).toBe(1);
  }, 30_000);

  test('a stale concurrency token is rejected and does not change the node', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const node = ctx.tokens.get('询单');
    if (!node) throw new Error('missing 询单');
    const stale = await ctx.app.request(
      `/api/v1/commercial/projects/${ctx.projectId}/nodes/${node.id}/advance`,
      json({ expectedUpdatedAt: '2000-01-01T00:00:00.000000Z' }),
    );
    const body = await expectRefusal(stale, 409, 'stale_write');
    expect(body.names).toBeUndefined();
    expect(await statusOf(ctx.sql, ctx.projectId, '询单')).toBe('not_reached');
    expect(await auditCount(ctx.sql, ctx.projectId, 'advance')).toBe(0);

    const ok = await mustNode(
      await postNode(ctx.app, ctx.projectId, ctx.tokens, '询单', 'advance'),
    );
    const again = await ctx.app.request(
      `/api/v1/commercial/projects/${ctx.projectId}/nodes/${node.id}/advance`,
      json({ expectedUpdatedAt: node.updatedAt }),
    );
    await expectRefusal(again, 409, 'stale_write');
    expect(ok.node.updatedAt).not.toBe(node.updatedAt);
    expect(await statusOf(ctx.sql, ctx.projectId, '询单')).toBe('in_progress');
  }, 30_000);

  async function ready(): Promise<{
    app: App;
    sql: Sql;
    projectId: string;
    tokens: Tokens;
  } | null> {
    if (!sql || !app) return null;
    const projectId = await createProject(sql, `write-${crypto.randomUUID()}`);
    const tokens = await loadTokens(app, projectId);
    expect(tokens.size).toBe(14);
    return { app, sql, projectId, tokens };
  }

  test('plan date writes, changes, and clears without touching status or completed_at', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { projectId, tokens, sql: db, app: api } = ctx;
    const before = tokens.get('大纲');
    if (!before) throw new Error('missing 大纲');
    const edgesBefore = await edgePairs(db, projectId);
    const [stampBefore] = await db<
      { status: string; completed_at: Date | null; planned_at: Date | null }[]
    >`
      SELECT status, completed_at, planned_at
      FROM wf_nodes
      WHERE project_id = ${projectId} AND id = ${before.id}
    `;
    expect(stampBefore?.status).toBe('not_reached');
    expect(stampBefore?.completed_at).toBeNull();
    expect(stampBefore?.planned_at).toBeNull();

    const saved = await mustNode(
      await postNode(api, projectId, tokens, '大纲', 'plan', { plannedAt: '2026-04-02' }),
    );
    expect(saved.node.status).toBe('not_reached');
    expect(saved.node.completedAt).toBeNull();
    expect(Date.parse(saved.node.plannedAt ?? '')).toBe(Date.parse('2026-04-02T00:00:00+08:00'));
    expect(saved.node.updatedAt).not.toBe(before.updatedAt);
    remember(tokens, saved);

    const changed = await mustNode(
      await postNode(api, projectId, tokens, '大纲', 'plan', { plannedAt: '2026-04-09' }),
    );
    expect(changed.node.status).toBe('not_reached');
    expect(changed.node.completedAt).toBeNull();
    expect(Date.parse(changed.node.plannedAt ?? '')).toBe(Date.parse('2026-04-09T00:00:00+08:00'));
    remember(tokens, changed);

    const cleared = await mustNode(
      await postNode(api, projectId, tokens, '大纲', 'plan', { plannedAt: null }),
    );
    expect(cleared.node.status).toBe('not_reached');
    expect(cleared.node.plannedAt).toBeNull();
    expect(cleared.node.completedAt).toBeNull();
    remember(tokens, cleared);

    const [afterClear] = await db<
      { status: string; completed_at: Date | null; planned_at: Date | null }[]
    >`
      SELECT status, completed_at, planned_at
      FROM wf_nodes
      WHERE project_id = ${projectId} AND id = ${before.id}
    `;
    expect(afterClear?.status).toBe('not_reached');
    expect(afterClear?.completed_at).toBeNull();
    expect(afterClear?.planned_at).toBeNull();
    expect(await edgePairs(db, projectId)).toEqual(edgesBefore);
    expect(await auditCount(db, projectId, 'plan')).toBe(3);

    const stale = await postNode(api, projectId, tokens, '大纲', 'plan', {
      expectedUpdatedAt: before.updatedAt,
      plannedAt: '2026-05-01',
    });
    await expectRefusal(stale, 409, 'stale_write');
    const [untouched] = await db<{ planned_at: Date | null; status: string }[]>`
      SELECT planned_at, status FROM wf_nodes WHERE id = ${before.id}
    `;
    expect(untouched?.planned_at).toBeNull();
    expect(untouched?.status).toBe('not_reached');

    const invalid = await postNode(api, projectId, tokens, '大纲', 'plan', {
      plannedAt: '2026-04-02T00:00:00.000Z',
    });
    expect(invalid.status).toBe(400);

    const planned = await mustNode(
      await postNode(api, projectId, tokens, '询单', 'plan', { plannedAt: '2026-03-18' }),
    );
    expect(planned.node.status).toBe('not_reached');
    expect(planned.node.completedAt).toBeNull();
    remember(tokens, planned);
    const advanced = await mustNode(await postNode(api, projectId, tokens, '询单', 'advance'));
    expect(advanced.node.status).toBe('in_progress');
    expect(advanced.node.completedAt).toBeNull();
    expect(Date.parse(advanced.node.plannedAt ?? '')).toBe(Date.parse('2026-03-18T00:00:00+08:00'));
    remember(tokens, advanced);
    const completed = await mustNode(await postNode(api, projectId, tokens, '询单', 'complete'));
    expect(completed.node.status).toBe('completed');
    expect(completed.node.completedAt).not.toBeNull();
    expect(Date.parse(completed.node.plannedAt ?? '')).toBe(
      Date.parse('2026-03-18T00:00:00+08:00'),
    );
    const completedAt = completed.node.completedAt;
    remember(tokens, completed);

    const retimed = await mustNode(
      await postNode(api, projectId, tokens, '询单', 'plan', { plannedAt: '2026-03-20' }),
    );
    expect(retimed.node.status).toBe('completed');
    expect(retimed.node.completedAt).toBe(completedAt);
    expect(Date.parse(retimed.node.plannedAt ?? '')).toBe(Date.parse('2026-03-20T00:00:00+08:00'));

    const graph = parseCommercialProjectWorkflow(
      await (await api.request(`/api/v1/commercial/projects/${projectId}/workflow`)).json(),
    );
    const inquiry = graph.nodes.find((node) => node.name === '询单');
    const outline = graph.nodes.find((node) => node.name === '大纲');
    expect(inquiry?.status).toBe('completed');
    expect(inquiry?.completedAt).toBe(completedAt);
    expect(Date.parse(inquiry?.plannedAt ?? '')).toBe(Date.parse('2026-03-20T00:00:00+08:00'));
    expect(outline?.plannedAt).toBeNull();
    expect(outline?.completedAt).toBeNull();
    expect(outline?.status).toBe('not_reached');
  }, 30_000);

  test('project-level open items accept third_party, reject duplicates, and edit under a token', async () => {
    const ctx = await ready();
    if (!ctx) return;
    const { app: api, projectId } = ctx;
    const collection = `/api/v1/commercial/projects/${projectId}/open-items`;

    const createdRes = await api.request(
      collection,
      json({
        title: '  甲方未寄样品  ',
        nextActor: 'third_party',
        impact: 'blocking',
        dueAt: '2026-11-01T00:00:00.000Z',
        note: '  等样机  ',
      }),
    );
    expect(createdRes.status).toBe(201);
    const created = parseCommercialOpenItemWriteResponse(await createdRes.json());
    expect(created.item).toMatchObject({
      title: '甲方未寄样品',
      nextActor: 'third_party',
      impact: 'blocking',
      lifecycle: 'open',
      note: '等样机',
    });
    expect(Date.parse(created.item.dueAt ?? '')).toBe(Date.parse('2026-11-01T00:00:00.000Z'));
    expect(created.liftedNodes).toEqual([]);

    const detailRes = await api.request(`/api/v1/commercial/projects/${projectId}`);
    expect(detailRes.status).toBe(200);
    const detail = parseCommercialProjectDetail(await detailRes.json());
    expect(detail.openItems.find((item) => item.id === created.item.id)).toMatchObject({
      title: '甲方未寄样品',
      nextActor: 'third_party',
      impact: 'blocking',
      lifecycle: 'open',
      description: '等样机',
    });

    await expectRefusal(
      await api.request(
        collection,
        json({ title: '甲方未寄样品', nextActor: 'us', impact: 'normal' }),
      ),
      409,
      'duplicate_open_item',
    );

    const updatedRes = await api.request(`${collection}/${created.item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: created.item.updatedAt,
        title: '甲方已寄样品',
        nextActor: 'client',
      }),
    });
    expect(updatedRes.status).toBe(200);
    const updated = parseCommercialOpenItemWriteResponse(await updatedRes.json());
    expect(updated.item).toMatchObject({
      title: '甲方已寄样品',
      nextActor: 'client',
      impact: 'blocking',
      lifecycle: 'open',
      note: '等样机',
    });
    expect(updated.item.dueAt).toBe(created.item.dueAt);

    await expectRefusal(
      await api.request(`${collection}/${created.item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedUpdatedAt: created.item.updatedAt,
          title: '过期令牌',
        }),
      }),
      409,
      'stale_write',
    );

    const closedRes = await api.request(
      `${collection}/${created.item.id}/close`,
      json({ expectedUpdatedAt: updated.item.updatedAt }),
    );
    expect(closedRes.status).toBe(200);
    const closed = parseCommercialOpenItemWriteResponse(await closedRes.json());
    expect(closed.item.lifecycle).toBe('closed');

    await expectRefusal(
      await api.request(`${collection}/${created.item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedUpdatedAt: closed.item.updatedAt,
          title: '改已关闭卡点',
        }),
      }),
      409,
      'item_closed',
    );
  }, 30_000);
});

async function createProject(sql: Sql, name: string): Promise<string> {
  const projectId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  await sql`
    INSERT INTO commercial_projects (id, name) VALUES (${projectId}, ${name})
  `;
  await sql`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE})
  `;
  const packages = await sql<{ id: string; name: string; sort_order: number }[]>`
    SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const packageMap = new Map<string, string>();
  for (const pkg of packages) {
    const id = crypto.randomUUID();
    packageMap.set(pkg.id, id);
    await sql`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${id}, ${workflowId}, ${pkg.name}, ${pkg.sort_order})
    `;
  }
  const nodes = await sql<
    {
      id: string;
      name: string;
      kind: string;
      phase: string;
      is_optional: boolean;
      pos_x: number;
      pos_y: number;
      package_id: string | null;
    }[]
  >`
    SELECT id, name, kind, phase, is_optional, pos_x, pos_y, package_id
    FROM wf_template_nodes
    WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    const id = crypto.randomUUID();
    nodeMap.set(node.id, id);
    const packageId = node.package_id ? (packageMap.get(node.package_id) ?? null) : null;
    await sql`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, template_node_id, package_id,
        name, kind, phase, status, is_optional, pos_x, pos_y, source
      ) VALUES (
        ${id}, ${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE}, ${node.id}, ${packageId},
        ${node.name}, ${node.kind}, ${node.phase}, 'not_reached', ${node.is_optional},
        ${node.pos_x}, ${node.pos_y}, 'template'
      )
    `;
  }
  const edges = await sql<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  for (const edge of edges) {
    const fromId = nodeMap.get(edge.from_node_id);
    const toId = nodeMap.get(edge.to_node_id);
    if (!fromId || !toId) throw new Error('template edge endpoint missing');
    await sql`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${crypto.randomUUID()}, ${workflowId}, ${fromId}, ${toId})
    `;
  }
  return projectId;
}

async function loadTokens(app: App, projectId: string): Promise<Tokens> {
  const res = await app.request(`/api/v1/commercial/projects/${projectId}/workflow`);
  expect(res.status).toBe(200);
  const graph = parseCommercialProjectWorkflow(await res.json());
  return new Map(graph.nodes.map((node) => [node.name, node]));
}

function remember(tokens: Tokens, body: CommercialNodeWriteResponse): void {
  tokens.set(body.node.name, {
    id: body.node.id,
    updatedAt: body.node.updatedAt,
    status: body.node.status,
  });
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function postNode(
  app: App,
  projectId: string,
  tokens: Tokens,
  name: string,
  action: 'advance' | 'complete' | 'skip' | 'rollback' | 'block' | 'unblock' | 'publish' | 'plan',
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const node = tokens.get(name);
  if (!node) throw new Error(`missing node ${name}`);
  return app.request(
    `/api/v1/commercial/projects/${projectId}/nodes/${node.id}/${action}`,
    json({ expectedUpdatedAt: node.updatedAt, ...extra }),
  );
}

async function mustNode(res: Response): Promise<CommercialNodeWriteResponse> {
  const jsonBody: unknown = await res.json();
  if (res.status !== 200) {
    throw new Error(`${res.status} ${JSON.stringify(jsonBody)}`);
  }
  const parsed = parseCommercialNodeWriteResponse(jsonBody);
  return parsed;
}

async function expectRefusal(
  res: Response,
  status: number,
  code: CommercialWriteErrorBody['code'],
  names?: string[],
): Promise<CommercialWriteErrorBody> {
  const jsonBody: unknown = await res.json();
  expect(res.status, JSON.stringify(jsonBody)).toBe(status);
  const body = parseCommercialWriteError(jsonBody);
  expect(body.code).toBe(code);
  if (names) expect(body.names).toEqual(names);
  return body;
}

async function completeThrough(
  ctx: { app: App; projectId: string; tokens: Tokens },
  names: string[],
): Promise<void> {
  for (const name of names) {
    const current = ctx.tokens.get(name);
    if (!current) throw new Error(`missing node ${name}`);
    if (current.status === 'not_reached') {
      const advanced = await mustNode(
        await postNode(ctx.app, ctx.projectId, ctx.tokens, name, 'advance'),
      );
      remember(ctx.tokens, advanced);
    }
    if (ctx.tokens.get(name)?.status === 'in_progress') {
      const completed = await mustNode(
        await postNode(ctx.app, ctx.projectId, ctx.tokens, name, 'complete'),
      );
      expect(completed.node.status).toBe('completed');
      remember(ctx.tokens, completed);
    }
  }
}

async function edgePairs(sql: Sql, projectId: string): Promise<string[]> {
  const rows = await sql<{ pair: string }[]>`
    SELECT e.from_node_id || '>' || e.to_node_id AS pair
    FROM wf_edges e
    JOIN project_workflows w ON w.id = e.workflow_id
    WHERE w.project_id = ${projectId}
    ORDER BY pair
  `;
  return rows.map((row) => row.pair);
}

async function statusOf(sql: Sql, projectId: string, name: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM wf_nodes WHERE project_id = ${projectId} AND name = ${name}
  `;
  if (!row) throw new Error(`missing ${name}`);
  return row.status;
}

async function auditCount(sql: Sql, projectId: string, action: string): Promise<number> {
  const [row] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c
    FROM domain_audit_events
    WHERE project_id = ${projectId} AND action = ${action}
  `;
  return Number(row?.c ?? 0);
}

async function openItemCount(sql: Sql, projectId: string): Promise<number> {
  return openCount(sql, 'open_items', projectId);
}

async function openCount(
  sql: Sql,
  table: 'open_items' | 'project_publish_records' | 'monitor_jobs',
  projectId: string,
): Promise<number> {
  if (table === 'open_items') {
    const [row] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM open_items WHERE project_id = ${projectId}
    `;
    return Number(row?.c ?? 0);
  }
  if (table === 'project_publish_records') {
    const [row] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM project_publish_records WHERE project_id = ${projectId}
    `;
    return Number(row?.c ?? 0);
  }
  const [row] = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c FROM monitor_jobs WHERE project_id = ${projectId}
  `;
  return Number(row?.c ?? 0);
}
