/** Build PATCH body for open-item save; explicit null clears nullable FK fields. */
export function buildOpenItemPatchBody(input: {
  title: string;
  description: string;
  closeCriteria: string;
  nextAction: string;
  nextActor: 'us' | 'client';
  impact: 'normal' | 'blocking';
  blocksNodeId: string;
  workflowNodeId: string;
}): Record<string, unknown> {
  return {
    title: input.title.trim(),
    description: input.description.trim() ? input.description.trim() : null,
    closeCriteria: input.closeCriteria.trim() ? input.closeCriteria.trim() : null,
    nextAction: input.nextAction.trim() ? input.nextAction.trim() : null,
    nextActor: input.nextActor,
    impact: input.impact,
    blocksNodeId: input.impact === 'blocking' ? input.blocksNodeId || undefined : null,
    workflowNodeId: input.workflowNodeId ? input.workflowNodeId : null,
  };
}
