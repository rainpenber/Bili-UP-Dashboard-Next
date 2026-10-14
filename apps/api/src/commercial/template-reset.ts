import type { Db } from './graph-io';
import { validateTemplateGraphTx } from './template-engine';

/** Reset may only target a published version of the same template slug (family) as the project workflow. */
export async function assertResetTemplateVersionAllowed(
  tx: Db,
  projectId: string,
  templateVersionId: string,
) {
  const target = await tx<{ id: string; slug: string; is_draft: boolean }[]>`
    SELECT id, slug, is_draft FROM wf_template_versions WHERE id = ${templateVersionId}
  `;
  if (!target[0]) {
    throw Object.assign(new Error('所选模板版本不存在'), { status: 404 });
  }
  if (target[0].is_draft) {
    throw Object.assign(new Error('不能将项目重置到草稿模板版本'), { status: 409 });
  }
  const current = await tx<{ slug: string }[]>`
    SELECT tv.slug
    FROM project_workflows pw
    INNER JOIN wf_template_versions tv ON tv.id = pw.template_version_id
    WHERE pw.project_id = ${projectId}
  `;
  if (!current[0]) {
    throw Object.assign(new Error('项目工作流不存在'), { status: 404 });
  }
  if (target[0].slug !== current[0].slug) {
    throw Object.assign(new Error('不能切换到无关模板族（slug 不一致）'), { status: 409 });
  }
  await validateTemplateGraphTx(tx, templateVersionId);
}
