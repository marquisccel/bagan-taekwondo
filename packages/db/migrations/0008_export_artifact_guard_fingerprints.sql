-- Phase 6: source_fingerprint and parameters_fingerprint became identity fields (fixed at
-- creation, NOT NULL) in 0007. Extend export_artifact_guard's frozen-fields tuple to match, the
-- same way 0001's draw_run_guard freezes every field set at creation.
CREATE OR REPLACE FUNCTION export_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('EXPORT_ARTIFACT_IMMUTABLE', 'export artifacts are never deleted');
  END IF;
  IF OLD.status IN ('READY', 'FAILED') THEN
    PERFORM bagantkd_raise('EXPORT_ARTIFACT_IMMUTABLE', format('export %s is finished', OLD.id));
  END IF;
  IF (NEW.tournament_id, NEW.draw_run_id, NEW.revision_id, NEW.revision_no, NEW.export_type, NEW.format, NEW.mode,
      NEW.scope_type, NEW.category_id, NEW.pool_id, NEW.source_fingerprint, NEW.parameters_fingerprint,
      NEW.engine_version, NEW.template_version, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.draw_run_id, OLD.revision_id, OLD.revision_no, OLD.export_type, OLD.format, OLD.mode,
      OLD.scope_type, OLD.category_id, OLD.pool_id, OLD.source_fingerprint, OLD.parameters_fingerprint,
      OLD.engine_version, OLD.template_version, OLD.requested_by, OLD.requested_at) THEN
    PERFORM bagantkd_raise('EXPORT_ARTIFACT_IMMUTABLE', 'export request fields are fixed at creation');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'REQUESTED' AND NEW.status = 'GENERATING')
    OR (OLD.status = 'GENERATING' AND NEW.status IN ('READY', 'FAILED'))
  ) THEN
    PERFORM bagantkd_raise('INVALID_EXPORT_TRANSITION', format('%s -> %s', OLD.status, NEW.status));
  END IF;
  RETURN NEW;
END $$;
