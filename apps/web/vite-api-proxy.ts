/** Dev-server proxy target for `/api` (Vite only; not exposed to browser bundle). */
export function resolveApiProxyTarget(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.VITE_API_PROXY_TARGET?.trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'http://localhost:3000';
}
