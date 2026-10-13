import type { GraphEdge, GraphNode } from './graph-dag';

const POST_PUBLISH_SLUGS = new Set(['settlement', 'distribution', 'data_maint', 'other']);

export function deriveOverallStage(
  nodes: Array<GraphNode & { slug?: string; name?: string }>,
  edges: GraphEdge[],
  published: boolean,
): 'pre_publish' | 'published_winding_down' | 'closed' {
  if (!published) return 'pre_publish';
  const applicable = nodes.filter((n) => n.status !== 'not_applicable');
  const post = applicable.filter(
    (n) => POST_PUBLISH_SLUGS.has(n.slug ?? '') || /结算|分发|数据维护|其他/.test(n.name ?? ''),
  );
  const allPostDone = post.every((n) => n.status === 'completed' || n.status === 'not_applicable');
  if (allPostDone && post.length > 0) return 'closed';
  void edges;
  return 'published_winding_down';
}

export function postPublishLeavesIncomplete(
  nodes: Array<GraphNode & { slug?: string; name?: string }>,
): boolean {
  const post = nodes.filter(
    (n) =>
      n.status !== 'not_applicable' &&
      (POST_PUBLISH_SLUGS.has(n.slug ?? '') || /结算|分发|数据维护/.test(n.name ?? '')),
  );
  return post.some((n) => n.status !== 'completed');
}
