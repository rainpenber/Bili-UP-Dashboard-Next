-- Allow Hermes system-level audit rows before project id is known
ALTER TABLE workflow_audit_log ALTER COLUMN project_id DROP NOT NULL;
