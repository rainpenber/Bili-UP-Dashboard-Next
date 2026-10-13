#!/usr/bin/env bun
import { createSql, runMigrations } from '@studio/db';
import { runImport } from './import-run';

function usage(): never {
  console.error(`Usage: monitor-import <inventory|dry-run|apply> [options]
  --backend-root=PATH
  --frontend-root=PATH
  --assets-root=PATH
  --source-timezone=Asia/Shanghai
  --report-out=PATH (json/markdown base without extension)`);
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || !['inventory', 'dry-run', 'apply'].includes(cmd)) usage();

const flags = new Map<string, string>();
for (const arg of args.slice(1)) {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  if (m) flags.set(m[1] ?? '', m[2] ?? '');
}

const mode = cmd === 'dry-run' ? 'dry_run' : cmd === 'apply' ? 'apply' : 'inventory';
const sourceTimezone =
  flags.get('source-timezone') ?? process.env.SOURCE_TIMEZONE ?? 'Asia/Shanghai';

const sql = mode === 'inventory' ? undefined : createSql();
if (sql) {
  await runMigrations(sql);
}

const result = await runImport({
  mode,
  ...(flags.get('backend-root') ? { backendRoot: flags.get('backend-root')! } : {}),
  ...(flags.get('frontend-root') ? { frontendRoot: flags.get('frontend-root')! } : {}),
  ...(flags.get('assets-root') ? { assetsRoot: flags.get('assets-root')! } : {}),
  sourceTimezone,
  ...(sql ? { sql } : {}),
});

console.log(JSON.stringify(result.report, null, 2));
const base = flags.get('report-out');
if (base) {
  await Bun.write(`${base}.json`, JSON.stringify(result.report, null, 2));
  await Bun.write(`${base}.md`, result.markdown);
}

if (sql) {
  await sql.end({ timeout: 5 });
}
