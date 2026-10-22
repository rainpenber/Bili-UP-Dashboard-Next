import { cuesToCsv, type SubtitleCue } from './subtitle';

/** 表单字段 → 模板占位符 */
export type TemplateVars = {
  product: string;
  category: string;
  positioning: string;
  reference_comments: string;
  subtitle_csv: string;
};

/** 组合结果前置说明（不改动用户模板正文）；须含内部模拟标识供复制给 AI */
export const INTERNAL_SIMULATION_NOTICE =
  '【内部评估说明】以下提示词仅用于工作室内部模拟与内容审核；生成内容为虚构观众反应，不是真实观众数据，不得用于冒充真实互动或自动向任何平台发布。';

export function buildSubtitleCsv(cues: SubtitleCue[]): string {
  return cuesToCsv(cues, { includeHeader: true });
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function applyTemplate(template: string, vars: Partial<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (_, key: string) => vars[key] ?? '');
}

/** 在模板插值结果前附加内部评估说明；原模板与占位符不变 */
export function composePrompt(template: string, vars: Partial<Record<string, string>>): string {
  return `${INTERNAL_SIMULATION_NOTICE}\n\n${applyTemplate(template, vars)}`;
}
