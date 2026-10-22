import { cuesToCsv, type SubtitleCue } from './subtitle';

/** 表单字段 → 模板占位符 */
export type TemplateVars = {
  product: string;
  category: string;
  positioning: string;
  reference_comments: string;
  subtitle_csv: string;
};

export function buildSubtitleCsv(cues: SubtitleCue[]): string {
  return cuesToCsv(cues, { includeHeader: true });
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function applyTemplate(template: string, vars: Partial<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (_, key: string) => vars[key] ?? '');
}
