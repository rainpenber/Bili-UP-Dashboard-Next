/**
 * Dynamic monitor target label rules (WP-R2-27A bug4).
 * Label = first 24 chars of body/title (collapse whitespace); fallback `动态 <id后6位>`.
 */

const LABEL_MAX = 24;

export function formatDynamicTargetLabel(input: {
  text: string | null | undefined;
  dynamicId: string;
}): string {
  const collapsed = (input.text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!collapsed) {
    const id = input.dynamicId.trim();
    const suffix = id.length <= 6 ? id : id.slice(-6);
    return `动态 ${suffix}`;
  }
  if (collapsed.length <= LABEL_MAX) return collapsed;
  return `${collapsed.slice(0, LABEL_MAX)}…`;
}
