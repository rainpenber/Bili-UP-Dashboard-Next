import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VIEWS_HEADER = '时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕';

/** Build a 101+101 mirror tree (same layout as production) for scale tests. */
export function writeScaleMockDataTree(root: string, opts?: { rowsPerFile?: number }): void {
  const rowsPerFile = opts?.rowsPerFile ?? 40;
  const backend = join(root, 'backend');
  const frontend = join(root, 'frontend');
  const assets = join(root, 'assets');
  mkdirSync(backend, { recursive: true });
  mkdirSync(frontend, { recursive: true });
  mkdirSync(join(assets, 'covers'), { recursive: true });

  for (let i = 1; i <= 100; i++) {
    const bvid = `BVSCALE${String(i).padStart(3, '0')}`;
    const body = buildViewsCsv(rowsPerFile, i);
    writeFileSync(join(backend, `${bvid}_views.csv`), body, 'utf8');
    writeFileSync(join(frontend, `${bvid}_views.csv`), body, 'utf8');
  }

  writeFileSync(join(backend, 'commentlist.csv'), 'id,text\n1,only-backend\n', 'utf8');
  const feOnly = 'BVFEONLY_views.csv';
  writeFileSync(join(frontend, feOnly), buildViewsCsv(rowsPerFile, 999), 'utf8');

  writeFileSync(
    join(assets, 'BVSCALE001.json'),
    JSON.stringify({ bvid: 'BVSCALE001', title: 'scale', cover: 'covers/BVSCALE001.png' }),
    'utf8',
  );
  writeFileSync(
    join(assets, 'covers/BVSCALE001.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'binary',
  );
}

function buildViewsCsv(rows: number, seed: number): string {
  const lines = [VIEWS_HEADER];
  for (let r = 0; r < rows; r++) {
    lines.push(
      `2025-01-${String((r % 28) + 1).padStart(2, '0')} 10:${String(r % 60).padStart(2, '0')},${seed + r},${r},1,0,0,0,0`,
    );
  }
  return `${lines.join('\n')}\n`;
}
