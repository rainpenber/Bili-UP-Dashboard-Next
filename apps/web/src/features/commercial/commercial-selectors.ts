import type { CommercialProjectListItem } from '@studio/contracts';
import { filterCommercialProjects, sortCommercialProjects } from './commercial-view';

export {
  blockedProjects,
  filterCommercialProjects,
  formatMoney,
  movingProjects,
  overallStageLabel,
  sortCommercialProjects,
  stageSummary,
} from './commercial-view';

export function listProjects(items: readonly CommercialProjectListItem[], keyword: string) {
  return sortCommercialProjects(filterCommercialProjects(items, keyword));
}
