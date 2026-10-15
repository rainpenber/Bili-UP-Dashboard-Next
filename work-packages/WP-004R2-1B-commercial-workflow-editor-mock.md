# WP-004R2-1B — 项目工作流图可编辑（Mock 页内状态）

## 目标

项目详情页 `/projects/:projectId` 上，产品负责人可在流程图中推进/回退节点、标记与解除阻塞、撤销/重做；概要卡与当前状态区随编辑更新。**无 API/数据库**，刷新恢复 Mock。

## 范围

- `apps/web/src/features/commercial/**`：编辑规则、编辑器 UI、页内 undo/redo
- 集成设置默认流程仍为只读（R2-1C）

## 未做

- 改结构、默认流程发布、持久化、Hermes/采集器

## 会合点标记

并行层交界处的水平段画在连接线自身的 1px 描边上。线与线会合的每一处单独放一颗约 10px 的圆点（连接点强调色 `#FF6603`），不画横贯全宽的色条。圆点只用于显示，不进入流程数据，也不可编辑。

## 验收

```bash
bun run format && bun run lint && bun run typecheck && bun run test && bun run build
```
