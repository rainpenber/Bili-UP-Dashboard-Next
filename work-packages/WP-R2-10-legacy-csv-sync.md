# WP-R2-10 旧 CSV 增量同步

起点：`cursor/creator-video-crosslink-2f40` @ `1577285a525bf675cc22b4222d81bb4494452c14`。本包只做 CSV 增量同步，不启动全量 API 联调、日志队列加固或请求间隔复测，不访问 B 站，不读取凭据。

## 背景

Windows 旧采集仍在 `D:\App\scripts\v2` 写 CSV。Hermes 只读点过匹配的视频/粉丝文件：100 个、10804124 字节。这些文件已经一次性导入测试库，之后的新增没有自动同步。

现有 `import-legacy` 每次整目录重读，逐批 `INSERT ... ON CONFLICT DO NOTHING`，没有持久化进度。本包在它旁边加 `sync-legacy`：未变化文件不解析；追加只处理新的完整行；截断、替换和等长改写会整文件重扫，但不覆盖已有样本。

## 不变量

1. 续传：重复或并发执行不重复写。只有提交成功的完整行才推进检查点。未完成尾行留在文件里。
2. 不破坏数据：不改、不删、不停旧源。实时样本和历史样本不被 CSV 覆盖。标题、头像、封面、关联不被旧导入改写。冲突单独计数。不同时间的样本都保留。
3. 任务可诊断：独立入口，数据库 advisory lock 单实例，默认 dry-run，默认间隔 15 分钟。每轮能看到状态、新增、冲突、拒绝、耗时和最近成功时间。失败后从检查点重试。

## 边界

只做本地只读目录到数据库。宿主负责把 Windows 快照临时写好再原子发布。仓库和镜像不放 SSH、主机密钥或 Windows 访问配置。

允许改动：`packages/monitoring` 的 legacy 同步与解析导出，`packages/db` 的检查点迁移 `010_legacy_csv_sync` 和写入函数，`apps/collector` 的 `sync-legacy` CLI，opt-in 的 `docker-compose.legacy-sync.yml`，测试和文档。日志只把 `legacy.sync.started` / `legacy.sync.finished` / `legacy.sync.failed` 加进 info 白名单。

不做商单、工作流、图表、作者互查、采集调度、限流、登录，也不改样本唯一键和 `source` 语义，不让默认 Compose 自动拉起同步。

## 实现要点

- 时区仍是 `Asia/Shanghai`，分钟精度。历史视频评论保持 NULL。`source` 为 `legacy_csv`。
- 检查点在 `legacy_csv_sync_checkpoints`，和该批样本、拒绝行、`import_batches` 同一个事务。
- 水位是文件偏移加前缀/边界哈希，不是最新 `sampled_at`。
- 样本写入复用 legacy 导入的列和 `ON CONFLICT DO NOTHING`，内层不再 `BEGIN`。
- dry-run 不写检查点、样本、导入记录或轮次。

操作、恢复和冲突规则见 [docs/architecture/legacy-csv-sync.md](../docs/architecture/legacy-csv-sync.md)。

## 验收

隔离库上的集成测试覆盖：首次导入、重复执行、追加一行、未变化文件跳过、二十万行第二轮不逐行导入、不完整尾行、CRLF 与 UTF-8 边界、非法行、表头变化/缺失、截断与等长替换、迟到行、目录或文件丢失、两进程互斥、事务中断后重试、已有 `bilibili` 样本不被覆盖、dry-run 零写、`--once` 与轮询退出释放锁、状态与 ops 日志可查、`import-legacy` 仍不写检查点。

CI 在 `CI=true` 且 PostgreSQL 不可用时会失败，不会把缺库当成通过。
