import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export type LifecycleChild = {
  lines: string[];
  stderr: string[];
  kill(signal: NodeJS.Signals): void;
  exited: Promise<number>;
  dispose(): void;
  waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<number>;
};

export function repoRootFrom(here: string): string {
  return here;
}

export async function freeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function spawnLifecycleProcess(options: {
  cwd: string;
  script: string;
  env: NodeJS.ProcessEnv;
}): LifecycleChild {
  const lines: string[] = [];
  const stderr: string[] = [];
  const child: ChildProcess = spawn(process.execPath, [options.script], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutDone = collect(child.stdout, (line) => lines.push(line));
  const stderrDone = collect(child.stderr, (line) => stderr.push(line));
  let exitCode: number | null = null;
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      exitCode = code ?? 1;
      void Promise.all([stdoutDone, stderrDone]).then(() => resolve(exitCode ?? 1));
    });
  });
  return {
    lines,
    stderr,
    kill(signal) {
      if (exitCode === null) child.kill(signal);
    },
    exited,
    dispose() {
      if (exitCode === null) child.kill('SIGKILL');
    },
    waitForLine(predicate, timeoutMs) {
      const started = Date.now();
      return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (lines.some(predicate)) {
            clearInterval(timer);
            resolve(Date.now());
            return;
          }
          if (exitCode !== null) {
            clearInterval(timer);
            reject(
              new Error(
                `进程已退出 ${exitCode}，未看到目标日志\n${stderr.join('\n')}\n${lines.join('\n')}`,
              ),
            );
            return;
          }
          if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
            reject(new Error(`等待日志超时\n${stderr.join('\n')}\n${lines.slice(-20).join('\n')}`));
          }
        }, 10);
      });
    },
  };
}

function collect(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    if (!stream) {
      resolve();
      return;
    }
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        onLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) onLine(buffer);
      resolve();
    });
    stream.on('error', () => resolve());
  });
}

export function lifecycleChildEnv(
  database: string,
  extra: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    POSTGRES_HOST: process.env.POSTGRES_HOST ?? '127.0.0.1',
    POSTGRES_PORT: process.env.POSTGRES_PORT ?? '5432',
    POSTGRES_USER: process.env.POSTGRES_USER ?? 'studio_ci',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    POSTGRES_DB: database,
    MONITOR_PROVIDER: 'offline',
    COLLECTOR_PROVIDER: 'offline',
    LOG_LIFECYCLE_TEST: '1',
    NODE_ENV: 'test',
    ...extra,
  };
}

export function parseLogEvent(line: string): { event?: string; instance?: string } | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as { event?: unknown; instance?: unknown };
    return {
      ...(typeof record.event === 'string' ? { event: record.event } : {}),
      ...(typeof record.instance === 'string' ? { instance: record.instance } : {}),
    };
  } catch {
    return null;
  }
}

export function evidence(payload: Record<string, unknown>) {
  console.log(`WP-R2-12A-EVIDENCE ${JSON.stringify(payload)}`);
}
