-- Publishing a template must point the slug's default at the new version without
-- rewriting that version's content. The previous trigger rejected every update of
-- a published row, including clearing is_default, so a second published default
-- could not be stored under uq_wf_template_default_per_slug.
-- Content columns stay frozen. Only is_default may move on a published row.
-- Names are unique within a version after trim; the reviewed refusal uses that rule.

CREATE OR REPLACE FUNCTION trg_wf_template_versions_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_draft = FALSE THEN
      RAISE EXCEPTION 'cannot delete published template version %', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_draft = FALSE THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.slug IS DISTINCT FROM OLD.slug
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.is_draft IS DISTINCT FROM OLD.is_draft
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
    THEN
      RAISE EXCEPTION 'published template version % is immutable', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_draft = TRUE AND NEW.is_draft = FALSE THEN
    IF NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX uq_wf_template_nodes_name_per_version
  ON wf_template_nodes (template_version_id, btrim(name));
