-- Invariant triggers (ADR-0004, ADR-0005, ADR-0011, ADR-0013).
-- Each guard mirrors a domain rule so the database refuses what the application must never do,
-- even if an application bug or a manual SQL session tries. The db test suite checks that the
-- SQL state machines match the TypeScript ones exactly.

CREATE FUNCTION bagantkd_raise(code text, detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: %', code, detail USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Append-only tables
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION forbid_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bagantkd_raise('APPEND_ONLY_VIOLATION', format('%s on %s is not allowed', TG_OP, TG_TABLE_NAME));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER draw_command_append_only BEFORE UPDATE OR DELETE ON draw_command FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER measurement_correction_append_only BEFORE UPDATE OR DELETE ON measurement_correction FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER weigh_in_record_append_only BEFORE UPDATE OR DELETE ON weigh_in_record FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER warning_acknowledgement_append_only BEFORE UPDATE OR DELETE ON warning_acknowledgement FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Audit hash chain: prev_hash must equal the chain head; appends are serialized per chain.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION audit_event_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  head_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_chain:' || NEW.chain_key));
  SELECT last_hash INTO head_hash FROM audit_chain_head WHERE chain_key = NEW.chain_key;
  IF NOT FOUND THEN
    IF NEW.prev_hash IS NOT NULL THEN
      PERFORM bagantkd_raise('AUDIT_CHAIN_BROKEN', format('first event of chain %s must have prev_hash NULL', NEW.chain_key));
    END IF;
  ELSIF NEW.prev_hash IS DISTINCT FROM head_hash THEN
    PERFORM bagantkd_raise('AUDIT_CHAIN_BROKEN', format('prev_hash does not match the head of chain %s', NEW.chain_key));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_event_chain_guard BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_event_chain_guard();
--> statement-breakpoint
CREATE FUNCTION audit_event_chain_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_chain_head (chain_key, last_seq, last_hash) VALUES (NEW.chain_key, NEW.seq, NEW.hash)
  ON CONFLICT (chain_key) DO UPDATE SET last_seq = EXCLUDED.last_seq, last_hash = EXCLUDED.last_hash;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_event_chain_advance AFTER INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_event_chain_advance();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Registered data and raw import rows are immutable.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION athlete_registered_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tournament_id, NEW.full_name, NEW.gender, NEW.birth_date, NEW.registered_height_mm, NEW.registered_weight_g,
      NEW.registered_belt_code, NEW.nik_ciphertext, NEW.nik_blind_index, NEW.source_import_row_id)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.full_name, OLD.gender, OLD.birth_date, OLD.registered_height_mm, OLD.registered_weight_g,
      OLD.registered_belt_code, OLD.nik_ciphertext, OLD.nik_blind_index, OLD.source_import_row_id) THEN
    PERFORM bagantkd_raise('REGISTERED_VALUE_IMMUTABLE', 'record a measurement_correction or weigh_in_record instead');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER athlete_registered_immutable BEFORE UPDATE ON athlete FOR EACH ROW EXECUTE FUNCTION athlete_registered_immutable();
--> statement-breakpoint
CREATE FUNCTION import_row_raw_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.batch_id, NEW.row_number, NEW.raw) IS DISTINCT FROM (OLD.batch_id, OLD.row_number, OLD.raw) THEN
    PERFORM bagantkd_raise('IMPORT_ROW_IMMUTABLE', 'raw import rows are never modified');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_row_raw_immutable BEFORE UPDATE ON import_row FOR EACH ROW EXECUTE FUNCTION import_row_raw_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Entry registration status transitions (mirrors participant-status.ts).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION entry_registration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registration_status IS DISTINCT FROM OLD.registration_status AND NOT (
       (OLD.registration_status = 'REGISTERED' AND NEW.registration_status IN ('VERIFIED', 'WITHDRAWN', 'DQ', 'NO_SHOW'))
    OR (OLD.registration_status = 'VERIFIED' AND NEW.registration_status IN ('WITHDRAWN', 'DQ', 'NO_SHOW'))
  ) THEN
    PERFORM bagantkd_raise('INVALID_REGISTRATION_TRANSITION', format('%s -> %s', OLD.registration_status, NEW.registration_status));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER entry_registration_guard BEFORE UPDATE ON entry FOR EACH ROW EXECUTE FUNCTION entry_registration_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Draw runs are immutable once finished; identity fields never change.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION draw_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('DRAW_RUN_IMMUTABLE', 'draw runs are never deleted');
  END IF;
  IF OLD.status IN ('SAFE', 'UNSAFE', 'FAILED') THEN
    PERFORM bagantkd_raise('DRAW_RUN_IMMUTABLE', format('run %s is finished', OLD.id));
  END IF;
  IF (NEW.tournament_id, NEW.rule_set_id, NEW.kind, NEW.seed, NEW.engine_version, NEW.rules_snapshot, NEW.rules_fingerprint,
      NEW.input_fingerprint, NEW.params, NEW.assumptions, NEW.scope, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.rule_set_id, OLD.kind, OLD.seed, OLD.engine_version, OLD.rules_snapshot, OLD.rules_fingerprint,
      OLD.input_fingerprint, OLD.params, OLD.assumptions, OLD.scope, OLD.requested_by, OLD.requested_at) THEN
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
--> statement-breakpoint
CREATE TRIGGER draw_run_guard BEFORE UPDATE OR DELETE ON draw_run FOR EACH ROW EXECUTE FUNCTION draw_run_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Revision lifecycle (mirrors revision-lifecycle.ts) and optimistic concurrency.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION revision_transition_allowed(from_state revision_lifecycle, to_state revision_lifecycle) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (from_state, to_state) IN (
    ('DRAFT'::revision_lifecycle, 'REVIEW'::revision_lifecycle),
    ('REVIEW', 'DRAFT'), ('REVIEW', 'APPROVED'),
    ('APPROVED', 'DRAFT'), ('APPROVED', 'LOCKED'),
    ('LOCKED', 'PUBLISHED'),
    ('PUBLISHED', 'AMENDED'),
    ('AMENDED', 'PUBLISHED'), ('AMENDED', 'SUPERSEDED')
  )
$$;
--> statement-breakpoint
CREATE FUNCTION draw_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('REVISION_IMMUTABLE', 'revisions are never deleted');
  END IF;
  IF (NEW.tournament_id, NEW.draw_run_id, NEW.revision_no, NEW.parent_revision_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.tournament_id, OLD.draw_run_id, OLD.revision_no, OLD.parent_revision_id, OLD.created_by, OLD.created_at) THEN
    PERFORM bagantkd_raise('REVISION_IMMUTABLE', 'revision identity fields are fixed');
  END IF;
  IF NEW.lock_version <> OLD.lock_version + 1 THEN
    PERFORM bagantkd_raise('REVISION_CONFLICT', 'every update must increment lock_version by exactly one');
  END IF;
  IF NEW.lifecycle <> OLD.lifecycle AND NOT revision_transition_allowed(OLD.lifecycle, NEW.lifecycle) THEN
    PERFORM bagantkd_raise('INVALID_REVISION_TRANSITION', format('%s -> %s', OLD.lifecycle, NEW.lifecycle));
  END IF;
  IF OLD.lifecycle IN ('LOCKED', 'PUBLISHED', 'AMENDED', 'SUPERSEDED') AND NEW.content_fingerprint IS DISTINCT FROM OLD.content_fingerprint THEN
    PERFORM bagantkd_raise('REVISION_CONTENT_FROZEN', 'content fingerprint of a locked revision cannot change');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER draw_revision_guard BEFORE UPDATE OR DELETE ON draw_revision FOR EACH ROW EXECUTE FUNCTION draw_revision_guard();
--> statement-breakpoint

-- Revision content (pools, members, brackets, slots, matches) is writable only while DRAFT.
CREATE FUNCTION revision_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rev uuid;
  state revision_lifecycle;
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'bracket_slot' AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    PERFORM bagantkd_raise('REVISION_CONTENT_FROZEN', 'rows cannot move between revisions');
  END IF;
  IF TG_TABLE_NAME = 'bracket_slot' THEN
    IF TG_OP = 'DELETE' THEN
      SELECT b.revision_id INTO rev FROM bracket b WHERE b.id = OLD.bracket_id;
    ELSE
      SELECT b.revision_id INTO rev FROM bracket b WHERE b.id = NEW.bracket_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    rev := OLD.revision_id;
  ELSE
    rev := NEW.revision_id;
  END IF;
  SELECT lifecycle INTO state FROM draw_revision WHERE id = rev;
  IF state IS DISTINCT FROM 'DRAFT' THEN
    PERFORM bagantkd_raise('REVISION_CONTENT_FROZEN', format('%s on %s: revision %s is %s', TG_OP, TG_TABLE_NAME, rev, state));
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pool_content_guard BEFORE INSERT OR UPDATE OR DELETE ON pool FOR EACH ROW EXECUTE FUNCTION revision_content_guard();
--> statement-breakpoint
CREATE TRIGGER pool_member_content_guard BEFORE INSERT OR UPDATE OR DELETE ON pool_member FOR EACH ROW EXECUTE FUNCTION revision_content_guard();
--> statement-breakpoint
CREATE TRIGGER bracket_content_guard BEFORE INSERT OR UPDATE OR DELETE ON bracket FOR EACH ROW EXECUTE FUNCTION revision_content_guard();
--> statement-breakpoint
CREATE TRIGGER bracket_slot_content_guard BEFORE INSERT OR UPDATE OR DELETE ON bracket_slot FOR EACH ROW EXECUTE FUNCTION revision_content_guard();
--> statement-breakpoint
CREATE TRIGGER match_content_guard BEFORE INSERT OR UPDATE OR DELETE ON match FOR EACH ROW EXECUTE FUNCTION revision_content_guard();
--> statement-breakpoint

-- One official revision per category, and only a PUBLISHED revision can be official.
CREATE FUNCTION official_category_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('OFFICIAL_ASSIGNMENT_IMMUTABLE', 'an official assignment is replaced, never removed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM draw_revision r WHERE r.id = NEW.revision_id AND r.lifecycle = 'PUBLISHED') THEN
    PERFORM bagantkd_raise('OFFICIAL_REVISION_NOT_PUBLISHED', format('revision %s is not PUBLISHED', NEW.revision_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pool p WHERE p.revision_id = NEW.revision_id AND p.category_id = NEW.category_id) THEN
    PERFORM bagantkd_raise('OFFICIAL_CATEGORY_NOT_IN_REVISION', format('category %s has no pool in revision %s', NEW.category_id, NEW.revision_id));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER official_category_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON official_category_assignment FOR EACH ROW EXECUTE FUNCTION official_category_assignment_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Public match codes: never deleted, never reused, only retired once (ADR-0005).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION match_code_registry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('MATCH_CODE_IMMUTABLE', 'public match codes are never deleted');
  END IF;
  IF (NEW.tournament_id, NEW.public_code, NEW.arena_id, NEW.match_uid, NEW.first_revision_id, NEW.created_at)
     IS DISTINCT FROM (OLD.tournament_id, OLD.public_code, OLD.arena_id, OLD.match_uid, OLD.first_revision_id, OLD.created_at)
     OR (OLD.retired_revision_id IS NOT NULL AND NEW.retired_revision_id IS DISTINCT FROM OLD.retired_revision_id) THEN
    PERFORM bagantkd_raise('MATCH_CODE_IMMUTABLE', 'only an unretired code can be retired, once');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER match_code_registry_guard BEFORE UPDATE OR DELETE ON match_code_registry FOR EACH ROW EXECUTE FUNCTION match_code_registry_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Data-quality overrides: Technical Delegate only, ERROR only, overridable codes only,
-- revocable but never edited. The issue status follows the override automatically.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION issue_code_overridable(code text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT code IN (
    'HEIGHT_WEIGHT_LIKELY_SWAPPED', 'HEIGHT_OUT_OF_RANGE', 'WEIGHT_OUT_OF_RANGE', 'BMI_IMPLAUSIBLE',
    'WEIGHT_CLASS_MISMATCH', 'AGE_DIVISION_PLAY_UP', 'AGE_DIVISION_CONFLICT', 'NIK_INVALID_FORMAT',
    'NIK_GENDER_MISMATCH', 'NIK_BIRTHDATE_MISMATCH'
  )
$$;
--> statement-breakpoint
CREATE FUNCTION data_quality_override_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  iss validation_issue%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('OVERRIDE_IMMUTABLE', 'overrides are revoked, never deleted');
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL
       OR (NEW.issue_id, NEW.actor_id, NEW.reason, NEW.created_at) IS DISTINCT FROM (OLD.issue_id, OLD.actor_id, OLD.reason, OLD.created_at)
       OR NEW.revoked_at IS NULL THEN
      PERFORM bagantkd_raise('OVERRIDE_IMMUTABLE', 'the only permitted change is a single revocation');
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO iss FROM validation_issue WHERE id = NEW.issue_id FOR UPDATE;
  IF iss.severity <> 'ERROR' THEN
    PERFORM bagantkd_raise('OVERRIDE_ONLY_FOR_ERRORS', iss.code);
  END IF;
  IF NOT issue_code_overridable(iss.code) THEN
    PERFORM bagantkd_raise('OVERRIDE_NOT_ALLOWED_FOR_CODE', iss.code);
  END IF;
  IF iss.status <> 'OPEN' THEN
    PERFORM bagantkd_raise('OVERRIDE_ISSUE_NOT_OPEN', iss.status::text);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tournament_member m
    WHERE m.tournament_id = iss.tournament_id AND m.user_id = NEW.actor_id AND m.role = 'TECHNICAL_DELEGATE'
  ) THEN
    PERFORM bagantkd_raise('OVERRIDE_NOT_PERMITTED_FOR_ROLE', 'actor is not a Technical Delegate of this tournament');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER data_quality_override_guard BEFORE INSERT OR UPDATE OR DELETE ON data_quality_override FOR EACH ROW EXECUTE FUNCTION data_quality_override_guard();
--> statement-breakpoint
CREATE FUNCTION data_quality_override_sync_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE validation_issue SET status = 'OVERRIDDEN', resolved_at = NEW.created_at, resolved_by = NEW.actor_id, resolution_note = NEW.reason
    WHERE id = NEW.issue_id;
  ELSE
    UPDATE validation_issue SET status = 'OPEN', resolved_at = NULL, resolved_by = NULL, resolution_note = NULL
    WHERE id = NEW.issue_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER data_quality_override_sync_issue AFTER INSERT OR UPDATE ON data_quality_override FOR EACH ROW EXECUTE FUNCTION data_quality_override_sync_issue();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Complaint lifecycle (mirrors complaint.ts).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION complaint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bagantkd_raise('COMPLAINT_IMMUTABLE', 'complaints are never deleted');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'OPEN' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED'))
    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('ACCEPTED', 'REJECTED'))
    OR (OLD.status = 'ACCEPTED' AND NEW.status = 'RESOLVED')
  ) THEN
    PERFORM bagantkd_raise('INVALID_COMPLAINT_TRANSITION', format('%s -> %s', OLD.status, NEW.status));
  END IF;
  IF OLD.status IN ('REJECTED', 'RESOLVED') THEN
    PERFORM bagantkd_raise('COMPLAINT_IMMUTABLE', 'closed complaints cannot change');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER complaint_guard BEFORE UPDATE OR DELETE ON complaint FOR EACH ROW EXECUTE FUNCTION complaint_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------
-- Rule sets: DRAFT -> ACTIVE -> RETIRED; snapshot frozen after activation; child tables
-- writable only while the owning rule set is DRAFT.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION rule_set_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      PERFORM bagantkd_raise('RULE_SET_FROZEN', 'only DRAFT rule sets can be deleted');
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE') OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED')
  ) THEN
    PERFORM bagantkd_raise('INVALID_RULE_SET_TRANSITION', format('%s -> %s', OLD.status, NEW.status));
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       (NEW.tournament_id, NEW.code, NEW.version, NEW.name, NEW.age_policy, NEW.age_reference_year, NEW.age_cutoff_date,
        NEW.age_provenance, NEW.plausibility, NEW.source_vocabulary, NEW.snapshot, NEW.fingerprint, NEW.activated_at)
       IS DISTINCT FROM
       (OLD.tournament_id, OLD.code, OLD.version, OLD.name, OLD.age_policy, OLD.age_reference_year, OLD.age_cutoff_date,
        OLD.age_provenance, OLD.plausibility, OLD.source_vocabulary, OLD.snapshot, OLD.fingerprint, OLD.activated_at)) THEN
    PERFORM bagantkd_raise('RULE_SET_FROZEN', 'an activated rule set cannot change; create a new version');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rule_set_guard BEFORE UPDATE OR DELETE ON rule_set FOR EACH ROW EXECUTE FUNCTION rule_set_guard();
--> statement-breakpoint
CREATE FUNCTION rule_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  rs_id uuid;
  rs_status rule_set_status;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'rule_belt_band' THEN
      SELECT s.rule_set_id INTO rs_id FROM rule_belt_band_scheme s WHERE s.id = r.scheme_id;
    WHEN 'rule_belt_band_member' THEN
      SELECT s.rule_set_id INTO rs_id FROM rule_belt_band_scheme s WHERE s.id = r.scheme_id;
    WHEN 'rule_movement_map_entry' THEN
      SELECT m.rule_set_id INTO rs_id FROM rule_movement_map m WHERE m.id = r.map_id;
    WHEN 'rule_weight_class' THEN
      SELECT t.rule_set_id INTO rs_id FROM rule_weight_class_table t WHERE t.id = r.table_id;
    WHEN 'rule_pool_size_penalty', 'rule_tolerance' THEN
      SELECT p.rule_set_id INTO rs_id FROM rule_pool_policy p WHERE p.id = r.policy_id;
    ELSE
      rs_id := r.rule_set_id;
  END CASE;
  SELECT status INTO rs_status FROM rule_set WHERE id = rs_id;
  -- A cascading delete of a DRAFT rule set reaches here after the parent row is gone.
  IF rs_status IS NOT NULL AND rs_status <> 'DRAFT' THEN
    PERFORM bagantkd_raise('RULE_SET_FROZEN', format('%s on %s: rule set %s is %s', TG_OP, TG_TABLE_NAME, rs_id, rs_status));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rule_age_division_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_age_division FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_belt_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_belt FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_belt_band_scheme_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_belt_band_scheme FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_belt_band_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_belt_band FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_belt_band_member_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_belt_band_member FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_movement_map_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_movement_map FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_movement_map_entry_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_movement_map_entry FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_weight_class_table_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_weight_class_table FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_weight_class_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_weight_class FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_pool_policy_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_pool_policy FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_pool_size_penalty_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_pool_size_penalty FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_tolerance_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_tolerance FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_category_template_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_category_template FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
--> statement-breakpoint
CREATE TRIGGER rule_composition_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_composition FOR EACH ROW EXECUTE FUNCTION rule_child_guard();
