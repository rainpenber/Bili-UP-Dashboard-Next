import { describe, expect, test } from 'bun:test';
import { createProcessWork, httpRejected } from './process-work';

describe('process work', () => {
  test('requests after stop are rejected and not tracked', async () => {
    const work = createProcessWork();
    work.stopAccepting();
    expect(await work.runHttp(async () => 'nope')).toBe(httpRejected);
    expect(work.activeHttp).toBe(0);
    expect(await work.finish(20)).toBe('finished');
  });

  test('an accepted request stays tracked until it returns', async () => {
    const work = createProcessWork();
    let release!: (value: string) => void;
    const running = work.runHttp(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    expect(work.activeHttp).toBe(1);
    work.stopAccepting();
    const finished = work.finish(1_000);
    let saw: string | null = null;
    void finished.then((result) => {
      saw = result;
    });
    await Promise.resolve();
    expect(saw).toBeNull();
    release('ok');
    expect(await running).toBe('ok');
    expect(await finished).toBe('finished');
    expect(work.activeHttp).toBe(0);
  });

  test('background registered after finish begins is still awaited', async () => {
    const work = createProcessWork();
    let releaseHttp!: () => void;
    const httpDone = new Promise<void>((resolve) => {
      releaseHttp = resolve;
    });
    let releaseBackground!: () => void;
    const background = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    const running = work.runHttp(async () => {
      await httpDone;
      work.trackBackground(background);
    });
    work.stopAccepting();
    const finished = work.finish(2_000);
    let saw: string | null = null;
    void finished.then((result) => {
      saw = result;
    });
    releaseHttp();
    await running;
    await Promise.resolve();
    expect(saw).toBeNull();
    expect(work.activeHttp).toBe(0);
    expect(work.activeBackground).toBe(1);
    releaseBackground();
    expect(await finished).toBe('finished');
    expect(work.activeBackground).toBe(0);
  });

  test('background registered before the http callback returns cannot be missed', async () => {
    const work = createProcessWork();
    let releaseBackground!: () => void;
    const background = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    const running = work.runHttp(async () => {
      work.trackBackground(background);
    });
    work.stopAccepting();
    const finished = work.finish(1_000);
    await running;
    expect(work.activeHttp).toBe(0);
    expect(work.activeBackground).toBe(1);
    let saw: string | null = null;
    void finished.then((result) => {
      saw = result;
    });
    await Promise.resolve();
    expect(saw).toBeNull();
    releaseBackground();
    expect(await finished).toBe('finished');
  });

  test('a hanging http is timed out and is not finished', async () => {
    const work = createProcessWork();
    void work.runHttp(() => new Promise(() => undefined));
    work.stopAccepting();
    const started = Date.now();
    expect(await work.finish(40)).toBe('timed_out');
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(work.activeHttp).toBe(1);
  });

  test('a rejection during shutdown is incomplete and scrubbed', async () => {
    const work = createProcessWork();
    let reject!: (error: Error) => void;
    const task = new Promise<void>((_resolve, rejectTask) => {
      reject = rejectTask;
    });
    work.trackBackground(task);
    work.stopAccepting();
    const pending = work.finish(1_000);
    reject(new Error('metadata-backfill-rejected SESSDATA=plain-sess-value-9f3a'));
    expect(await pending).toBe('failed');
    const message = work.failureMessage() ?? '';
    expect(message).toContain('metadata-backfill-rejected');
    expect(message).not.toContain('plain-sess-value-9f3a');
    expect(message).toContain('[redacted]');
    expect(work.activeBackground).toBe(0);
  });

  test('a rejection that settled before shutdown does not fail the next finish', async () => {
    const work = createProcessWork();
    work.trackBackground(Promise.reject(new Error('SESSDATA=plain-sess-value-9f3a settled')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(work.activeBackground).toBe(0);
    expect(work.failureMessage()).toBeNull();
    work.stopAccepting();
    expect(await work.finish(50)).toBe('finished');
  });

  test('settled background work drops its references', async () => {
    const work = createProcessWork();
    for (let index = 0; index < 1_000; index += 1) {
      work.trackBackground(Promise.resolve());
      work.trackBackground(Promise.reject(new Error(`old failure ${index}`)));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(work.activeBackground).toBe(0);
    expect(work.failureMessage()).toBeNull();
    work.stopAccepting();
    expect(await work.finish(50)).toBe('finished');
  });
});
