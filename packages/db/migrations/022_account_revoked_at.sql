-- WP-R2-25A: soft-revoke timestamp for bili_accounts (022; after 26-line 019-021).
-- Rollback: ALTER TABLE bili_accounts DROP COLUMN IF EXISTS revoked_at;

ALTER TABLE bili_accounts
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
