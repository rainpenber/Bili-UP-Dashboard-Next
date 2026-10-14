export function nodeStatusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'in_progress':
      return '进行中';
    case 'blocked':
      return '阻塞';
    case 'not_applicable':
      return '不适用';
    default:
      return '未到达';
  }
}

export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    create: '创建',
    update: '更新',
    close: '关闭',
    cancel: '取消',
    split: '拆分',
    merge: '合并',
    promote_to_node: '提升为节点',
    pin_primary_block: '钉选主阻塞',
    advance_to: '推进到节点',
    complete: '标记完成',
    rollback: '回退节点',
    upsert_project: '创建/更新项目',
    upsert_open_item: '创建/更新事项',
    close_open_item: '关闭事项',
    advance_node: '推进节点',
    rollback_node: '回退节点',
    publish_video: '发布视频',
  };
  return map[action] ?? action;
}

export function auditSourceLabel(source: string): string {
  switch (source) {
    case 'web':
      return '网页';
    case 'hermes':
      return 'Hermes';
    case 'manual':
      return '手动';
    case 'legacy':
      return '历史迁移';
    case 'migration':
      return '迁移';
    default:
      return source;
  }
}

export function overallStageLabel(stage: string): string {
  switch (stage) {
    case 'pre_publish':
      return '发布前';
    case 'published_winding_down':
      return '已上线收尾中';
    case 'closed':
      return '已结案';
    case 'archived':
      return '已归档';
    default:
      return stage;
  }
}
