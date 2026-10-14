import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  seedCommercialFixtures,
} from '@studio/db';
import type { createSql } from '@studio/db';
import { TemplateEngine } from './commercial/template-engine';

describe('template engine integration', () => {
  let sql: ReturnType<typeof createSql> | null = null;
  let isolatedDbName: string | null = null;
  let templates: TemplateEngine;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    sql = isolated.sql;
    isolatedDbName = isolated.databaseName;
    await seedCommercialFixtures(sql);
    templates = new TemplateEngine(sql);
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (isolatedDbName) await dropIsolatedTestDatabase(isolatedDbName);
  });

  test('publishDraft clears default only within same template slug', async () => {
    if (!sql) return;
    const partnerId = '22222222-2222-4222-8222-222222222222';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_default, is_draft, published_at)
      VALUES (${partnerId}, 'partner_flow', '合作方流程', 1, TRUE, FALSE, now())
      ON CONFLICT (id) DO NOTHING
    `;
    const partnerDefaultBefore = await sql<{ is_default: boolean }[]>`
      SELECT is_default FROM wf_template_versions WHERE id = ${partnerId}
    `;
    expect(partnerDefaultBefore[0]?.is_default).toBe(true);

    const { draftId } = await templates.createDraftFromDefault();
    await templates.publishDraft(draftId);

    const partnerAfter = await sql<{ is_default: boolean }[]>`
      SELECT is_default FROM wf_template_versions WHERE id = ${partnerId}
    `;
    expect(partnerAfter[0]?.is_default).toBe(true);

    const sponsorshipDefault = await sql<{ id: string; is_default: boolean; slug: string }[]>`
      SELECT id, is_default, slug FROM wf_template_versions
      WHERE slug = 'default_sponsorship' AND is_default = TRUE
    `;
    expect(sponsorshipDefault.length).toBe(1);
    expect(sponsorshipDefault[0]?.id).toBe(draftId);
  });

  test('template graph exposes undo/redo availability', async () => {
    if (!sql) return;
    const { draftId } = await templates.createDraftFromDefault();
    const empty = await templates.getTemplateGraph(draftId);
    expect(empty.canUndo).toBe(false);
    expect(empty.canRedo).toBe(false);
    await templates.upsertTemplateNode(
      draftId,
      {
        name: 'Undo 测试节点',
        slug: `undo_test_${Date.now()}`,
        phase: 'pre_publish',
        posX: 0,
        posY: 0,
      },
      { recordUndo: true },
    );
    const after = await templates.getTemplateGraph(draftId);
    expect(after.canUndo).toBe(true);
  });
});
