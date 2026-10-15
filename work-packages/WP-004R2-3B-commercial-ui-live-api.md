# WP-004R2-3B — 商单界面改读真实 API

从 `49a85f2145b17ac7969798f79a6ced2a3f589237` 开始。没有改写入接口的规则，也没有新增读取字段。

## 页面

- 列表、今日看板、项目详情和流程图读取 `GET /projects`、`GET /projects/:id`、`GET /projects/:id/workflow`。
- 集成页读取 `GET /templates/default`，并写明编辑和发布新版本还没有接到后端。
- 节点按钮按状态机只提供不会被 `invalid_transition` 拒绝的操作。空白阻塞原因可以提交。回退和不适用被拒绝时，显示服务器的 `error` 和 `names`。
- 发布节点的完成操作提交平台、BV 号或视频链接，以及每次点击新生成的幂等键。当次响应里的发布记录和 metadata、metrics 任务会显示出来。
- `409 stale_write` 会重新加载该项目，并说明不会自动重试。

## 读取结果里没有的字段

- 实例节点没有 `isOptional`。同一 `templateVersionId` 的已发布默认模板按唯一名称提供这个标记；版本对不上时不提供「不适用」。
- 项目读取不返回开放事项列表。页面显示 `blockingReason`。关闭和取消只用刚才写入响应里的事项编号和 `updatedAt`，刷新后不能再提交。
- 项目读取不返回监控任务。任务行只出现在发布操作的响应里。
- 计划时间、阻塞天数、事项分工不在这些读取结果里，列表和详情不再显示它们。项目图上的增删节点和连线也没有写入接口，详情页不再提供。

## 种子

`bun run seed:commercial` 执行迁移并调用 `packages/db` 里已有的 `seedCommercialFixtures`。应用启动不会调用它。

## 测试

动作门控在 `node-actions.test.ts` 和 `node-action-panel.test.tsx`。写入拒绝和过期令牌在 `commercial-writes.test.tsx`。

原先 `?commercialMockError=1` 只用于让 Mock 客户端抛错，查询层已删除这段开关，对应测试一并去掉。默认流程页不再编辑内存草稿，`default-flow-editor.test.tsx` 改为断言只读展示；结构编辑仍由 `workflow-graph-editor` 的测试覆盖。列表排序测试改为针对真实列表字段，不再依赖 Mock 里的阻塞天数和事项分工。
