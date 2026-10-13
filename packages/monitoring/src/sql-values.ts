/** postgres.js templates accept bigint poorly under strict TS — use strings. */
export function pgBigint(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}
