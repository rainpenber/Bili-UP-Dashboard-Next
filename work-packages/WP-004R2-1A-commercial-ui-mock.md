# WP-004R2-1A — 商单页面 UI 壳 + 只读工作流图（Mock）

## 目标

在产品负责人确认信息架构之前，交付可点击的商单预览：**仅演示数据**，不接数据库与 Hermes 写入。

## 交付面

| 路由                   | 内容                                         |
| ---------------------- | -------------------------------------------- |
| `/`                    | 今日看板三块：我方待办、等甲方、阻塞节点汇总 |
| `/projects`            | 项目列表（卡片可展开）                       |
| `/projects/:projectId` | 概要、当前状态、只读流程图                   |
| `/integrations`        | 新项目默认流程（只读）                       |

## 刻意未做

- 可编辑流程图、节点推进/回滚、阻塞原因录入
- API / 数据库 / 真实发布与 B 站投稿
- 看板视图；「财务结案」导航已移除（非本包范围）

## 复审修正（bounded）

- 并行节点横向并列 + 分叉/汇合；全量流程灰色未到节点
- 桌面多栏布局；`?commercialMockError=1` 与 Query Key 联动

## 演示数据

见 `apps/web/src/features/commercial/mock-data.ts`。URL 加 `?commercialMockError=1` 可触发错误态。

## 验收命令

```bash
bun run typecheck
bun run test
bun run build
bun run format
bun run lint
```
