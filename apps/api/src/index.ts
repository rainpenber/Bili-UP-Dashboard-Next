import { createApp } from './app';

const port = Number(process.env.API_PORT ?? 3000);
const app = createApp();

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  console.log(`Studio API listening on http://localhost:${port}`);
}
