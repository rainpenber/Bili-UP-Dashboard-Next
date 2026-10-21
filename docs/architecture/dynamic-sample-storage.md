# 动态样本存储（未接入采集）

WP-R2-16B。这一包只给已经存在的 `dynamics` 和 `dynamic_metric_samples` 补上可追溯的增量写入。16A 负责把一条动态详情解析成字段；这里负责把这些字段放进现有表。不创建监控目标，不改调度，不调用 B 站，也不增加 HTTP 或页面。

## 表

不新建实体表或样本表。动态 id 仍是 `dynamics.dynamic_id`（TEXT 主键）。作者仍是 `dynamics.mid`，外键指向 `creators.mid`。点赞、转发、评论仍是 `dynamic_metric_samples` 上的 `like_count`、`repost_count`、`comment_count`。幂等键仍是 `(dynamic_id, sampled_at)`。

`011_dynamic_sample_storage.sql` 只给样本表增加与视频、作者样本相同的来源列：

| 列                 | 含义                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `source`           | `import`、`legacy_csv`、`bilibili`。已有行使用列默认值 `import`。   |
| `account_id`       | 采集账号。外键 `bili_accounts`，`ON DELETE SET NULL`。已有行为空。  |
| `collector_run_id` | 采集运行。外键 `collector_runs`，`ON DELETE SET NULL`。已有行为空。 |
| `collected_at`     | 这次观测的时间。已有行为空，迁移不补抓取时间。                      |
| `extra`            | JSON 对象，默认 `{}`。                                              |

`sampled_at` 是幂等桶。`collected_at` 是另一次时间，不参与唯一约束。两个时间可以相同，也可以不同；冲突只看 `(dynamic_id, sampled_at)`。`raw_time` 和 `source_timezone` 仍是原来的展示时间，也不是幂等键。

索引与视频、作者样本对齐：`dynamic_samples_run (collector_run_id)`，`dynamic_samples_source_at (source, sampled_at DESC)`。原有的 `(dynamic_id, sampled_at)` 索引保留。

`monitor_targets.type` 仍只有 `video` 和 `creator`。本迁移不修改目标 CHECK。

## 字段映射

详情里的基本信息进入 `dynamics.metadata` 这个已有 JSONB 对象。不为每个解析字段加列。计数进入样本行。`mid` 只走外键。

| 输入                                                | 去向                                          | 缺失时                                                                               |
| --------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `dynamicId`                                         | `dynamics.dynamic_id`、样本 `dynamic_id`      | 必须是十进制整数字符串，不能是 `0` 或带前导零。按原文存储，不转成 `Number`。         |
| `authorMid`                                         | `creators.mid`、`dynamics.mid`                | 空则不新建作者，也不把已有 `mid` 改成空。超出 PostgreSQL BIGINT 的值拒绝。           |
| `authorName`                                        | `creators.uname`，以及 `metadata.author_name` | 空白视为缺失。已有名字保留。                                                         |
| `faceUrl`                                           | `metadata.author_face`                        | 不写 `creators.face_url` 或 `face_asset_id`。                                        |
| `text`                                              | `metadata.text`                               | 空白视为缺失。                                                                       |
| `dynamicType`                                       | `metadata.dynamic_type`                       | 空白视为缺失。                                                                       |
| `majorType`                                         | `metadata.major_type`                         | 空白视为缺失。                                                                       |
| `visible`                                           | `metadata.visible`                            | 只有布尔值。`false` 会写入。空则保留旧值。                                           |
| `publishedAt`                                       | `metadata.published_at`，UTC ISO 字符串       | 无效时间拒绝。空则保留旧值。                                                         |
| `publishedText`                                     | `metadata.published_text`                     | 空白视为缺失。                                                                       |
| `likeCount` / `repostCount` / `commentCount`        | 样本同名列                                    | 必须是 `bigint` 或 `null`。`0` 写成 `0`。负数和大于 `9223372036854775807` 的值拒绝。 |
| `sampledAt`                                         | `sampled_at`                                  | 必须是有效时间。这是幂等桶。                                                         |
| `collectedAt`                                       | `collected_at`                                | 有效时间或 `null`。不从 `sampled_at` 推导。                                          |
| `source` / `accountId` / `collectorRunId` / `extra` | 同名来源列                                    | 按调用方给出的值保存。`extra` 必须是 JSON 对象。                                     |

未知输入属性不进入 metadata。合并用 `已有对象 || 本次对象`：本次没有给出的键保持原样，不会被 `null` 盖掉。metadata 以 JSON 对象写入，`->>` 可以直接读到键。调用方传入的对象不会先变成 JSON 字符串再存进 JSONB。

`category`、`archived_at`、`deleted_at`、`monitoring_enabled` 是用户业务状态。写入路径不读取、不更新这些列。已停用或已删除的动态可以追加一个新采样桶，但这些标志保持原值。新行使用表默认值：`monitoring_enabled` 为 true，分类和归档、删除时间为空。

## 事务与冲突

`writeDynamicSampleWithin(tx, input)` 在调用方事务里执行。`writeDynamicSample(sql, input)` 是同一套语句的提交包装。校验在第一条 SQL 之前完成，拒绝的输入不会留下作者、动态或样本。

成功路径：

1. 按 `dynamic_id` 插入动态壳子。已存在则什么都不改。
2. 插入样本。`(dynamic_id, sampled_at)` 冲突则整次调用结束并返回 `false`。
3. 只有样本真正插入时，才按非空 `authorMid` 补作者，并合并 metadata、补上 `mid`。

返回 `true` 时，持久化的计数、来源和 metadata 属于这次输入。返回 `false` 时，已有样本、作者和动态 metadata 都保持原样，包括原来的 `import`、`legacy_csv` 或 `bilibili` 行。不同的 `sampled_at` 可以各插一行。

账号或运行不存在时，样本插入违反外键，包装事务回滚，壳子和作者一起消失。调用方在自己的事务里抛出错误时，同样全部回滚。

离线导入仍按原来的列清单写入样本，不经过这个函数。新列使用默认值：`source = import`，`extra = {}`，账号、运行和 `collected_at` 为空。再次导入同一桶仍然是 `ON CONFLICT DO NOTHING`，不会改写已有行。

## 删除

只在调用方自己的数据上删除。规则与视频、作者样本的父项一致：

| 删除                             | 结果                                  |
| -------------------------------- | ------------------------------------- |
| `bili_accounts`                  | 样本留下，`account_id` 变为空。       |
| `collector_runs`                 | 样本留下，`collector_run_id` 变为空。 |
| 仍被样本引用的 `dynamics`        | 语句失败，动态和样本都留下。          |
| 仍被动态引用的 `creators`        | 语句失败，作者、动态和样本都留下。    |
| 没有动态的作者，或没有样本的动态 | 该行删除，其它实体不跟着变化。        |

失败的删除语句不会继续改下一张表。

调试包 `GET /api/v1/ops/debug/bundle` 的 `schemaVersion` 取 `schema_migrations` 里按版本名倒序的第一条。加上 `011_dynamic_sample_storage` 之后，这个值从 `010_` 变为 `011_dynamic_sample_storage`。路由代码没有改；空库时的回退字符串仍是原来的 `009_refresh_request_audit`。消费方测试里对最新迁移前缀的断言随之改为 `011_`。

## 还没有接入的部分

- `monitor_targets` 没有动态类型，调度器不领取动态任务。
- 不调用 16A 的 `fetchDynamic`，不访问 B 站。
- 不改 `packages/monitoring`、`packages/contracts`、`apps` 的 API 或页面。
- 历史导入行的 `source` 是 `import`，因为它们来自导入。`collected_at` 保持为空，而不是填上迁移执行的时间。
