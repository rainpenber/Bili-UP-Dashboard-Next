import { spawn, spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

const migrate = spawnSync('bun', ['run', 'migrate'], {
  cwd: `${root}/packages/db`,
  env: process.env,
  stdio: 'inherit',
});
if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const api = spawn('bun', ['run', 'dev'], {
  cwd: `${root}/apps/api`,
  env: process.env,
  stdio: 'inherit',
});

const web = spawn('bun', ['run', 'dev', '--host', '127.0.0.1', '--port', '5173'], {
  cwd: `${root}/apps/web`,
  env: process.env,
  stdio: 'inherit',
});

function shutdown(code = 0) {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

api.on('exit', (c) => {
  if (c && c !== 0) shutdown(c);
});
web.on('exit', (c) => {
  if (c && c !== 0) shutdown(c);
});
