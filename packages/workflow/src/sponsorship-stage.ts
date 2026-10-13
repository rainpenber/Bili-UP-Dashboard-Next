/**
 * Deterministic workflow rule: map a sponsorship production record to its stage label.
 * No external I/O — pure function for bootstrap tests and future workflow engine.
 */
export const SPONSORSHIP_STAGES = [
  'intake',
  'brief_review',
  'production',
  'client_review',
  'published',
  'closed',
] as const;

export type SponsorshipStage = (typeof SPONSORSHIP_STAGES)[number];

export interface SponsorshipStageInput {
  briefAccepted: boolean;
  scriptApproved: boolean;
  videoUploaded: boolean;
  clientSignedOff: boolean;
  publishedAt: string | null;
}

export function resolveSponsorshipStage(input: SponsorshipStageInput): SponsorshipStage {
  if (input.publishedAt !== null) {
    return 'published';
  }
  if (input.clientSignedOff) {
    return 'client_review';
  }
  if (input.videoUploaded) {
    return 'client_review';
  }
  if (input.scriptApproved) {
    return 'production';
  }
  if (input.briefAccepted) {
    return 'brief_review';
  }
  return 'intake';
}
