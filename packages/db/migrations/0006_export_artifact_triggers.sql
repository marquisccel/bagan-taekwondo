-- Phase 6: export_artifact invariants, mirroring draw_run_guard (0001) exactly — forbid DELETE,
-- freeze identity/request fields for the row's lifetime, and allow only the REQUESTED -> GENERATING
-- -> {READY, FAILED} transitions defined in packages/domain/src/export-policy.ts. READY/FAILED are
-- terminal: a finished export is never re-generated in place, matching draw_run's finished states.
CREATE FUNCTION export_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('EXPORT_ARTIFACT_IMMUTABLE', 'export artifacts are never deleted');
  END IF;
  IF OLD.status IN ('READY', 'FAILED') THEN
    PERFORM bagantkd_raise('EXPORT_ARTIFACT_IMMUTABLE', format('export %s is finished', OLD.id));
  END IF;
  IF (NEW.tournament_id, NEW.draw_run_id, NEW.revision_id, NEW.revision_no, NEW.export_type, NEW.format, NEW.mode,
      NEW.scope_type, NEW.category_id, NEW.pool_id, NEW.engine_version, NEW.template_version, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.draw_run_id, OLD.revision_id, OLD.revision_no, OLD.export_type, OLD.format, OLD.mode,
      OLD.scope_type, OLD.category_id, OLD.pool_id, OLD.engine_version, OLD.template_version, OLD.requested_by, OLD.requested_at) THEN
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
--> statement-breakpoint
CREATE TRIGGER export_artifact_guard BEFORE UPDATE OR DELETE ON export_artifact FOR EACH ROW EXECUTE FUNCTION export_artifact_guard();
