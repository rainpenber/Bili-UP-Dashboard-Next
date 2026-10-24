import { readFileSync } from 'node:fs';
import { createSql } from './client';
import { seedPartitionsFromJson } from './partitions';

export function partitionSeedFileFromArgv(argv: readonly string[]): string {
  const flag = argv.indexOf('--file');
  const file = flag >= 0 ? argv[flag + 1] : undefined;
  if (!file || file.startsWith('--'))
    throw new Error('用法: bun run seed-partitions -- --file <json>');
  return file;
}

async function main(): Promise<void> {
  const file = partitionSeedFileFromArgv(process.argv.slice(2));
  const sql = createSql();
  try {
    const written = await seedPartitionsFromJson(sql, readFileSync(file, 'utf8'));
    console.log(`已写入 ${written} 条分区`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : '分区导入失败');
    process.exitCode = 1;
  });
}
