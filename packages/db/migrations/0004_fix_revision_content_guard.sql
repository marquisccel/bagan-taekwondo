-- Phase 4 integration defect found while first persisting a draw revision's content: the original
-- revision_content_guard() (0001) referenced NEW.revision_id / OLD.revision_id inside one compound
-- boolean expression that also runs for bracket_slot rows. bracket_slot has no revision_id column
-- (it reaches its revision through bracket_id); PL/pgSQL binds every field reference in a compound
-- expression to the firing table's row type before evaluating AND/OR short-circuit, so any INSERT
-- or DELETE on bracket_slot raised "record \"new\"/\"old\" has no field \"revision_id\"" — bracket
-- slots (and therefore any bracket) could never be persisted. Reproduced by
-- packages/db/src/draw-run.db.test.ts before this fix.
--
-- Fix: split the compound condition into a nested IF so the revision_id field access is a
-- separate PL/pgSQL statement that is only ever reached (and only ever type-bound) for the four
-- tables that actually have the column. No behavior changes for pool/pool_member/bracket/match.
CREATE OR REPLACE FUNCTION revision_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rev uuid;
  state revision_lifecycle;
BEGIN
  IF TG_TABLE_NAME <> 'bracket_slot' THEN
    IF TG_OP = 'UPDATE' AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
      PERFORM bagantkd_raise('REVISION_CONTENT_FROZEN', 'rows cannot move between revisions');
    END IF;
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
