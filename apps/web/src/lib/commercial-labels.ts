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
