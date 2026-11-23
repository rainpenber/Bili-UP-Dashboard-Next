-- WP-OC-015: rebate ledger. One row per owed rebate; the project-level
-- commercial_projects.rebate_amount stays the single source of truth for
-- linked rows, and expected_amount is only a historical snapshot.
CREATE TABLE commercial_rebates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NULL REFERENCES commercial_projects (id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  counterparty TEXT NULL,
  expected_amount NUMERIC(14, 2) NULL,
  is_returned BOOLEAN NOT NULL DEFAULT FALSE,
  returned_at DATE NULL,
  contract_state TEXT NOT NULL DEFAULT 'none' CHECK (contract_state IN ('none', 'sent', 'signed')),
  invoice_state TEXT NOT NULL DEFAULT 'none' CHECK (invoice_state IN ('none', 'received')),
  note TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  stage_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_commercial_rebates_project UNIQUE (project_id)
);

CREATE INDEX idx_commercial_rebates_is_returned ON commercial_rebates (is_returned);

-- 2026 history. Fixed ids keep the seed idempotent on re-run. Linked rows read
-- commercial_projects.rebate_amount; the three open rows point at the live
-- projects so platform-paid and amount stay derived, not copied.
INSERT INTO commercial_rebates (
  id, project_id, project_name, counterparty, expected_amount,
  is_returned, returned_at, contract_state, invoice_state, note
) VALUES
  ('c0b00001-0000-4000-8000-000000000001', NULL, '坚果投影仪2026', '网飞（广州）娱乐经纪', 10500.00,
    TRUE, '2026-05-31', 'signed', 'received',
    '发票 9,905.66（6% 专票，价税合计 10,500.00）；返点已转。'),
  ('c0b00002-0000-4000-8000-000000000002', NULL, '海信电视2026', '网飞（广州）娱乐经纪', 7800.00,
    TRUE, '2026-04-06', 'signed', 'received',
    '发票 7,358.49（6% 专票，价税合计 7,800.00）；返点已转。'),
  ('c0b00003-0000-4000-8000-000000000003', NULL, '光子跃迁运动相机', '上海谐致', 12600.00,
    TRUE, '2026-05-11', 'signed', 'received',
    '发票 11,886.79（6% 专票，价税合计 12,600.00）；返点已转。聊天约定 3.3W×20%=6,600，多出 6,000 待确认。'),
  ('c0b00004-0000-4000-8000-000000000004', NULL, 'AandC空气净化器', '武汉微思敦', 9750.00,
    TRUE, '2026-02-09', 'signed', 'received',
    '发票 9,198.11（6% 专票，价税合计 9,750.00）；返点已转。'),
  ('c0b00005-0000-4000-8000-000000000005', NULL, '安克TWS降噪耳机', '武汉微思敦', 9750.00,
    TRUE, '2026-05-21', 'signed', 'received',
    '发票 9,198.11（6% 专票，价税合计 9,750.00）；返点已转。'),
  ('c0b00006-0000-4000-8000-000000000006', NULL, '鹿客门锁', '杭州慕凡', 9750.00,
    TRUE, '2026-05-11', 'signed', 'received',
    '发票 9,653.47（1% 普票，价税合计 9,750.00）；返点已转。'),
  ('c0b00007-0000-4000-8000-000000000007', NULL, '韶音耳机8月', NULL, 9900.00,
    TRUE, '2026-08-29', 'signed', 'received',
    '聊天记录称 7 月发票已开、款项收讫；本批截图无对应影像，税额未核实。'),
  ('c0b00008-0000-4000-8000-000000000008', NULL, '大疆nano', NULL, 6600.00,
    TRUE, '2026-07-30', 'signed', 'received',
    '各笔款项抵扣后中介应付 11,393.25 已到账；无发票影像，税额未核实。'),
  ('c0b00009-0000-4000-8000-000000000009', NULL, '大疆 Pocket4', NULL, 5320.00,
    FALSE, NULL, 'signed', 'none',
    '待开票；11/20 已催；期望 11,400、实转 5,320，差额 6,080 已在改价下单时抵扣。'),
  ('c0b0000a-0000-4000-8000-00000000000a', NULL, '海信E8S_2026', NULL, 9722.40,
    FALSE, NULL, 'signed', 'received',
    '待打款；30 元专票税待核。'),
  ('c0b0000b-0000-4000-8000-00000000000b', NULL, '树新风空气净化器', NULL, 10920.00,
    FALSE, NULL, 'signed', 'none',
    '等平台结算到账后才返点。'),
  ('c0b0000c-0000-4000-8000-00000000000c', NULL, 'plaud ai录音笔', NULL, 4950.00,
    FALSE, NULL, 'sent', 'none',
    '11/23 收到协议，待确认盖章回寄，回寄地址未给。')
ON CONFLICT (id) DO NOTHING;

-- Link the live projects when they exist (production). A fresh or test
-- database has no such ids, so the rows stay historical instead of failing
-- the foreign key.
UPDATE commercial_rebates r SET project_id = v.project_id
FROM (VALUES
  ('c0b00009-0000-4000-8000-000000000009'::uuid, '0cedae5e-8ce9-4ea9-9c0b-5c7b67fb7b7d'::uuid),
  ('c0b0000a-0000-4000-8000-00000000000a'::uuid, '9db2ae9f-ba7e-4641-bc57-d2f93479996d'::uuid),
  ('c0b0000b-0000-4000-8000-00000000000b'::uuid, '980899d3-84fd-4dc5-9212-3550ad69e7f2'::uuid)
) AS v (rebate_id, project_id)
WHERE r.id = v.rebate_id
  AND EXISTS (SELECT 1 FROM commercial_projects p WHERE p.id = v.project_id);
