-- Separa els treballs en curs dels casos tancats amb èxit.
-- Les organitzacions existents reben la nova etapa sense perdre l'historial.
UPDATE "pipeline_stage"
SET "kind" = 'open'
WHERE "name" = 'Client / feina en curs' AND "kind" = 'won';

UPDATE "pipeline_stage" AS s
SET "position" = s."position" + 1
WHERE s."name" = 'Tancada / Perduda'
  AND NOT EXISTS (
    SELECT 1 FROM "pipeline_stage" AS t
    WHERE t."organization_id" = s."organization_id"
      AND t."name" = 'Treball realitzat'
  );

INSERT INTO "pipeline_stage" ("id", "organization_id", "name", "position", "kind")
SELECT
  'stage_' || md5(o."id" || '_treball_realitzat'),
  o."id",
  'Treball realitzat',
  COALESCE((
    SELECT MAX(s."position") + 1
    FROM "pipeline_stage" AS s
    WHERE s."organization_id" = o."id"
      AND s."name" <> 'Tancada / Perduda'
  ), 0),
  'won'
FROM "organization" AS o
WHERE NOT EXISTS (
  SELECT 1 FROM "pipeline_stage" AS s
  WHERE s."organization_id" = o."id"
    AND s."name" = 'Treball realitzat'
);
