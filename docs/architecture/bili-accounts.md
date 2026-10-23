# B 站采集账号管理（WP-R2-25A）

多账号、凭据过期状态与软撤销。采集登录账号与「本人 B 站账号」（`studio_owner_account`，供「只看我的」）相互独立。

## 数据

| 表 / 列                    | 说明                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `bili_accounts`            | mid / uname / status / is_default / cookie_expires_at / last_verified_at / last_used_at / note |
| `bili_accounts.revoked_at` | 迁移 `019_account_revoked_at`；软撤销时间                                                      |
| `bili_account_secrets`     | AES-256-GCM（ciphertext / iv / auth_tag / key_version），密钥 `COLLECTOR_SECRET_KEY`           |

回滚：`ALTER TABLE bili_accounts DROP COLUMN IF EXISTS revoked_at;`

## HTTP

| 方法   | 路径                          | 行为                                                                                               |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/accounts`            | 列表；含 `secretPresent`、`derivedExpiryState`、`realAccessEnabled`                                |
| POST   | `/api/v1/accounts`            | `{ cookie, note?, mid?, replace? }`；离线解析 Cookie，不访问 B 站；同 mid 409，除非 `replace:true` |
| PATCH  | `/api/v1/accounts/:id`        | `note` / `isDefault`；设默认时事务内取消其余默认                                                   |
| POST   | `/api/v1/accounts/:id/verify` | 显式 nav 校验；`MONITOR_DATA_SOURCE=mock` 或非 `bilibili` provider → 409 `real_access_disabled`    |
| DELETE | `/api/v1/accounts/:id`        | 删 secret、`status=revoked`、`revoked_at=now`；允许无默认；保留账号行                              |

`derivedExpiryState`：`ok`｜`expiring_soon`（≤7 天）｜`expired`｜`missing_secret`｜`revoked`。

响应、审计日志只记 `accountId` 与动作，不含 Cookie 明文 / 密文 / iv / tag。

## 采集选账号

`resolveCollectorAccount` 仅返回同时满足以下条件的账号：

1. `status = 'active'`
2. `bili_account_secrets` 有行
3. `cookie_expires_at` 为空或晚于当前时间

已撤销、过期、缺凭据的账号被跳过；任务节奏不因此改成 defer（相对旧的「过期默认仍选中再 defer」）。

## UI

- `/integrations` 设置页「B 站账号」分区
- `/settings/accounts` 独立页

操作：设为默认、撤销（二次确认）、重新校验（mock 下禁用）、粘贴 Cookie 新增。
