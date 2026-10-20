import { describe, expect, test } from 'bun:test';
import { createShutdownController, type ShutdownDiagnostic, type ShutdownHooks } from './shutdown';

function recordingHooks(overrides: Partial<ShutdownHooks> = {}) {
  const calls: string[] = [];
  const diagnostics: ShutdownDiagnostic[] = [];
  const hooks: ShutdownHooks = {
    stopAccepting() {
      calls.push('stop');
    },
    async finishCurrent() {
      calls.push('finish');
      return 'finished';
    },
    recordStopped() {
      calls.push('record');
    },
    async flush() {
      calls.push('flush');
      return { ok: true, reason: 'persisted', pendingRecords: 0, pendingBytes: 0 };
    },
    stopRetention() {
      calls.push('retention');
    },
    async closeResources() {
      calls.push('close');
    },
    ...overrides,
  };
  return { calls, diagnostics, hooks };
}

describe('bounded shutdown', () => {
  test('stops, finishes, records, flushes, then closes once', async () => {
    const recorded = recordingHooks();
    const controller = createShutdownController({
      budgets: { flushMs: 200, exitMs: 800 },
      hooks: recorded.hooks,
      writeDiagnostic: (record) => recorded.diagnostics.push(record),
      exit: (code) => recorded.calls.push(`exit:${code}`),
    });
    const first = await controller.start('SIGTERM');
    const joined = await controller.join('collector-loop-ended');
    const second = await controller.start('SIGINT');
    expect(first).toBe(0);
    expect(joined).toBe(0);
    expect(second).toBe(0);
    expect(recorded.calls.filter((call) => call === 'record')).toEqual(['record']);
    expect(recorded.calls).toEqual([
      'stop',
      'finish',
      'record',
      'flush',
      'retention',
      'close',
      'exit:0',
    ]);
    expect(recorded.diagnostics.map((record) => record.event)).toEqual([
      'process.signal_duplicate',
    ]);
  });

  test('a hung flush is a real timeout and not success', async () => {
    const recorded = recordingHooks();
    recorded.hooks.flush = () => {
      recorded.calls.push('flush');
      return new Promise(() => undefined);
    };
    const controller = createShutdownController({
      budgets: { flushMs: 80, exitMs: 400 },
      hooks: recorded.hooks,
      writeDiagnostic: (record) => recorded.diagnostics.push(record),
      exit: (code) => recorded.calls.push(`exit:${code}`),
    });
    const started = Date.now();
    const code = await controller.start('SIGTERM');
    const elapsed = Date.now() - started;
    expect(code).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(350);
    expect(recorded.calls).toContain('flush');
    expect(recorded.calls).toContain('exit:1');
    expect(
      recorded.diagnostics.some((record) => record.event === 'process.shutdown_incomplete'),
    ).toBe(true);
    expect(
      recorded.diagnostics.some((record) => record.event === 'process.exit_budget_exceeded'),
    ).toBe(false);
  });

  test('a hung current task is abandoned only after its budget', async () => {
    const recorded = recordingHooks({
      finishCurrent: () => new Promise(() => undefined),
    });
    const controller = createShutdownController({
      budgets: { flushMs: 60, exitMs: 220 },
      hooks: recorded.hooks,
      writeDiagnostic: (record) => recorded.diagnostics.push(record),
      exit: (code) => recorded.calls.push(`exit:${code}`),
    });
    const started = Date.now();
    const code = await controller.start('SIGTERM');
    const elapsed = Date.now() - started;
    expect(code).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(220);
    const incomplete = recorded.diagnostics.find(
      (record) => record.event === 'process.shutdown_incomplete',
    );
    expect(incomplete?.context.task).toBe('timed_out');
    expect(recorded.calls.indexOf('flush')).toBeGreaterThan(recorded.calls.indexOf('stop'));
  });
});
