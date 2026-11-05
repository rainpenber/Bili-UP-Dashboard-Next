# WP-OC-014 金额模型：平台下单价格 / 商议返点 / 实际转款

## 术语（以此为准）

- **平台下单价格** = 平台实际下单并被平台打款的金额。**下单价格与打款金额是同一个数**，不拆两个字段。
- **口头商单价格**：最初谈的口头价（如 Pocket4 36000、海信 36000），只写进判定理由，不建字段。
- **上报价/溢价价格**：中介向平台报高的价格（如 Pocket4 38000），同样只写理由与原话，不建字段。
- **商议返点比例**：最初谈定的比例（Pocket4 0.30、海信 0.25）。
- **实际返点转款**：我们真实转给中介的钱（沿用 `rebate_amount`）。
- **到手金额**：真实收入（沿用 `net_amount`）。

恒等式：`net_amount + rebate_amount = platform_amount`（六个项目历史数据都成立；差异用软校验返回，不阻断写入）。

派生值不落库：`actualRebateRate = rebate_amount / platform_amount`、`amountGap = platform_amount - rebate_amount - net_amount`。

## 范围

1. 迁移 `030_commercial_platform_amount.sql`
   - `platform_amount NUMERIC(14,2) NULL` 平台下单价格（= 打款）
   - `agreed_rebate_rate NUMERIC(6,4) NULL` 商议返点比例，0~1
   - 同步更新 `packages/db/src/dynamic-samples.integration.test.ts` 迁移清单
   - 不回填历史数据
2. 契约 `packages/contracts/src/commercial.ts`
   - `PUT /projects/:id/amount` 新增可选 `platformAmount`、`agreedRebateRate`（null 可清空）
   - 详情响应新增 `platformAmount`、`agreedRebateRate`、`actualRebateRate`、`amountGap`
   - 校验：rate 0~1；金额两位小数
3. API `apps/api/src/commercial-write.ts`
   - `updateProjectAmount` 写两列，审计 `amount_update` 记录新旧值
   - 读侧计算派生值
   - 更新 `apps/api/src/commercial.integration.test.ts` 的 SQL 与行类型
4. 前端 `apps/web/src/features/commercial/`
   - 详情页金额行：`到手 ¥26,602 · 返点转款 ¥5,320 · 实际返点 16.7%`
   - 问号弹层只显示：**平台下单价格、商议比例、判定理由、依据原话**
   - 金额编辑弹窗增加：平台下单价格、商议返点比例
   - 类型、live fixture、测试同步（含「弹层不出现到手金额」断言）
5. 回填（走 API）：
   - 树新风：platform 39000，rate 0.28，rebate 10920，net 28080
   - 哈曼卡顿：36000 / 0.20 / 7200 / 28800
   - Looki L1：27300 / 0 / 0 / 27300
   - 大疆全景：20000 / 0 / 0 / 20000
   - 大疆 Pocket4：31922 / 0.30 / 5320 / 26602（口头 36000，上报 38000，38000×0.84=31920 与平台实付 31922 差 2 元，理由里注明）
   - 海信 E8S：36722 / 0.25 / 9722 / 27000（口头 36000，溢价 3000 上报 39000，平台打款 36722；待甲方最终公式）
6. 理由文案统一格式：`平台下单价格xxx，商议返点xx%/xx元，实际转款xx元（依据：“原话”）`

## 不做

- 不拆分「下单价 / 打款额」
- 不加「上报价格」「溢价」「专票税」字段
- 不动列表卡片
- 不新增路由，不改 `docs/architecture/api-inventory.json`

## 验收

- `bun run typecheck` 无错
- `bun test packages/contracts`、`apps/web`、`apps/api/src/commercial.integration.test.ts`、`http-coverage.integration.test.ts` 全绿
- 详情页三数正确，弹层只含三块内容
- 六个项目数值与上面一致
