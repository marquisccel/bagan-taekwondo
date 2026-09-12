-- Intake invariants (PHASE2_PLAN §8, instructions 1 and 5).
-- A committed import batch, its raw rows, their normalized traces and field transformations are
-- immutable; a transformation's resolution is recorded exactly once; intake snapshots are
-- append-only and derive from a committed batch; a draw run is bound to one snapshot for ever.

-- ---------------------------------------------------------------------------------------
-- Import batch lifecycle (mirrors packages/domain/src/import-batch.ts).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION import_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('IMPORT_BATCH_IMMUTABLE', 'import batches are never deleted');
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'UPLOADED' THEN
      PERFORM bagantkd_raise('INVALID_IMPORT_BATCH_TRANSITION', format('a batch starts UPLOADED, not %s', NEW.status));
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('COMMITTED', 'FAILED') THEN
    PERFORM bagantkd_raise('IMPORT_BATCH_IMMUTABLE', format('batch %s is %s', OLD.id, OLD.status));
  END IF;
  IF (NEW.tournament_id, NEW.rule_set_id, NEW.source_filename, NEW.source_sha256, NEW.row_count, NEW.column_mapping,
      NEW.adapter, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.rule_set_id, OLD.source_filename, OLD.source_sha256, OLD.row_count, OLD.column_mapping,
      OLD.adapter, OLD.created_by, OLD.created_at) THEN
    PERFORM bagantkd_raise('IMPORT_BATCH_IMMUTABLE', 'batch identity is fixed at upload');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'UPLOADED' AND NEW.status IN ('PARSED', 'FAILED'))
    OR (OLD.status = 'PARSED' AND NEW.status IN ('VALIDATED', 'FAILED'))
    OR (OLD.status = 'VALIDATED' AND NEW.status IN ('COMMITTED', 'FAILED'))
  ) THEN
    PERFORM bagantkd_raise('INVALID_IMPORT_BATCH_TRANSITION', format('%s -> %s', OLD.status, NEW.status));
  END IF;
  IF NEW.status = 'COMMITTED' THEN
    SELECT count(*) INTO n FROM import_row WHERE batch_id = NEW.id;
    IF n <> NEW.row_count THEN
      PERFORM bagantkd_raise('IMPORT_BATCH_INCOMPLETE', format('row_count %s but %s rows stored', NEW.row_count, n));
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON import_batch FOR EACH ROW EXECUTE FUNCTION import_batch_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Import rows: never deleted, never added to or changed in a final batch; normalized written once.
-- (Raw immutability itself is import_row_raw_immutable, 0001.)
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION import_batch_open(batch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT status NOT IN ('COMMITTED', 'FAILED') FROM import_batch WHERE id = batch
$$;
--> statement-breakpoint
CREATE FUNCTION import_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('IMPORT_ROW_IMMUTABLE', 'import rows are never deleted');
  END IF;
  IF NOT import_batch_open(NEW.batch_id) THEN
    PERFORM bagantkd_raise('IMPORT_BATCH_IMMUTABLE', format('batch %s is final', NEW.batch_id));
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source_ref IS DISTINCT FROM OLD.source_ref THEN
      PERFORM bagantkd_raise('IMPORT_ROW_IMMUTABLE', 'source_ref is fixed');
    END IF;
    IF OLD.normalized IS NOT NULL AND NEW.normalized IS DISTINCT FROM OLD.normalized THEN
      PERFORM bagantkd_raise('IMPORT_ROW_NORMALIZED_WRITTEN_ONCE', format('row %s', OLD.row_number));
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_row_guard BEFORE INSERT OR UPDATE OR DELETE ON import_row FOR EACH ROW EXECUTE FUNCTION import_row_guard();
--> statement-breakpoint
CREATE TRIGGER import_row_no_truncate BEFORE TRUNCATE ON import_row FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER import_batch_no_truncate BEFORE TRUNCATE ON import_batch FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Field transformations: RAW → NORMALIZED is fixed; RESOLVED is recorded once, by a member of
-- the tournament who may act on data (not a VIEWER), with a reason.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION field_transformation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_batch uuid;
  batch_tournament uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('FIELD_TRANSFORMATION_IMMUTABLE', 'transformations are never deleted');
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT batch_id INTO row_batch FROM import_row WHERE id = NEW.import_row_id;
    IF row_batch IS DISTINCT FROM NEW.batch_id THEN
      PERFORM bagantkd_raise('FIELD_TRANSFORMATION_BATCH_MISMATCH', 'import_row belongs to another batch');
    END IF;
    IF NOT import_batch_open(NEW.batch_id) THEN
      PERFORM bagantkd_raise('IMPORT_BATCH_IMMUTABLE', format('batch %s is final', NEW.batch_id));
    END IF;
    IF NEW.resolution_status <> 'UNRESOLVED' THEN
      PERFORM bagantkd_raise('FIELD_TRANSFORMATION_RESOLUTION_ON_INSERT', 'a resolution is a later, separate decision');
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.batch_id, NEW.import_row_id, NEW.field, NEW.raw_value, NEW.normalized_value, NEW.outcome, NEW.rule_code,
      NEW.rule_provenance, NEW.suggestion, NEW.created_at)
     IS DISTINCT FROM
     (OLD.batch_id, OLD.import_row_id, OLD.field, OLD.raw_value, OLD.normalized_value, OLD.outcome, OLD.rule_code,
      OLD.rule_provenance, OLD.suggestion, OLD.created_at) THEN
    PERFORM bagantkd_raise('FIELD_TRANSFORMATION_IMMUTABLE', 'raw and normalized values are never modified');
  END IF;
  IF OLD.resolution_status <> 'UNRESOLVED' THEN
    PERFORM bagantkd_raise('FIELD_TRANSFORMATION_RESOLUTION_FINAL', format('already %s', OLD.resolution_status));
  END IF;
  IF NEW.resolution_status <> 'UNRESOLVED' THEN
    SELECT tournament_id INTO batch_tournament FROM import_batch WHERE id = NEW.batch_id;
    IF NOT EXISTS (
      SELECT 1 FROM tournament_member
      WHERE tournament_id = batch_tournament AND user_id = NEW.resolved_by AND role <> 'VIEWER'
    ) THEN
      PERFORM bagantkd_raise('FIELD_TRANSFORMATION_RESOLVER_NOT_AUTHORIZED', 'resolver must act on data in this tournament');
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER field_transformation_guard BEFORE INSERT OR UPDATE OR DELETE ON field_transformation FOR EACH ROW EXECUTE FUNCTION field_transformation_guard();
--> statement-breakpoint
CREATE TRIGGER field_transformation_no_truncate BEFORE TRUNCATE ON field_transformation FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Intake snapshots: append-only, derived from a COMMITTED batch, internally consistent.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION intake_snapshot_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b import_batch%ROWTYPE;
BEGIN
  SELECT * INTO b FROM import_batch WHERE id = NEW.batch_id;
  IF b.status <> 'COMMITTED' THEN
    PERFORM bagantkd_raise('INTAKE_SNAPSHOT_BATCH_NOT_COMMITTED', format('batch %s is %s', b.id, b.status));
  END IF;
  IF jsonb_typeof(NEW.content -> 'entries') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.content -> 'entries') <> NEW.entry_count
     OR NEW.content ->> 'ruleSetFingerprint' IS DISTINCT FROM NEW.rule_set_fingerprint
     OR NEW.content ->> 'adapter' IS DISTINCT FROM NEW.adapter
     OR (NEW.content ->> 'schemaVersion')::int IS DISTINCT FROM NEW.schema_version
     OR NEW.content -> 'source' ->> 'fingerprint' IS DISTINCT FROM 'sha256:' || b.source_sha256 THEN
    PERFORM bagantkd_raise('INTAKE_SNAPSHOT_INCONSISTENT', 'columns must match the snapshot content and its batch');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER intake_snapshot_insert_guard BEFORE INSERT ON intake_snapshot FOR EACH ROW EXECUTE FUNCTION intake_snapshot_insert_guard();
--> statement-breakpoint
CREATE TRIGGER intake_snapshot_append_only BEFORE UPDATE OR DELETE ON intake_snapshot FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER intake_snapshot_no_truncate BEFORE TRUNCATE ON intake_snapshot FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Draw runs: the intake snapshot joins the immutable input tuple.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draw_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('DRAW_RUN_IMMUTABLE', 'draw runs are never deleted');
  END IF;
  IF OLD.status IN ('SAFE', 'UNSAFE', 'FAILED') THEN
    PERFORM bagantkd_raise('DRAW_RUN_IMMUTABLE', format('run %s is finished', OLD.id));
  END IF;
  IF (NEW.tournament_id, NEW.rule_set_id, NEW.intake_snapshot_id, NEW.kind, NEW.seed, NEW.engine_version, NEW.rules_snapshot,
      NEW.rules_fingerprint, NEW.input_fingerprint, NEW.params, NEW.assumptions, NEW.scope, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.rule_set_id, OLD.intake_snapshot_id, OLD.kind, OLD.seed, OLD.engine_version, OLD.rules_snapshot,
      OLD.rules_fingerprint, OLD.input_fingerprint, OLD.params, OLD.assumptions, OLD.scope, OLD.requested_by, OLD.requested_at) THEN
    PERFORM bagantkd_raise('DRAW_RUN_IMMUTABLE', 'run inputs are fixed at creation');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING', 'FAILED'))
    OR (OLD.status = 'RUNNING' AND NEW.status IN ('SAFE', 'UNSAFE', 'FAILED'))
  ) THEN
    PERFORM bagantkd_raise('INVALID_DRAW_RUN_TRANSITION', format('%s -> %s', OLD.status, NEW.status));
  END IF;
  RETURN NEW;
END $$;
