# 动态详情适配（未接入采集）

WP-R2-16A。这里只增加「指定一条动态」的上游读取能力。它不创建监控目标，不进调度，不写 `dynamics` / `dynamic_metric_samples`，也没有新的 HTTP 或页面。采集器现在仍然只跑视频和 UP 主。

## 请求

`GET https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=`

`id` 是这条动态自己的 id，类型在调用边界上是字符串。只接受十进制整数字符串，且不能是 `0` 或带前导零。校验失败时不构造 URL、不打日志、不占用限流名额。通过校验后，dry-run 只打印这一条 URL，传输层调用次数是 0。正式请求恰好一次。

不附加 `timezone_offset`、`features`、`w_rid` 或 `wts`。文档里这些参数不是必要项。旧脚本在 `-352` 之后刷新 WBI 再打一次，这里不复刻：风控码沿用现有分类后直接退出，不再请求 `nav`、二维码、动态列表或签名密钥。

传输、请求头和账号配额都走 `createBilibiliProvider` 里原有的 `request` 闭包：`guardTransport`、`bilibiliHeaders`（桌面 Chrome `User-Agent` 与 `Referer: https://www.bilibili.com/`），以及同一个 `acquireRequestSlot` / 内存节流。没有第二个 HTTP 客户端，也没有单独的动态限流器。`calls[].endpoint` 固定为 `dynamic_detail`。

## 字段

依据是仓库内 `reference/bilibili-api/detail.md`（固定 commit `cfc5fddcc8a94b74d91970bb5b4eaeb349addc47`）。该文档写明 `data.item` 参照同一 commit 的动态列表条目；列表条目和 `module_author` / `module_stat` 的字段表不在本仓库的 `reference/` 里，下面凡是详情示例里没有直接出现的结构，都注明了那份同 commit 文档。

| 结果            | 来源                                          | 说明                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamicId`     | `data.item.id_str`                            | 必须是字符串，并与请求的 id 逐字相同。不用 `basic.comment_id_str`、`basic.rid_str`、`major.draw.id`、三点菜单里的 `dyn_id_str`，也不用 `orig.id_str`。数字形式的 `id_str` 直接失败，避免长 id 被 `Number` 吃掉精度。 |
| `likeCount`     | `data.item.modules.module_stat.like.count`    | 本条动态的点赞。`0` 保留为 `0n`。键、对象或 `count` 缺失，以及 JSON `null`，都是 `null`，不补 `0`。                                                                                                                  |
| `commentCount`  | `data.item.modules.module_stat.comment.count` | 本条评论数。规则同上。                                                                                                                                                                                               |
| `repostCount`   | `data.item.modules.module_stat.forward.count` | 本条转发数。将来的 `dynamic_metric_samples.repost_count` 用这个值。名字沿用现有样本类型，不另建模型。                                                                                                                |
| `authorMid`     | `data.item.modules.module_author.mid`         | 安全非负整数或十进制字符串，结果仍是字符串。不读 `avatar.mid`。缺失为 `null`。不安全 `Number` 失败，不截断。                                                                                                         |
| `authorName`    | `module_author.name`                          | 非空字符串，否则 `null`。                                                                                                                                                                                            |
| `faceUrl`       | `module_author.face`                          | 非空字符串，否则 `null`。只解析，不下载。                                                                                                                                                                            |
| `publishedAt`   | `module_author.pub_ts`                        | UNIX 秒。缺失为 `null`。                                                                                                                                                                                             |
| `publishedText` | `module_author.pub_time`                      | 文档中的展示文案，例如「2024年08月20日 19:17」。                                                                                                                                                                     |
| `text`          | `modules.module_dynamic.desc.text`            | `desc` 按列表文档可以为 null。                                                                                                                                                                                       |
| `majorType`     | `modules.module_dynamic.major.type`           | 转发条目的 `major` 按列表文档为 null，此时这里是 `null`。                                                                                                                                                            |
| `dynamicType`   | `data.item.type`                              | 例如详情示例的 `DYNAMIC_TYPE_DRAW`。未知字符串照原样保留。                                                                                                                                                           |
| `visible`       | `data.item.visible`                           | 只有布尔值。其它类型当缺失，为 `null`。                                                                                                                                                                              |

整数在结果里是 `bigint`。写入 PostgreSQL 时仍用现有的十进制字符串约定（`pgBigint`）；这一包不写库。负数、小数、非数字和不安全 `Number` 都失败。超过安全整数范围的计数只有在响应里是十进制字符串时才保留原值。

`DYNAMIC_TYPE_FORWARD` 的 `orig` 是同一条响应里的原动态（列表文档：仅转发类型存在）。解析器不进入 `orig`。转发帖的点赞、评论、转发只取本条 `module_stat`。原帖正文、原作者和原帖计数都不能填到这条动态上。详情示例没有转发形态；单测里的转发夹具是按该结构合成的，并在夹具里标明了这一点。

`data` 或 `item` 缺失、`id_str` 缺失、`id_str` 与请求不一致，都是解析失败。未知形态可以让作者、正文和计数保持 `null`，但不能假装拿到了另一条动态。

## 错误

分类函数没有改。`dynamic_detail` 只是 `UpstreamEndpoint` 的一个新名字，`-101`、`-352` / `-412`、`-509`、HTTP 404 / 业务码 `-404`、HTTP 5xx、非法 JSON、解析失败和传输超时都进原来的类别。超时在现有 `request` 闭包里就是 `retryable`，这里不另做重试。

详情文档的根对象还写了业务码 `4101139`，备注仍是「4101139」，没有给出类别。它继续走「非 0 业务码 → retryable」，不新增类别。

失败对象保留已经发生的那一次 `calls`。响应里的 `SESSDATA` 仍由现有清洗去掉。dry-run 日志只有 URL。

## 还没有接入的部分

16C 已把指定动态接到目标和 worker。下面是 16A 完成时的状态，页面管理仍未做。见 `docs/architecture/dynamic-target-execution.md`。

- `monitor_targets` 在 16A 完成时仍只有视频和 UP 主。当时 `runBilibiliJob` 不调用 `fetchDynamic`。
- 离线 provider 没有这个方法。`COLLECTOR_PROVIDER=offline` 的行为不变。
- 不写 `dynamics`、`dynamic_metric_samples`，不改迁移和契约，不加路由或卡片。
- 不拉动态列表，不发现 UP 主的新动态，不抓评论正文或弹幕，不请求赞与转发名单，也不请求抽奖详情。

因此这条能力还不能叫做动态监控已经完成。后续包才能把它接到现有动态实体、样本、目标和页面上。

## 夹具

`packages/monitoring/fixtures/dynamic/detail-draw.json` 裁剪自 `detail.md` 的响应示例。`detail-forward.json` 使用列表文档里的转发条目身份和本条计数，原帖计数与作者显示名是测试合成。两份文件的 `_fixture.origin` 分别是 `document-derived` 和 `test-synthesized`，都写明不是真实实测响应。本包没有获准的动态 id 或请求预算，测试不访问 B 站。
