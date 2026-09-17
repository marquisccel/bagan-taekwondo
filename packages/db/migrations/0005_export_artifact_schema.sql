CREATE TYPE "public"."export_format" AS ENUM('PDF', 'XLSX');--> statement-breakpoint
CREATE TYPE "public"."export_mode" AS ENUM('PREVIEW', 'OFFICIAL');--> statement-breakpoint
CREATE TYPE "public"."export_scope_type" AS ENUM('REVISION', 'CATEGORY', 'POOL');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('REQUESTED', 'GENERATING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."export_type" AS ENUM('TOURNAMENT_DRAW_BOOK', 'CATEGORY_DRAW', 'POOL_SHEET', 'BRACKET_SHEET', 'XLSX_WORKBOOK');--> statement-breakpoint
ALTER TYPE "public"."subject_type" ADD VALUE 'EXPORT_ARTIFACT';--> statement-breakpoint
CREATE TABLE "export_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"draw_run_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"export_type" "export_type" NOT NULL,
	"format" "export_format" NOT NULL,
	"mode" "export_mode" NOT NULL,
	"scope_type" "export_scope_type" NOT NULL,
	"category_id" uuid,
	"pool_id" uuid,
	"status" "export_status" DEFAULT 'REQUESTED' NOT NULL,
	"source_fingerprint" text,
	"output_fingerprint" text,
	"engine_version" text NOT NULL,
	"template_version" text NOT NULL,
	"storage_key" text,
	"filename" text,
	"size_bytes" integer,
	"error_code" text,
	"error_message" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	CONSTRAINT "export_artifact_scope_ck" CHECK (("export_artifact"."scope_type" = 'REVISION' and "export_artifact"."category_id" is null and "export_artifact"."pool_id" is null)
      or ("export_artifact"."scope_type" = 'CATEGORY' and "export_artifact"."category_id" is not null and "export_artifact"."pool_id" is null)
      or ("export_artifact"."scope_type" = 'POOL' and "export_artifact"."category_id" is null and "export_artifact"."pool_id" is not null)),
	CONSTRAINT "export_artifact_ready_ck" CHECK ("export_artifact"."status" <> 'READY' or ("export_artifact"."storage_key" is not null and "export_artifact"."filename" is not null and "export_artifact"."size_bytes" is not null and "export_artifact"."output_fingerprint" is not null and "export_artifact"."generated_at" is not null)),
	CONSTRAINT "export_artifact_failed_ck" CHECK ("export_artifact"."status" <> 'FAILED' or "export_artifact"."error_code" is not null),
	CONSTRAINT "export_artifact_size_ck" CHECK ("export_artifact"."size_bytes" is null or "export_artifact"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_draw_run_id_draw_run_id_fk" FOREIGN KEY ("draw_run_id") REFERENCES "public"."draw_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_revision_id_draw_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_pool_id_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "export_artifact_public_id_uq" ON "export_artifact" USING btree ("id");