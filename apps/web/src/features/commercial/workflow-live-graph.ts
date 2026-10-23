import {
  COMMERCIAL_WORKFLOW_NODE_NAME_MAX,
  type CommercialDefaultTemplate,
  type CommercialProjectWorkflow,
} from '@studio/contracts';
import { layoutWithDagre, type FlowDirection } from '../workflow-mock/layout';
import type { FlowGraph } from '../workflow-mock/model';
import { indexWorkflowNodes } from './workflow-edit-logic';
import { JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID } from './workflow-graph-junctions';
import { listWorkflowConnections } from './workflow-structure-logic';
import type { WorkflowConnection, WorkflowGraph } from './types';

export type LiveGraphNode = {
  id: string;
  name: string;
  kind: 'stage' | 'merge';
  /** Raw workflow status. Omitted on template rows, which have no instance status. */
  status?: string;
  /**
   * Instance rows keep null when the workflow response has no reason.
   * Template and demo rows omit the field.
   */
  blockingReason?: string | null;
  /** Instance plan instant, or null when the node has no plan. Omitted on templates. */
  plannedAt?: string | null;
  /** Instance completion instant, or null until completion. Omitted on templates. */
  completedAt?: string | null;
  /** Persisted canvas X. Omitted on templates and demos that only use dagre. */
  posX?: number;
  /** Persisted canvas Y. Omitted on templates and demos that only use dagre. */
  posY?: number;
  /** Instance concurrency token. Omitted on templates. */
  updatedAt?: string | null;
  /** Template slug for an instance row. Null for ad-hoc nodes. Omitted on templates. */
  templateSlug?: string | null;
};

export type LiveGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type LiveGraph = {
  nodes: LiveGraphNode[];
  edges: LiveGraphEdge[];
};

const PREP_IDS = new Set(['script', 'pre-shoot']);
const PROD_IDS = new Set(['ar', 'br', 'ai', 'prop']);
const WIND_IDS = new Set(['settle', 'distribute', 'data-care', 'other']);

function rewire(
  edges: WorkflowConnection[],
  sources: Set<string>,
  targets: Set<string>,
  junctionId: string,
): WorkflowConnection[] {
  const cross = edges.filter((edge) => sources.has(edge.from) && targets.has(edge.to));
  if (cross.length === 0) return edges;
  const kept = edges.filter((edge) => !(sources.has(edge.from) && targets.has(edge.to)));
  const froms = new Set(cross.map((edge) => edge.from));
  const tos = new Set(cross.map((edge) => edge.to));
  return [
    ...kept,
    ...[...froms].map((from) => ({ from, to: junctionId })),
    ...[...tos].map((to) => ({ from: junctionId, to })),
  ];
}

/** Real stage edges, with display-only merge dots where the studio graph fans in or out. */
export function workflowDisplayGraph(graph: WorkflowGraph): FlowGraph {
  const stages = [...indexWorkflowNodes(graph).values()];
  let edges = listWorkflowConnections(graph);
  const junctions: string[] = [];
  if (edges.some((edge) => PREP_IDS.has(edge.from) && PROD_IDS.has(edge.to))) {
    junctions.push(JUNCTION_PREP_PROD_ID);
    edges = rewire(edges, PREP_IDS, PROD_IDS, JUNCTION_PREP_PROD_ID);
  }
  if (edges.some((edge) => edge.from === 'pub' && WIND_IDS.has(edge.to))) {
    junctions.push(JUNCTION_PUB_WIND_ID);
    edges = rewire(edges, new Set(['pub']), WIND_IDS, JUNCTION_PUB_WIND_ID);
  }
  return {
    nodes: [
      ...stages.map((node) => ({
        id: node.id,
        name: node.name,
        kind: 'stage' as const,
        x: 0,
        y: 0,
      })),
      ...junctions.map((id) => ({ id, name: '', kind: 'merge' as const, x: 0, y: 0 })),
    ],
    edges: edges.map((edge) => ({
      id: `e-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
    })),
  };
}

export function layoutWorkflowDisplay(graph: WorkflowGraph, direction: FlowDirection): FlowGraph {
  return layoutWithDagre(workflowDisplayGraph(graph), direction);
}

/** Database workflow: merge rows are the gold dots; stage rows are the cards. */
export function commercialWorkflowToFlowGraph(workflow: CommercialProjectWorkflow): FlowGraph {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      x: node.posX,
      y: node.posY,
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.fromNodeId,
      target: edge.toNodeId,
    })),
  };
}

export function layoutCommercialWorkflow(
  workflow: CommercialProjectWorkflow,
  direction: FlowDirection,
): FlowGraph {
  return layoutWithDagre(commercialWorkflowToFlowGraph(workflow), direction);
}

function liveNode(
  id: string,
  name: string,
  kind: 'stage' | 'merge',
  status?: string,
  blockingReason?: string,
): LiveGraphNode {
  const node: LiveGraphNode = { id, name, kind };
  if (status) node.status = status;
  if (blockingReason) node.blockingReason = blockingReason;
  return node;
}

/** Studio mock graph plus the two display-only gold dots. */
export function workflowGraphToLive(graph: WorkflowGraph): LiveGraph {
  const flow = workflowDisplayGraph(graph);
  const stages = indexWorkflowNodes(graph);
  return {
    nodes: flow.nodes.map((node) => {
      const stage = stages.get(node.id);
      return liveNode(
        node.id,
        stage?.name ?? node.name,
        node.kind,
        stage?.status,
        stage?.blockingReason,
      );
    }),
    edges: flow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}

/** Persisted project workflow. Merge rows stay gold dots; no second junction is inserted. */
export function commercialWorkflowToLive(workflow: CommercialProjectWorkflow): LiveGraph {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      status: node.status,
      blockingReason: node.blockingReason,
      plannedAt: node.plannedAt,
      completedAt: node.completedAt,
      posX: node.posX,
      posY: node.posY,
      updatedAt: node.updatedAt,
      templateSlug: node.templateSlug,
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.fromNodeId,
      target: edge.toNodeId,
    })),
  };
}

/** Published template has structure only. Cards render as 未完成 until a project instance exists. */
export function templateToLive(template: CommercialDefaultTemplate): LiveGraph {
  return {
    nodes: template.nodes.map((node) => liveNode(node.id, node.name, node.kind)),
    edges: template.edges.map((edge) => ({
      id: edge.id,
      source: edge.fromNodeId,
      target: edge.toNodeId,
    })),
  };
}

/**
 * Client-side rename check before PATCH .../workflow/layout.
 * Empty, overlong, and duplicate names are refused here and again on the server.
 */
export function applySessionRename(
  nodes: { id: string; name: string }[],
  nodeId: string,
  name: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: '节点名称不能为空。' };
  if (trimmed.length > COMMERCIAL_WORKFLOW_NODE_NAME_MAX) {
    return {
      ok: false,
      message: `节点名称最多 ${COMMERCIAL_WORKFLOW_NODE_NAME_MAX} 个字符。`,
    };
  }
  if (!nodes.some((node) => node.id === nodeId)) {
    return { ok: false, message: '找不到该节点。' };
  }
  if (nodes.some((node) => node.id !== nodeId && node.name === trimmed)) {
    return { ok: false, message: `节点名称「${trimmed}」已存在，同一流程内名称必须唯一。` };
  }
  return { ok: true, name: trimmed };
}
