# 视频「只看我的」筛选（WP-R2-MON-04）

## 数据

`studio_owner_account` 单例表（迁移 `015_studio_owner_account`）：

| 列             | 说明                                        |
| -------------- | ------------------------------------------- |
| `id`           | 固定 `1`                                    |
| `mid`          | 本人 B 站 UID（bigint，API 用十进制字符串） |
| `display_name` | 显示名                                      |
| `updated_at`   | 最后更新时间                                |

种子：`mid=3493141386627335`，`display_name=狐正正`。`INSERT … ON CONFLICT DO NOTHING`，重放不覆盖。

## 接口

| 方法  | 路径                                          | 说明                                                                             |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET` | `/api/v1/monitor/settings/owner-account`      | 读本人账号；缺失 404                                                             |
| `PUT` | `/api/v1/monitor/settings/owner-account`      | `{ mid, displayName }`；非法 UID / 空名 400                                      |
| `GET` | `/api/v1/monitor/cards?type=video&onlyMine=1` | 按配置 mid 过滤后再 count/排序/分页；配置缺失 400 `owner_account_not_configured` |

`onlyMine` 对 `type=creator` 忽略。mid 全链路十进制字符串，不转 `Number`。

## UI

- 视频 tab 筛选栏 Toggle「只看我的」→ URL `onlyMine=1`；身份说明放在按钮 `title` / `aria-description`（如「只显示 狐正正 的视频」），不在布局中展示昵称与 mid。
- 集成与设置页「本人 B 站账号」表单；保存后失效 `monitor/cards` 查询。
- 与分类 / 关键词 / 监控状态 / 排序 / 布局 / 详情返回兼容。
