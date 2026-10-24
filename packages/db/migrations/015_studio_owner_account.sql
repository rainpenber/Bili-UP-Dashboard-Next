-- WP-R2-MON-04: singleton studio owner Bilibili account for "只看我的".
-- mid is the configured personal UID (not auth). Default 狐正正; never overwrite on replay.

CREATE TABLE IF NOT EXISTS studio_owner_account (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  mid BIGINT NOT NULL,
  display_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO studio_owner_account (id, mid, display_name)
VALUES (1, 3493141386627335, '狐正正')
ON CONFLICT (id) DO NOTHING;
