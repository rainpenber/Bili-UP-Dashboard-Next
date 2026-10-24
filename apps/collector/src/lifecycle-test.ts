import type { MonitorProvider } from '@studio/monitoring';

export function applyLifecycleTestProvider(
  provider: MonitorProvider,
  env: NodeJS.ProcessEnv = process.env,
): MonitorProvider {
  if (env.LOG_LIFECYCLE_TEST !== '1') return provider;
  const hang = env.COLLECTOR_TEST_TASK_HANG === '1';
  const raw = env.COLLECTOR_TEST_TASK_DELAY_MS;
  const delay = raw === undefined || raw.trim() === '' ? 0 : Number(raw.trim());
  if (raw !== undefined && raw.trim() !== '') {
    if (!Number.isInteger(delay) || delay < 0 || delay > 60_000) {
      throw new Error('COLLECTOR_TEST_TASK_DELAY_MS 超出范围');
    }
  }
  if (!hang && delay === 0) return provider;
  const pause = async () => {
    if (hang) {
      await new Promise<void>(() => undefined);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  };
  return {
    id: provider.id,
    async collectVideo(externalId, sampledAt) {
      await pause();
      return provider.collectVideo(externalId, sampledAt);
    },
    async collectCreator(externalId, sampledAt) {
      await pause();
      return provider.collectCreator(externalId, sampledAt);
    },
    async collectDynamic(externalId, sampledAt) {
      await pause();
      return provider.collectDynamic(externalId, sampledAt);
    },
  };
}
