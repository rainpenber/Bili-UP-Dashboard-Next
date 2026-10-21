# WP-R2-16B 单条动态互动监控：历史与实时样本存储

## 边界

只做 `packages/db` 里动态实体和互动样本的增量存储、来源追溯和事务写入。16A 解析详情；本包把解析结果映射到已有的 `dynamics` 与 `dynamic_metric_samples`。下一包才能把 worker 或监控目标接上来。

不启用动态采集，不创建目标，不增加 API 或 UI，不合并，不部署。`monitor_targets` 仍只有视频和 UP 主。

## 实现

- `packages/db/migrations/011_dynamic_sample_storage.sql`：给 `dynamic_metric_samples` 增加 `source`、`account_id`、`collector_run_id`、`collected_at`、`extra` 和两个索引。不改旧迁移。
- `packages/db/src/dynamic-samples.ts`：`writeDynamicSampleWithin` 与 `writeDynamicSample`。输入类型由数据库包自己导出，不引用 `packages/monitoring`。
- `packages/db/src/dynamic-samples.integration.test.ts`：在新建且保留的逻辑库上验证升级、幂等、事务和父项删除。
- 字段、冲突和未接入说明见 `docs/architecture/dynamic-sample-storage.md`。

## 不变量

1. 升级不改历史主键、业务字段、计数和采样时间。已有样本的 `source` 为 `import`，账号、运行和 `collected_at` 为空。重复执行迁移不改这些值，也不会把后来写成 `bilibili` 的行改回 `import`。
2. 作者、动态 metadata 和样本在同一事务里提交或一起回滚。动态 id 保持十进制字符串。计数是可空 BIGINT，`0` 与 `null` 分开，拒绝负数和超出 BIGINT 的值。缺失 metadata 不把旧键写成空。业务分类、归档、删除和 `monitoring_enabled` 不被写入路径修改。
3. 同一个 `(dynamic_id, sampled_at)` 只保留一行。冲突返回 `false`，并且不覆盖已有的 `import`、`legacy_csv` 或 `bilibili` 样本。`source`、账号、运行、`collected_at` 和 `extra` 来自这次调用的显式输入。

## 明确不做

不发现新动态，不改调度、限流和鉴权，不改 API、页面、Docker、CI 或旧采集器。验收使用新建的 `wp_r2_16b_hist_*` 与 `wp_r2_16b_write_*` 逻辑库，测试结束只关闭连接，不 `DROP` 这些库，也不清理共享库。
