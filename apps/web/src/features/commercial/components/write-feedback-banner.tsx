import type { WriteFeedback } from '../commercial-api';

export function WriteFeedbackBanner({ feedback }: { feedback: WriteFeedback | null }) {
  if (!feedback || feedback.kind === 'ok') return null;
  if (feedback.kind === 'stale') {
    return (
      <p className="text-sm text-foreground" role="status" data-testid="workflow-stale-notice">
        {feedback.message}
      </p>
    );
  }
  return (
    <p className="text-sm text-destructive" role="alert" data-testid="workflow-action-error">
      {feedback.message}
      {feedback.names.length > 0 ? (
        <span className="mt-1 block" data-testid="workflow-action-error-names">
          涉及节点：{feedback.names.join('、')}
        </span>
      ) : null}
    </p>
  );
}
