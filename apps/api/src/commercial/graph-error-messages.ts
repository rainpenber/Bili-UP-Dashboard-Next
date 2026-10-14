/** User-facing Chinese messages for graph validation errors from @studio/workflow. */
export function graphErrorMessage(message: string): string {
  switch (message) {
    case 'cycle detected':
      return '连线会形成环路，已拒绝';
    case 'self loop':
      return '不能将节点连接到自身';
    case 'edge references unknown node':
      return '连线端点不存在';
    case 'edge nodes must belong to workflow':
      return '连线节点不属于当前工作流';
    default:
      return message;
  }
}
