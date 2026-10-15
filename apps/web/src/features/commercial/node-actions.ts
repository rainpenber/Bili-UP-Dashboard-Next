import type { WorkflowApiStatus } from './types';

export const NODE_COMMANDS = [
  'advance',
  'complete',
  'skip',
  'rollback',
  'block',
  'unblock',
  'publish',
] as const;

export type NodeCommand = (typeof NODE_COMMANDS)[number];

export type NodeActionContext = {
  status: WorkflowApiStatus;
  isOptional: boolean;
  isPublishNode: boolean;
};

/**
 * Commands the write API accepts without `invalid_transition`.
 * Skip is offered only for optional nodes, and only from not_reached or in_progress.
 * The publish node is completed through publish, not complete.
 * A blocked node can only be unblocked. not_applicable clears with rollback.
 */
export function legalNodeCommands(ctx: NodeActionContext): NodeCommand[] {
  switch (ctx.status) {
    case 'not_reached':
      return ctx.isOptional ? ['advance', 'skip'] : ['advance'];
    case 'in_progress': {
      const commands: NodeCommand[] = [
        ctx.isPublishNode ? 'publish' : 'complete',
        'rollback',
        'block',
      ];
      if (ctx.isOptional) commands.push('skip');
      return commands;
    }
    case 'completed':
      return ['rollback'];
    case 'blocked':
      return ['unblock'];
    case 'not_applicable':
      return ['rollback'];
    default:
      return [];
  }
}

export const NODE_COMMAND_LABEL: Record<NodeCommand, string> = {
  advance: '推进',
  complete: '完成',
  skip: '不适用',
  rollback: '回退',
  block: '阻塞',
  unblock: '解除阻塞',
  publish: '完成',
};
