import { describe, expect, test } from 'bun:test';
import {
  datetimeLocalToOffsetIso,
  formatStartAtDisplay,
  offsetIsoToDatetimeLocal,
} from '@/lib/datetime-local';
import { parseMonitorStartAtInput } from '@studio/contracts';

function expectedOffsetIso(local: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!matched) throw new Error(`bad fixture ${local}`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const probe = new Date(year, month - 1, day, hour, minute, 0);
  const offsetMin = -probe.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${sign}${oh}:${om}`;
}

describe('datetimeLocalToOffsetIso', () => {
  test('keeps civil clock for the runtime local zone and passes contract parser', () => {
    const local = '2026-11-01T09:30';
    const offsetIso = datetimeLocalToOffsetIso(local);
    expect(offsetIso).toBe(expectedOffsetIso(local));
    const probe = new Date(2026, 10, 1, 9, 30, 0);
    expect(parseMonitorStartAtInput(offsetIso)).toBe(probe.toISOString());
  });

  test('Asia/Shanghai child process keeps 09:30 as +08:00', async () => {
    const script = `
      import { datetimeLocalToOffsetIso } from ${JSON.stringify(new URL('./datetime-local.ts', import.meta.url).pathname)};
      import { parseMonitorStartAtInput } from '@studio/contracts';
      const offsetIso = datetimeLocalToOffsetIso('2026-11-01T09:30');
      if (offsetIso !== '2026-11-01T09:30:00+08:00') {
        console.error('offset', offsetIso);
        process.exit(1);
      }
      const utc = parseMonitorStartAtInput(offsetIso);
      if (utc !== '2026-11-01T01:30:00.000Z') {
        console.error('utc', utc);
        process.exit(1);
      }
      console.log('ok');
    `;
    const proc = Bun.spawn({
      cmd: ['bun', '-e', script],
      cwd: new URL('../../', import.meta.url).pathname,
      env: { ...process.env, TZ: 'Asia/Shanghai' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('ok');
    expect(stderr).toBe('');
  });

  test('America/Los_Angeles child process keeps 09:30 as -08:00', async () => {
    const script = `
      import { datetimeLocalToOffsetIso } from ${JSON.stringify(new URL('./datetime-local.ts', import.meta.url).pathname)};
      import { parseMonitorStartAtInput } from '@studio/contracts';
      const offsetIso = datetimeLocalToOffsetIso('2026-11-01T09:30');
      if (offsetIso !== '2026-11-01T09:30:00-08:00') {
        console.error('offset', offsetIso);
        process.exit(1);
      }
      const utc = parseMonitorStartAtInput(offsetIso);
      if (utc !== '2026-11-01T17:30:00.000Z') {
        console.error('utc', utc);
        process.exit(1);
      }
      console.log('ok');
    `;
    const proc = Bun.spawn({
      cmd: ['bun', '-e', script],
      cwd: new URL('../../', import.meta.url).pathname,
      env: { ...process.env, TZ: 'America/Los_Angeles' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('ok');
    expect(stderr).toBe('');
  });

  test('rejects rolled calendar dates and empty junk', () => {
    expect(() => datetimeLocalToOffsetIso('2027-02-30T18:00')).toThrow(/合法/);
    expect(() => datetimeLocalToOffsetIso('not-a-time')).toThrow(/合法/);
    expect(() => datetimeLocalToOffsetIso('')).toThrow(/合法/);
  });
});

describe('offsetIsoToDatetimeLocal / formatStartAtDisplay', () => {
  test('round-trips local wall time and formats unset label', () => {
    const probe = new Date(2026, 10, 1, 9, 30, 0);
    expect(offsetIsoToDatetimeLocal(probe.toISOString())).toBe('2026-11-01T09:30');
    expect(formatStartAtDisplay(null)).toBe('未设置（立即开始）');
    expect(formatStartAtDisplay(probe.toISOString())).toContain('2026');
  });
});
