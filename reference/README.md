# reference/ — 只读参考资料

本目录**不是产品代码**，不参与构建、类型检查、lint 与格式检查。

## 内容

| 目录 | 来源 | 用途 |
| --- | --- | --- |
| `legacy-collector/` | 旧版采集脚本 `D:\App\scripts\v2`（Windows，已稳定运行 1 年多） | 行为锚点：接口选择、频率、错误处理、字段解析 |
| `legacy-collector/samples/` | 旧系统实际产出的 CSV（各 1 个样例） | 历史数据导入的格式依据 |
| `legacy-frontend/` | 旧版前端 `D:\App\video-data-gui` 的 `src/` 与配置 | 只用于理解旧页面展示了什么字段，不作为 UI 规范 |
| `bilibili-api/` | 社区维护的 wild API 文档，固定 commit `cfc5fddcc8a94b74d91970bb5b4eaeb349addc47`（上游 `https://github.com/BACNext/bilibili-API-collect-backup`） | 接口与字段的**唯一**依据，禁止凭记忆写字段名 |

## 规则

1. **只读**。不要修改、不要 import、不要在本目录里加测试。
2. 旧代码里的 `cookie.txt`、`session.json`、`wbi_cache.json` **未纳入**（含真实凭据），任何情况下都不得重新加入。
3. 旧代码的注释与命名（中文键、`video_config.conf`）保留原样，便于对照；新实现不要沿用 CSV 落盘和 `schedule` 库。
4. 文档是社区维护的非官方契约，字段可能过期；实现前以真实响应为准，并在 PR 中记录实测结果。
