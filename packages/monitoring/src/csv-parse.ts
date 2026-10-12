export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

/** Minimal RFC4180-style parser with BOM strip and quoted newlines. */
export function parseCsv(text: string): ParsedCsv {
  let input = text;
  if (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1);
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      if (input[i] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\n') {
      i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0] ?? [];
  return { headers, rows: rows.slice(1).filter((r) => r.some((c) => c.trim() !== '')) };
}

export function parseBoundedCount(raw: string): {
  value: bigint | null;
  raw: string;
  note?: string;
} {
  const trimmed = raw.trim();
  if (trimmed.endsWith('+')) {
    const num = trimmed.slice(0, -1).replace(/,/g, '');
    const n = BigInt(num || '0');
    return { value: n, raw: trimmed, note: 'lower_bound' };
  }
  if (trimmed === '') {
    return { value: null, raw: trimmed };
  }
  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+$/.test(normalized)) {
    return { value: null, raw: trimmed, note: 'unparseable' };
  }
  return { value: BigInt(normalized), raw: trimmed };
}

export function parseIntegerField(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+$/.test(normalized)) return null;
  return BigInt(normalized);
}

export { parseHistoricalTime, detectTimestampPrecision } from './time';
