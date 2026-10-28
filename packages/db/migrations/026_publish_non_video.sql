-- WP-OC-008: publish nodes may deliver a video or a text/image dynamic post.
-- Post deliveries keep the platform content link and its external id instead of
-- a bvid; monitoring stays video-only.

ALTER TABLE project_publish_records ALTER COLUMN bvid DROP NOT NULL;
ALTER TABLE project_publish_records
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'bilibili',
  ADD COLUMN IF NOT EXISTS content_kind TEXT NOT NULL DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS content_url TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE project_publish_records
  ADD CONSTRAINT project_publish_records_kind_chk CHECK (content_kind IN ('video','post'));
ALTER TABLE project_publish_records
  ADD CONSTRAINT project_publish_records_identity_chk
  CHECK (bvid IS NOT NULL OR external_id IS NOT NULL);
