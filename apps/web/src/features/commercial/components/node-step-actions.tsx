import { Button } from '@/components/ui/button';
import {
  deriveNodeStepActions,
  type NodeStepActionSpec,
  type TimelineChild,
} from '../progress-timeline';
import type { StepCall, StepController, StepEditor } from './stage-step-controls';

/** Compact per-node actions rendered inside the stage tooltip row. */
export function TooltipNodeActions({
  child,
  controller,
  editor,
}: {
  child: TimelineChild;
  controller: StepController;
  editor: StepEditor;
}) {
  const actions = deriveNodeStepActions(child.status, { nodeId: child.nodeId });
  const ready = Boolean(child.updatedAt);
  const error = controller.subjectNodeId === child.id ? controller.error : null;

  const activate = (action: NodeStepActionSpec) => {
    if (controller.pending || !ready || !action.enabled) return;
    if (action.endpoint === 'unblock') {
      if (!editor.onUnblock || !child.updatedAt) return;
      void controller.runUnblock(child.id, child.updatedAt);
      return;
    }
    if (!action.direction || !child.updatedAt) return;
    const call: StepCall = {
      kind: 'node',
      nodeId: child.id,
      stageId: null,
      direction: action.direction,
      expectedUpdatedAt: child.updatedAt,
      tokens: [{ nodeId: child.id, expectedUpdatedAt: child.updatedAt }],
      force: false,
      publish: null,
    };
    void controller.run(call);
  };

  return (
    <div
      className="mt-1.5 flex min-w-0 flex-wrap justify-end gap-1"
      data-testid={`tooltip-node-actions-${child.nodeId}`}
      data-status={child.status}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {actions.map((action) => {
        const missingEndpoint = action.endpoint === 'unblock' && !editor.onUnblock;
        const disabled = controller.pending || !ready || !action.enabled || missingEndpoint;
        return (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant={action.id === 'rollback' ? 'outline' : 'default'}
            className="h-6 px-1.5 text-[11px]"
            disabled={disabled}
            title={action.hint}
            aria-busy={controller.pending && action.enabled ? 'true' : undefined}
            data-testid={`tooltip-node-${action.id}-${child.nodeId}`}
            data-action={action.id}
            data-enabled={action.enabled ? 'true' : 'false'}
            data-pending={controller.pending && action.enabled ? 'true' : 'false'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              activate(action);
            }}
          >
            {action.label}
          </Button>
        );
      })}
      {error ? (
        <p
          className="w-full text-right text-[11px] text-destructive"
          role="alert"
          data-testid={`tooltip-node-error-${child.nodeId}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
