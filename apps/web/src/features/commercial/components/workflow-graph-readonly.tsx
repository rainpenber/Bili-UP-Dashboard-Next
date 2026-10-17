import { useMemo } from 'react';
import type { WorkflowGraph } from '../types';
import { workflowGraphToLive } from '../workflow-live-graph';
import { WorkflowLiveCanvas } from './workflow-live-canvas';

export function WorkflowGraphReadonly({ graph }: { graph: WorkflowGraph }) {
  const live = useMemo(() => workflowGraphToLive(graph), [graph]);
  return <WorkflowLiveCanvas nodes={live.nodes} edges={live.edges} label="流程" readOnly />;
}
