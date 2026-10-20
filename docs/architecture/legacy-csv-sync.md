# 旧 CSV 增量同步

WP-R2-10。消费者只读本地快照目录，把 `*_views.csv` 和 `*_follower.csv` 追加进已有样本表。不访问 B 站，不保存 Windows 凭据，也不在镜像里安装 SSH。

Windows 上的旧采集继续写自己的 CSV。把文件从 Windows 拷到这台机器是宿主的事：先写到临时目录，再原子改名到发布目录。同步进程只打开发布目录；没有换行的尾行会留到下一轮，避免把写到一半的行当成样本。

## 命令

迁移仍由 API 启动时执行。同步进程不建表。

```bash
# 试跑一轮。默认不写检查点、样本、导入记录
bun run apps/collector/src/cli.ts sync-legacy --dir /path/to/snapshot --once

# 真正写入一轮
bun run apps/collector/src/cli.ts sync-legacy --dir /path/to/snapshot --once --execute

# 每 15 分钟一轮，直到 SIGINT / SIGTERM
bun run apps/collector/src/cli.ts sync-legacy --dir /path/to/snapshot --execute

# 自定义间隔。也接受毫秒数，或 s / h 后缀
bun run apps/collector/src/cli.ts sync-legacy --dir /path/to/snapshot --execute --interval 15m

# 最近一轮和最近一次成功
bun run apps/collector/src/cli.ts sync-legacy status
```

暂停是 `SIGINT` 或 `SIGTERM`（`docker compose stop legacy-sync`）。已经提交的批次留在库里。用同一条命令再启动就会从检查点继续。

`--execute` 才写库。同时带 `--dry-run` 时仍是试跑。未变化的文件只核对前缀哈希，不解析、不写样本。

执行后的统计在 `legacy_csv_sync_rounds`，也可以用只读命令看。成功、失败和开始会写 info 日志 `legacy.sync.started` / `legacy.sync.finished` / `legacy.sync.failed`，因此也能用现有的 `GET /api/v1/ops/logs?q=legacy.sync` 检索。

可选 Compose 覆盖层不在默认 `docker-compose.yml` 里：

```bash
LEGACY_CSV_DIR=/var/lib/legacy-csv-snapshot \
  docker compose -f docker-compose.yml -f docker-compose.legacy-sync.yml up -d legacy-sync

docker compose -f docker-compose.yml -f docker-compose.legacy-sync.yml stop legacy-sync
```

`LEGACY_CSV_DIR` 以只读方式挂到 `/legacy-csv`。默认间隔是 `LEGACY_SYNC_INTERVAL_MS=900000`。只跑一个副本；第二个进程拿不到 advisory lock 会直接退出。

本包没有在 Debian 上安装定时器，也没有拿真实快照验收。那一步由 Hermes 在宿主上做。

## 检查点

表 `legacy_csv_sync_checkpoints` 按文件名记：

- `byte_offset`：已经成功提交的完整行的结束位置，不含未完成尾行
- `prefix_sha256`：这段前缀的 SHA-256
- `boundary_sha256` / `boundary_length`：前缀末尾最多 256 字节的哈希
- `header_line`：去掉 BOM 和换行后的表头

每一批样本、拒绝记录和检查点在同一个事务里提交。事务回滚时偏移不动。下一轮从最后一次成功的偏移继续，已经入库的样本靠 `(实体, sampled_at)` 保持幂等。

下一轮先重算前缀哈希：

| 看到的文件                                       | 动作                                    |
| ------------------------------------------------ | --------------------------------------- |
| 大小和哈希都没变                                 | 跳过，零解析                            |
| 只在末尾追加，前缀哈希仍匹配                     | 只解析新的完整行                        |
| 变短、等长改写，或前缀被替换，但表头仍是原来的列 | 从第 0 字节重扫。已有样本保留，冲突计数 |
| 没有完整表头，或表头变了                         | 本文件失败，检查点和样本都不改          |
| 发布目录不存在，或曾经同步过的文件消失           | 这一轮记失败，不删样本、不删检查点      |

不拿最新的 `sampled_at` 当水位。文件末尾补上的更早时刻会作为新行入库。

## 冲突

样本唯一键仍是视频 `(bvid, sampled_at)`、粉丝 `(mid, sampled_at)`。写入是 `ON CONFLICT DO NOTHING`。

- 同一时刻已有 `bilibili`、`import` 或 `legacy_csv` 行时，CSV 不改播放、粉丝、在线人数、评论或 `source`
- 文件里同一分钟出现多次时保留第一行，其余算冲突
- 不同 `sampled_at` 两行都留
- 旧视频行的 `comment_count` 写 NULL
- `videos` / `creators` 只在不存在时插入主键。标题、头像、封面、`mid` 关联和 `monitoring_enabled` 不被 CSV 改写

`import-legacy` 的行为不变：它仍然整文件重读，不写检查点。已经用它导入过的目录，第一次 `sync-legacy --execute` 会把已有行计为冲突，然后记下检查点。

## 限制

- 没有换行的最后一行要等下一轮出现换行才入库
- 检查点按文件名，不按绝对目录。发布目录应固定
- 只认文件名 `BV*_views.csv` 和数字 `*_follower.csv`，不读子目录
- 表头必须是旧采集的那一行：视频 `时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕`，粉丝 `时间,粉丝数`
- 拒绝的完整行在本批提交后不会再试；原文记在 `import_conflicts_or_rejects`
- 重扫会重新解析该文件。未变化的文件不会
- 一轮在某个文件中途失败时，该文件已提交的前缀在检查点里；轮次计数只包含已经结束的文件
