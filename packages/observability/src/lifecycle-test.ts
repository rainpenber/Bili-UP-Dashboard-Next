import type { LogSink } from './pg-sink';

const SINK_ERROR =
  'db down SESSDATA=plain-sess-value-9f3a; bili_jct=plain-jct-value-9f3a Bearer abc.def-GHI_9';

export function lifecycleTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOG_LIFECYCLE_TEST === '1';
}

export function applyLifecycleTestSink(
  sink: LogSink,
  env: NodeJS.ProcessEnv = process.env,
): LogSink {
  if (!lifecycleTestEnabled(env)) return sink;
  const mode = env.LOG_SINK_TEST?.trim() ?? '';
  if (mode === '') return sink;
  if (mode === 'hang') {
    return {
      write() {
        return new Promise(() => undefined);
      },
    };
  }
  if (mode === 'error') {
    return {
      async write() {
        throw new Error(SINK_ERROR);
      },
    };
  }
  if (mode === 'delay') {
    const raw = env.LOG_SINK_TEST_DELAY_MS ?? '0';
    const ms = Number(raw.trim());
    if (!Number.isInteger(ms) || ms < 0 || ms > 60_000) {
      throw new Error('LOG_SINK_TEST_DELAY_MS 超出范围');
    }
    return {
      async write(rows) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        await sink.write(rows);
      },
    };
  }
  throw new Error('LOG_SINK_TEST 无法识别');
}
