/** Reviewed template-editor refusals. The API returns these strings unchanged. */

export function duplicateTemplateNodeNameMessage(name: string): string {
  return `节点名称「${name}」已存在，同一流程内名称必须唯一。`;
}

export function templateCycleMessage(fromName: string, toName: string): string {
  return `无法连接「${fromName} → ${toName}」：会在流程中形成环路。`;
}

export function templateSelfLoopMessage(): string {
  return '不能将节点连接到自身。';
}

export function templateDuplicateEdgeMessage(fromName: string, toName: string): string {
  return `连接「${fromName} → ${toName}」已存在。`;
}

export function templateMissingEdgeMessage(fromName: string, toName: string): string {
  return `不存在连接「${fromName} → ${toName}」，无法断开。`;
}

export function templateEmptyNodeNameMessage(): string {
  return '节点名称不能为空。';
}
