# WP-R2-25A — B站账号管理：多账号、凭据过期、撤销

## 目标

1. `GET/POST/PATCH/DELETE /api/v1/accounts` 与 `POST .../verify`
2. 迁移 `019_account_revoked_at`；软撤销删 secret、保留账号行
3. 列表派生 `derivedExpiryState`；响应与日志不含 Cookie 明文/密文
4. 采集仅选 active + secret + Cookie 未过期账号
5. 设置页「B 站账号」与 `/settings/accounts`

## 不做

- 不自动校验、不后台轮询 B 站
- 不改采集限频与任务节奏参数
- 不级联删除监控目标/样本
- 不部署生产、不触碰真实账号 secret

## 验收

- 新增 / 重复 mid 409 / 设默认原子 / 撤销后不可再被选中 / 非法 id 404 / mock 下 verify 409
- inventory / http-coverage 已更新；typecheck / test / build / lint / format 绿
- 文档：`docs/architecture/bili-accounts.md`
