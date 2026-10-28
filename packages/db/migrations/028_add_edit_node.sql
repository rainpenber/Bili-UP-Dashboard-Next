-- WP-OC-012: add the 剪辑 node between B-roll 素材 and AI 后期.
-- Only the current default template version is changed. Published template rows
-- are normally immutable, so the two child triggers are disabled for this data
-- migration and re-enabled before it finishes. Every statement is idempotent so
-- the file can be executed again without creating duplicate nodes or edges.

ALTER TABLE wf_template_nodes DISABLE TRIGGER wf_template_nodes_immutable;
ALTER TABLE wf_template_edges DISABLE TRIGGER wf_template_edges_immutable;

-- Template node. The package is the same production package as AI 后期.
INSERT INTO wf_template_nodes (
  id, template_version_id, package_id, slug, name, kind, phase, is_optional, pos_x, pos_y
)
SELECT
  gen_random_uuid(),
  v.id,
  COALESCE(
    ai.package_id,
    (
      SELECT p.id
      FROM wf_template_packages p
      WHERE p.template_version_id = v.id
      ORDER BY p.sort_order, p.id
      LIMIT 1
    )
  ),
  'edit',
  '剪辑',
  'stage',
  'pre_publish',
  FALSE,
  160,
  420
FROM (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v
LEFT JOIN wf_template_nodes ai
  ON ai.template_version_id = v.id AND ai.slug = 'ai_post'
WHERE NOT EXISTS (
  SELECT 1
  FROM wf_template_nodes existing
  WHERE existing.template_version_id = v.id AND existing.slug = 'edit'
)
ON CONFLICT (template_version_id, slug) DO NOTHING;

-- Geometry: A-roll -160, B-roll 0, 剪辑 160, AI 后期 320.
UPDATE wf_template_nodes n
SET pos_x = CASE n.slug
  WHEN 'a_roll' THEN -160
  WHEN 'b_roll' THEN 0
  WHEN 'edit' THEN 160
  WHEN 'ai_post' THEN 320
END,
pos_y = 420
FROM (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v
WHERE n.template_version_id = v.id
  AND n.slug IN ('a_roll', 'b_roll', 'edit', 'ai_post');

-- Drop the old production bypasses, including the direct review links that the
-- pre-剪辑 seed used instead of a_roll/b_roll -> ai_post.
DELETE FROM wf_template_edges e
USING
  (
    SELECT id
    FROM wf_template_versions
    WHERE slug = 'default_sponsorship' AND is_default = TRUE
    ORDER BY version DESC
    LIMIT 1
  ) v,
  wf_template_nodes f,
  wf_template_nodes t
WHERE e.template_version_id = v.id
  AND f.template_version_id = v.id
  AND t.template_version_id = v.id
  AND e.from_node_id = f.id
  AND e.to_node_id = t.id
  AND (
    (f.slug IN ('a_roll', 'b_roll') AND t.slug IN ('ai_post', 'review'))
    OR (f.slug = 'merge' AND t.slug = 'ai_post')
  );

INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
SELECT gen_random_uuid(), v.id, f.id, t.id
FROM (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v
JOIN (
  VALUES
    ('a_roll', 'edit'),
    ('b_roll', 'edit'),
    ('edit', 'ai_post')
) AS pair(from_slug, to_slug) ON TRUE
JOIN wf_template_nodes f
  ON f.template_version_id = v.id AND f.slug = pair.from_slug
JOIN wf_template_nodes t
  ON t.template_version_id = v.id AND t.slug = pair.to_slug
ON CONFLICT (template_version_id, from_node_id, to_node_id) DO NOTHING;

-- Existing instances: geometry first.
UPDATE wf_nodes n
SET pos_x = CASE tn.slug
      WHEN 'a_roll' THEN -160
      WHEN 'b_roll' THEN 0
      WHEN 'edit' THEN 160
      WHEN 'ai_post' THEN 320
    END,
    pos_y = 420,
    updated_at = now()
FROM project_workflows w
JOIN (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v ON w.template_version_id = v.id
JOIN wf_template_nodes tn
  ON tn.template_version_id = v.id
 AND tn.slug IN ('a_roll', 'b_roll', 'edit', 'ai_post')
WHERE n.workflow_id = w.id
  AND n.template_node_id = tn.id;

-- A project may predate the production package in its own wf_packages. Create
-- the matching package only when it is missing, so the new node never has a
-- NULL package_id.
INSERT INTO wf_packages (id, workflow_id, name, sort_order)
SELECT gen_random_uuid(), w.id, tp.name, tp.sort_order
FROM project_workflows w
JOIN (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v ON w.template_version_id = v.id
JOIN wf_template_nodes te
  ON te.template_version_id = v.id AND te.slug = 'edit'
JOIN wf_template_packages tp
  ON tp.template_version_id = v.id AND tp.id = te.package_id
WHERE NOT EXISTS (
  SELECT 1
  FROM wf_packages p
  WHERE p.workflow_id = w.id AND p.name = tp.name
);

INSERT INTO wf_nodes (
  id, workflow_id, project_id, template_version_id, template_node_id, package_id,
  name, kind, phase, status, is_optional, pos_x, pos_y, source
)
SELECT
  gen_random_uuid(),
  w.id,
  w.project_id,
  w.template_version_id,
  te.id,
  p.id,
  te.name,
  te.kind,
  te.phase,
  'not_reached',
  te.is_optional,
  te.pos_x,
  te.pos_y,
  'template'
FROM project_workflows w
JOIN (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v ON w.template_version_id = v.id
JOIN wf_template_nodes te
  ON te.template_version_id = v.id AND te.slug = 'edit'
JOIN wf_template_packages tp
  ON tp.template_version_id = v.id AND tp.id = te.package_id
JOIN wf_packages p
  ON p.workflow_id = w.id AND p.name = tp.name
WHERE NOT EXISTS (
  SELECT 1
  FROM wf_nodes existing
  WHERE existing.workflow_id = w.id AND existing.template_node_id = te.id
)
ON CONFLICT DO NOTHING;

-- Existing instance edges: remove the production bypasses.
DELETE FROM wf_edges e
USING
  project_workflows w,
  (
    SELECT id
    FROM wf_template_versions
    WHERE slug = 'default_sponsorship' AND is_default = TRUE
    ORDER BY version DESC
    LIMIT 1
  ) v,
  wf_nodes f,
  wf_nodes t,
  wf_template_nodes ft,
  wf_template_nodes tt
WHERE w.template_version_id = v.id
  AND e.workflow_id = w.id
  AND f.workflow_id = w.id
  AND t.workflow_id = w.id
  AND e.from_node_id = f.id
  AND e.to_node_id = t.id
  AND ft.id = f.template_node_id
  AND ft.template_version_id = w.template_version_id
  AND tt.id = t.template_node_id
  AND tt.template_version_id = w.template_version_id
  AND (
    (ft.slug IN ('a_roll', 'b_roll') AND tt.slug IN ('ai_post', 'review'))
    OR (ft.slug = 'merge' AND tt.slug = 'ai_post')
  );

INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
SELECT gen_random_uuid(), w.id, f.id, t.id
FROM project_workflows w
JOIN (
  SELECT id
  FROM wf_template_versions
  WHERE slug = 'default_sponsorship' AND is_default = TRUE
  ORDER BY version DESC
  LIMIT 1
) v ON w.template_version_id = v.id
JOIN (
  VALUES
    ('a_roll', 'edit'),
    ('b_roll', 'edit'),
    ('edit', 'ai_post')
) AS pair(from_slug, to_slug) ON TRUE
JOIN LATERAL (
  SELECT n.id
  FROM wf_nodes n
  JOIN wf_template_nodes tn
    ON tn.id = n.template_node_id
   AND tn.template_version_id = n.template_version_id
  WHERE n.workflow_id = w.id AND tn.slug = pair.from_slug
  LIMIT 1
) f ON TRUE
JOIN LATERAL (
  SELECT n.id
  FROM wf_nodes n
  JOIN wf_template_nodes tn
    ON tn.id = n.template_node_id
   AND tn.template_version_id = n.template_version_id
  WHERE n.workflow_id = w.id AND tn.slug = pair.to_slug
  LIMIT 1
) t ON TRUE
ON CONFLICT (workflow_id, from_node_id, to_node_id) DO NOTHING;

ALTER TABLE wf_template_nodes ENABLE TRIGGER wf_template_nodes_immutable;
ALTER TABLE wf_template_edges ENABLE TRIGGER wf_template_edges_immutable;
