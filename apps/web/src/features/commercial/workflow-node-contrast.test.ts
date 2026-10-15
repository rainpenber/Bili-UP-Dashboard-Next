import { describe, expect, test } from 'bun:test';
import { WORKFLOW_STATUS_SURFACE } from './workflow-node-visual';

/** sRGB hex → relative luminance (WCAG 2.x) */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const TAILWIND_HEX: Record<string, string> = {
  'emerald-100': '#d1fae5',
  'emerald-900': '#064e3b',
  'emerald-950': '#022c22',
  'amber-100': '#fef3c7',
  'amber-900': '#78350f',
  'amber-950': '#451a03',
  'red-100': '#fee2e2',
  'red-900': '#7f1d1d',
  'red-950': '#450a0a',
  'zinc-100': '#f4f4f5',
  'zinc-800': '#27272a',
  'zinc-900': '#18181b',
};

function bgFromCardClass(card: string): string {
  const token =
    card
      .split(' ')
      .find((c) => c.startsWith('bg-'))
      ?.replace('bg-', '') ?? '';
  return TAILWIND_HEX[token] ?? '#ffffff';
}

function fgFromTextClass(text: string): string {
  const token = text.replace('text-', '');
  return TAILWIND_HEX[token] ?? '#000000';
}

describe('workflow node contrast (WCAG AA 4.5:1)', () => {
  for (const [status, surface] of Object.entries(WORKFLOW_STATUS_SURFACE)) {
    test(`${status}: title and status label on card background`, () => {
      const bg = bgFromCardClass(surface.card);
      const titleRatio = contrastRatio(fgFromTextClass(surface.title), bg);
      const statusRatio = contrastRatio(fgFromTextClass(surface.status), bg);
      expect(titleRatio).toBeGreaterThanOrEqual(4.5);
      expect(statusRatio).toBeGreaterThanOrEqual(4.5);
    });
  }
});
