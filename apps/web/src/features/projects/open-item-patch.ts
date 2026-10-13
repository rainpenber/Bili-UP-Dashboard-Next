import type { OpenItemDto } from '@studio/contracts';

export type OpenItemConfirmationSnapshot = {
  humanConfirmed: boolean;
  confirmedById: string | null;
};

export type OpenItemEditDraft = {
  title: string;
  itemType: OpenItemDto['itemType'];
  responsibleParty: OpenItemDto['responsibleParty'];
  description: string;
  closeCondition: string;
  workflowNodeId: string;
  dueLocal: string;
  humanConfirmed: boolean;
  confirmedById: string;
};

export function validateOpenItemEditConfirmer(
  draft: Pick<OpenItemEditDraft, 'humanConfirmed' | 'confirmedById'>,
): string | null {
  if (draft.humanConfirmed && !draft.confirmedById) {
    return '确认时必须选择确认人';
  }
  return null;
}

export function buildOpenItemConfirmationPatch(
  original: OpenItemConfirmationSnapshot,
  draft: Pick<OpenItemEditDraft, 'humanConfirmed' | 'confirmedById'>,
): Record<string, unknown> {
  const confirmedChanged = draft.humanConfirmed !== original.humanConfirmed;
  const confirmerChanged =
    draft.humanConfirmed && draft.confirmedById !== (original.confirmedById ?? '');

  if (!confirmedChanged && !confirmerChanged) {
    return {};
  }

  if (draft.humanConfirmed) {
    return { humanConfirmed: true, confirmedById: draft.confirmedById };
  }

  return { humanConfirmed: false };
}

export function buildOpenItemEditPatchBody(
  original: OpenItemConfirmationSnapshot,
  draft: OpenItemEditDraft,
): { body: Record<string, unknown> } | { error: string } {
  const confirmerError = validateOpenItemEditConfirmer(draft);
  if (confirmerError) {
    return { error: confirmerError };
  }

  const body: Record<string, unknown> = {
    title: draft.title.trim(),
    itemType: draft.itemType,
    responsibleParty: draft.responsibleParty,
    description: draft.description || null,
    closeCondition: draft.closeCondition || null,
    workflowNodeId: draft.workflowNodeId ? draft.workflowNodeId : null,
    dueAt: draft.dueLocal ? new Date(draft.dueLocal).toISOString() : null,
    ...buildOpenItemConfirmationPatch(original, draft),
  };

  return { body };
}
