-- WP-OC-014: platform order amount (= platform payout) and the agreed rebate rate.
ALTER TABLE commercial_projects
  ADD COLUMN IF NOT EXISTS platform_amount NUMERIC(14, 2) NULL,
  ADD COLUMN IF NOT EXISTS agreed_rebate_rate NUMERIC(6, 4) NULL;
