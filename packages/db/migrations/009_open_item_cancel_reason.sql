-- WP-004R: cancel reason required for cancelled open items

ALTER TABLE open_items ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
