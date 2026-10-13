import { createHealthResponse } from '@studio/contracts';
import { Hono } from 'hono';

export const API_VERSION = '0.0.0';
export const SERVICE_NAME = 'studio-api';

export function createApp() {
  const app = new Hono();

  app.get('/health', (c) => {
    const body = createHealthResponse({
      service: SERVICE_NAME,
      version: API_VERSION,
    });
    return c.json(body);
  });

  return app;
}
