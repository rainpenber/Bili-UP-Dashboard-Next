import type { ProjectSummary } from '@studio/contracts';

export const STAGE_LABELS: Record<ProjectSummary['derivedStage'], string> = {
  business_init: '商务与立项',
  outline: '大纲',
  copywriting: '文案',
  production: '制作',
  review: '审核',
  publish: '发布',
  go_live_monitoring: '上线监控',
  settlement: '结算与资产收尾',
  completed: '已完成',
};

export function stageLabel(stage: ProjectSummary['derivedStage']): string {
  return STAGE_LABELS[stage] ?? stage;
}
