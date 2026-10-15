import { BaseEdge, type EdgeProps } from '@xyflow/react';
import type { WorkflowRoutedEdgeData } from '../workflow-graph-edge-routing';

export type WorkflowRoutedEdgeType = WorkflowRoutedEdgeData;

export function WorkflowRoutedEdge(props: EdgeProps) {
  const { id, style, markerEnd, interactionWidth } = props;
  const path = (props.data as WorkflowRoutedEdgeData | undefined)?.path ?? 'M 0 0 L 0 0';
  return (
    <BaseEdge
      id={id}
      path={path}
      {...(style ? { style } : {})}
      {...(markerEnd ? { markerEnd } : {})}
      interactionWidth={interactionWidth ?? 8}
    />
  );
}
