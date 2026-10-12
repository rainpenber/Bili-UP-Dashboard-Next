import { runMigrations, createSql } from '@studio/db';
import { createApp } from './app';

const port = Number(process.env.API_PORT ?? 3000);

const sql = createSql();
await runMigrations(sql);
const app = createApp({ skipDb: true });
const { createMonitorRoutes } = await import('./monitor-routes');
app.route('/api/v1/monitor', createMonitorRoutes(sql));
const { createAssetsRoutes } = await import('./assets-routes');
app.route('/api/v1/assets', createAssetsRoutes(sql));

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  console.log(`Studio API listening on http://localhost:${port} (MONITOR_DATA_SOURCE=mock)`);
}
