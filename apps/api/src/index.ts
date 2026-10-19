import { runMigrations, createSql } from '@studio/db';
import { createLogger, startAppLogRetention } from '@studio/observability';
import { createApp } from './app';

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
const { createMonitorRoutes } = await import('./monitor-routes');
app.route('/api/v1/monitor', createMonitorRoutes(sql));
const { createAssetsRoutes } = await import('./assets-routes');
const { createImportRoutes } = await import('./import-routes');
app.route('/api/v1/assets', createAssetsRoutes(sql));
app.route('/api/v1/imports', createImportRoutes(sql));
const { createCommercialRoutes } = await import('./commercial-routes');
app.route('/api/v1/commercial', createCommercialRoutes(sql));
const { createOpsRoutes } = await import('./ops-routes');
app.route('/api/v1/ops', createOpsRoutes(sql));

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  console.log(
    `Studio API listening on http://localhost:${port} (MONITOR_DATA_SOURCE=${process.env.MONITOR_DATA_SOURCE ?? 'mock'})`,
  );
}
