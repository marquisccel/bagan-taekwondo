CREATE TYPE "public"."provenance_source" AS ENUM('COMMITTEE', 'STAKEHOLDER', 'EVIDENCE_2026', 'ENGINEERING_DEFAULT', 'TBD');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('UNRESOLVED', 'ACCEPTED', 'REJECTED', 'CORRECTED');--> statement-breakpoint
CREATE TYPE "public"."transformation_outcome" AS ENUM('UNCHANGED', 'MAPPED', 'NORMALIZED', 'INVALID');--> statement-breakpoint
CREATE TABLE "field_transformation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"import_row_id" uuid NOT NULL,
	"field" text NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text,
	"outcome" "transformation_outcome" NOT NULL,
	"rule_code" text NOT NULL,
	"rule_provenance" "provenance_source" NOT NULL,
	"suggestion" jsonb,
	"resolution_status" "resolution_status" DEFAULT 'UNRESOLVED' NOT NULL,
	"resolved_value" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_transformation_row_field_uq" UNIQUE("import_row_id","field"),
	CONSTRAINT "field_transformation_resolution_ck" CHECK (("field_transformation"."resolution_status" = 'UNRESOLVED') = ("field_transformation"."resolved_by" is null)
        and ("field_transformation"."resolved_by" is null) = ("field_transformation"."resolved_at" is null)
        and ("field_transformation"."resolved_by" is null) = ("field_transformation"."resolution_reason" is null)),
	CONSTRAINT "field_transformation_reason_ck" CHECK ("field_transformation"."resolution_reason" is null or char_length(btrim("field_transformation"."resolution_reason")) >= 15),
	CONSTRAINT "field_transformation_resolved_value_ck" CHECK (("field_transformation"."resolution_status" in ('ACCEPTED', 'CORRECTED')) = ("field_transformation"."resolved_value" is not null)),
	CONSTRAINT "field_transformation_normalized_ck" CHECK (("field_transformation"."outcome" = 'INVALID') = ("field_transformation"."normalized_value" is null))
);
--> statement-breakpoint
CREATE TABLE "intake_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"schema_version" smallint NOT NULL,
	"rule_set_fingerprint" text NOT NULL,
	"fingerprint" text NOT NULL,
	"entry_count" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_snapshot_id_tournament_uq" UNIQUE("id","tournament_id"),
	CONSTRAINT "intake_snapshot_batch_rules_uq" UNIQUE("batch_id","rule_set_fingerprint"),
	CONSTRAINT "intake_snapshot_fingerprints_ck" CHECK ("intake_snapshot"."fingerprint" ~ '^sha256:[0-9a-f]{64}$' and "intake_snapshot"."rule_set_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "intake_snapshot_entries_ck" CHECK ("intake_snapshot"."entry_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "athlete" ALTER COLUMN "full_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "athlete" ALTER COLUMN "gender" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "draw_run" ADD COLUMN "intake_snapshot_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "person_ref" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "adapter" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "content_fingerprint" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "source_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD COLUMN "component" text;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD COLUMN "suggestion" jsonb;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD COLUMN "rule_code" text;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD COLUMN "rule_provenance" "provenance_source";--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_id_tournament_uq" UNIQUE("id","tournament_id");--> statement-breakpoint
ALTER TABLE "field_transformation" ADD CONSTRAINT "field_transformation_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_transformation" ADD CONSTRAINT "field_transformation_import_row_id_import_row_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_transformation" ADD CONSTRAINT "field_transformation_resolved_by_app_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_snapshot" ADD CONSTRAINT "intake_snapshot_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_snapshot" ADD CONSTRAINT "intake_snapshot_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_snapshot" ADD CONSTRAINT "intake_snapshot_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_snapshot" ADD CONSTRAINT "intake_snapshot_batch_id_tournament_id_import_batch_id_tournament_id_fk" FOREIGN KEY ("batch_id","tournament_id") REFERENCES "public"."import_batch"("id","tournament_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_transformation_batch_ix" ON "field_transformation" USING btree ("batch_id","resolution_status");--> statement-breakpoint
ALTER TABLE "draw_run" ADD CONSTRAINT "draw_run_intake_snapshot_id_tournament_id_intake_snapshot_id_tournament_id_fk" FOREIGN KEY ("intake_snapshot_id","tournament_id") REFERENCES "public"."intake_snapshot"("id","tournament_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_person_ref_uq" ON "athlete" USING btree ("tournament_id","person_ref") WHERE "athlete"."person_ref" is not null;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_source_ref_uq" UNIQUE("batch_id","source_ref");--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_content_fingerprint_ck" CHECK ("import_batch"."content_fingerprint" is null or "import_batch"."content_fingerprint" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_committed_ck" CHECK (("import_batch"."status" = 'COMMITTED') = ("import_batch"."committed_at" is not null) and ("import_batch"."status" <> 'COMMITTED' or ("import_batch"."content_fingerprint" is not null and "import_batch"."adapter" is not null)));--> statement-breakpoint
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_rule_ck" CHECK (("validation_issue"."rule_code" is null) = ("validation_issue"."rule_provenance" is null));