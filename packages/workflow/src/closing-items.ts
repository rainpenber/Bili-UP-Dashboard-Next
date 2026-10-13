export const CLOSING_OPEN_ITEM_TYPES = [
  'finance',
  'logistics',
  'delivery',
  'risk_conflict',
] as const;

export type ClosingOpenItemType = (typeof CLOSING_OPEN_ITEM_TYPES)[number];

export function isClosingOpenItemType(type: string): type is ClosingOpenItemType {
  return (CLOSING_OPEN_ITEM_TYPES as readonly string[]).includes(type);
}
