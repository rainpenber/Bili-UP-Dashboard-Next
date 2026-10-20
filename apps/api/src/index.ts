import { runMigrations, createSql } from '@studio/db';
import { createLogger, startAppLogRetention } from '@studio/observability';
import { createApp } from './app';
import { mountApiRoutes } from './mount-api';

const port = Number(process.env.API_PORT ?? 3000);

const sql = createSql();
await runMigrations(sql);
const logger = createLogger({
  service: 'api',
  instance: process.env.HOSTNAME ?? 'api',
  sql,
});
startAppLogRetention(sql, {
  onError: (message) => {
    logger.error('日志清理失败', { event: 'log.retention_failed', context: { error: message } });
  },
});
logger.info('API 启动', { event: 'service.started' });
const app = createApp({ skipDb: true, logger });
mountApiRoutes(app, sql, { logger });

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  console.log(
    `Studio API listening on http://localhost:${port} (MONITOR_DATA_SOURCE=${process.env.MONITOR_DATA_SOURCE ?? 'mock'})`,
  );
}
