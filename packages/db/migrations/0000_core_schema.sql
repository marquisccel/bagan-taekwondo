CREATE TYPE "public"."actor_kind" AS ENUM('USER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."age_policy" AS ENUM('BIRTH_YEAR', 'AGE_ON_EVENT_DATE', 'AGE_ON_CUTOFF_DATE', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."band_purpose" AS ENUM('MOVEMENT', 'COMPATIBILITY');--> statement-breakpoint
CREATE TYPE "public"."belt_policy" AS ENUM('HARD', 'SOFT', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."bye_policy" AS ENUM('SEED_PRIORITY', 'CONTINGENT_AWARE', 'RANDOM_SEEDED');--> statement-breakpoint
CREATE TYPE "public"."category_gender" AS ENUM('MALE', 'FEMALE', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."category_readiness" AS ENUM('READY', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."command_outcome" AS ENUM('APPLIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."contingent_key" AS ENUM('EXACT', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."correctable_field" AS ENUM('HEIGHT', 'WEIGHT', 'BELT', 'GENDER', 'BIRTH_DATE', 'NIK', 'FULL_NAME');--> statement-breakpoint
CREATE TYPE "public"."discipline" AS ENUM('KYORUGI', 'POOMSAE', 'FREESTYLE_POOMSAE');--> statement-breakpoint
CREATE TYPE "public"."draw_format" AS ENUM('SINGLE_ELIMINATION', 'POOLED_SINGLE_ELIMINATION', 'PERFORMANCE_ORDER');--> statement-breakpoint
CREATE TYPE "public"."draw_run_kind" AS ENUM('SIMULATION', 'CANDIDATE');--> statement-breakpoint
CREATE TYPE "public"."draw_run_status" AS ENUM('QUEUED', 'RUNNING', 'SAFE', 'UNSAFE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."eligibility_status" AS ENUM('BLOCKED', 'READY', 'OVERRIDDEN', 'DRAWN');--> statement-breakpoint
CREATE TYPE "public"."entry_format" AS ENUM('INDIVIDUAL', 'PAIR', 'TEAM');--> statement-breakpoint
CREATE TYPE "public"."entry_group_source" AS ENUM('EXPLICIT', 'IMPORTED', 'HEURISTIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."entry_group_status" AS ENUM('PROPOSED', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE');--> statement-breakpoint
CREATE TYPE "public"."gender_mode" AS ENUM('BY_ENTRY', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('UPLOADED', 'PARSED', 'VALIDATED', 'COMMITTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('ERROR', 'WARNING', 'INFO');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'OVERRIDDEN', 'CORRECTED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('PENDING', 'WALKOVER', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('REGISTERED_DATA', 'VERIFIED_WEIGH_IN');--> statement-breakpoint
CREATE TYPE "public"."partition_dimension" AS ENUM('STREAM', 'DISCIPLINE', 'AGE_DIVISION', 'GENDER', 'WEIGHT_CLASS', 'FORMAT', 'MOVEMENT');--> statement-breakpoint
CREATE TYPE "public"."play_up_policy" AS ENUM('FORBID', 'ALLOW_WITH_WARNING', 'ALLOW_ONE_DIVISION_WITH_WARNING');--> statement-breakpoint
CREATE TYPE "public"."pool_strategy" AS ENUM('WEIGHT_FIRST', 'HEIGHT_FIRST', 'BELT_FIRST', 'BALANCED', 'CONTINGENT_AWARE');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('REGISTERED', 'VERIFIED', 'WITHDRAWN', 'DQ', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."revision_lifecycle" AS ENUM('DRAFT', 'REVIEW', 'APPROVED', 'LOCKED', 'PUBLISHED', 'AMENDED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'DRAWING_OFFICER', 'TECHNICAL_DELEGATE', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."rule_set_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."singleton_policy" AS ENUM('WALKOVER_WITH_SUGGESTIONS', 'BLOCK_CATEGORY');--> statement-breakpoint
CREATE TYPE "public"."stream" AS ENUM('PRESTASI', 'SEMI_PRESTASI');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('IMPORT_ROW', 'ATHLETE', 'ENTRY', 'ENTRY_GROUP', 'CATEGORY', 'RULE_SET', 'DRAW_RUN', 'DRAW_REVISION', 'POOL', 'MATCH', 'COMPLAINT', 'VALIDATION_ISSUE', 'TOURNAMENT');--> statement-breakpoint
CREATE TYPE "public"."table_completeness" AS ENUM('OFFICIAL', 'OBSERVED_SUBSET');--> statement-breakpoint
CREATE TYPE "public"."tolerance_dimension" AS ENUM('WEIGHT', 'HEIGHT', 'BELT');--> statement-breakpoint
CREATE TYPE "public"."tolerance_max_status" AS ENUM('UNSET', 'NONE', 'SET');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "audit_chain_head" (
	"chain_key" text PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	"last_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"chain_key" text NOT NULL,
	"tournament_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"complaint_id" uuid,
	"command_id" uuid,
	"correlation_id" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	CONSTRAINT "audit_event_id_unique" UNIQUE("id"),
	CONSTRAINT "audit_event_actor_ck" CHECK (("audit_event"."actor_kind" = 'USER') = ("audit_event"."actor_id" is not null)),
	CONSTRAINT "audit_event_hash_ck" CHECK ("audit_event"."hash" ~ '^sha256:[0-9a-f]{64}$' and ("audit_event"."prev_hash" is null or "audit_event"."prev_hash" ~ '^sha256:[0-9a-f]{64}$')),
	CONSTRAINT "audit_event_chain_key_ck" CHECK (("audit_event"."tournament_id" is null and "audit_event"."chain_key" = 'global') or ("audit_event"."tournament_id" is not null and "audit_event"."chain_key" = 'tournament:' || "audit_event"."tournament_id"::text))
);
--> statement-breakpoint
CREATE TABLE "complaint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"filed_by_user_id" uuid,
	"filed_by_name" text NOT NULL,
	"contingent_id" uuid,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid,
	"reason" text NOT NULL,
	"status" "complaint_status" DEFAULT 'OPEN' NOT NULL,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"resulting_command_id" uuid,
	"resulting_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaint_decision_ck" CHECK ("complaint"."status" in ('OPEN', 'UNDER_REVIEW') or (char_length(btrim(coalesce("complaint"."decision", ''))) > 0 and "complaint"."decided_by" is not null and "complaint"."decided_at" is not null)),
	CONSTRAINT "complaint_resolution_ref_ck" CHECK ("complaint"."status" not in ('ACCEPTED', 'RESOLVED') or "complaint"."resulting_command_id" is not null or "complaint"."resulting_revision_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "draw_command" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"base_revision_id" uuid NOT NULL,
	"resulting_revision_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expected_lock_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"complaint_id" uuid,
	"outcome" "command_outcome" NOT NULL,
	"rejection_code" text,
	"verdict" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draw_command_idempotency_uq" UNIQUE("tournament_id","idempotency_key"),
	CONSTRAINT "draw_command_rejection_ck" CHECK (("draw_command"."outcome" = 'REJECTED') = ("draw_command"."rejection_code" is not null)),
	CONSTRAINT "draw_command_result_ck" CHECK ("draw_command"."outcome" = 'APPLIED' or "draw_command"."resulting_revision_id" is null),
	CONSTRAINT "draw_command_idempotency_ck" CHECK (char_length("draw_command"."idempotency_key") between 8 and 128)
);
--> statement-breakpoint
CREATE TABLE "arena" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "arena_code_uq" UNIQUE("tournament_id","code"),
	CONSTRAINT "arena_code_ck" CHECK ("arena"."code" ~ '^[A-Z]{1,3}$')
);
--> statement-breakpoint
CREATE TABLE "bracket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"rounds" smallint NOT NULL,
	"entries" integer NOT NULL,
	"byes" integer NOT NULL,
	CONSTRAINT "bracket_pool_id_unique" UNIQUE("pool_id"),
	CONSTRAINT "bracket_power_of_two_ck" CHECK ("bracket"."size" >= 2 and ("bracket"."size" & ("bracket"."size" - 1)) = 0),
	CONSTRAINT "bracket_entries_ck" CHECK ("bracket"."entries" >= 1 and "bracket"."entries" <= "bracket"."size"),
	CONSTRAINT "bracket_byes_ck" CHECK ("bracket"."byes" = "bracket"."size" - "bracket"."entries"),
	CONSTRAINT "bracket_rounds_ck" CHECK ((1 << "bracket"."rounds") = "bracket"."size")
);
--> statement-breakpoint
CREATE TABLE "bracket_slot" (
	"bracket_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"entry_id" uuid,
	"seed_no" smallint,
	"bye_reason" jsonb,
	CONSTRAINT "bracket_slot_bracket_id_position_pk" PRIMARY KEY("bracket_id","position"),
	CONSTRAINT "bracket_slot_entry_uq" UNIQUE("bracket_id","entry_id"),
	CONSTRAINT "bracket_slot_position_ck" CHECK ("bracket_slot"."position" >= 1),
	CONSTRAINT "bracket_slot_bye_reason_ck" CHECK (("bracket_slot"."entry_id" is null) = ("bracket_slot"."bye_reason" is not null)),
	CONSTRAINT "bracket_slot_seed_ck" CHECK ("bracket_slot"."seed_no" is null or ("bracket_slot"."entry_id" is not null and "bracket_slot"."seed_no" >= 1))
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"category_key" text NOT NULL,
	"stream" "stream" NOT NULL,
	"discipline" "discipline" NOT NULL,
	"format" "entry_format" NOT NULL,
	"age_division_id" uuid NOT NULL,
	"gender" "category_gender" NOT NULL,
	"weight_class_id" uuid,
	"movement" text,
	CONSTRAINT "category_key_uq" UNIQUE("rule_set_id","category_key")
);
--> statement-breakpoint
CREATE TABLE "draw_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"draw_run_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"parent_revision_id" uuid,
	"lifecycle" "revision_lifecycle" DEFAULT 'DRAFT' NOT NULL,
	"content_fingerprint" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "draw_revision_no_uq" UNIQUE("draw_run_id","revision_no"),
	CONSTRAINT "draw_revision_no_ck" CHECK ("draw_revision"."revision_no" >= 1),
	CONSTRAINT "draw_revision_parent_ck" CHECK (("draw_revision"."revision_no" = 1) = ("draw_revision"."parent_revision_id" is null)),
	CONSTRAINT "draw_revision_approved_ck" CHECK ("draw_revision"."lifecycle" not in ('APPROVED', 'LOCKED', 'PUBLISHED', 'AMENDED', 'SUPERSEDED') or ("draw_revision"."approved_at" is not null and "draw_revision"."approved_by" is not null)),
	CONSTRAINT "draw_revision_locked_ck" CHECK ("draw_revision"."lifecycle" not in ('LOCKED', 'PUBLISHED', 'AMENDED', 'SUPERSEDED') or ("draw_revision"."locked_at" is not null and "draw_revision"."locked_by" is not null and "draw_revision"."content_fingerprint" is not null)),
	CONSTRAINT "draw_revision_published_ck" CHECK ("draw_revision"."lifecycle" not in ('PUBLISHED', 'AMENDED', 'SUPERSEDED') or ("draw_revision"."published_at" is not null and "draw_revision"."published_by" is not null)),
	CONSTRAINT "draw_revision_superseded_ck" CHECK (("draw_revision"."lifecycle" = 'SUPERSEDED') = ("draw_revision"."superseded_at" is not null)),
	CONSTRAINT "draw_revision_lock_version_ck" CHECK ("draw_revision"."lock_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "draw_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"kind" "draw_run_kind" NOT NULL,
	"status" "draw_run_status" DEFAULT 'QUEUED' NOT NULL,
	"seed" text NOT NULL,
	"engine_version" text NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"rules_fingerprint" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"output_fingerprint" text,
	"params" jsonb NOT NULL,
	"assumptions" jsonb,
	"scope" jsonb NOT NULL,
	"unsafe_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dual_run_match" boolean,
	"duration_ms" integer,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "draw_run_seed_ck" CHECK ("draw_run"."seed" ~ '^(0|[1-9][0-9]{0,19})$'),
	CONSTRAINT "draw_run_fingerprints_ck" CHECK ("draw_run"."rules_fingerprint" ~ '^sha256:[0-9a-f]{64}$' and "draw_run"."input_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "draw_run_candidate_no_assumptions_ck" CHECK ("draw_run"."kind" <> 'CANDIDATE' or "draw_run"."assumptions" is null),
	CONSTRAINT "draw_run_finished_ck" CHECK (("draw_run"."status" in ('SAFE', 'UNSAFE', 'FAILED')) = ("draw_run"."finished_at" is not null)),
	CONSTRAINT "draw_run_safe_output_ck" CHECK ("draw_run"."status" <> 'SAFE' or "draw_run"."output_fingerprint" is not null),
	CONSTRAINT "draw_run_candidate_dual_run_ck" CHECK ("draw_run"."kind" <> 'CANDIDATE' or "draw_run"."status" <> 'SAFE' or "draw_run"."dual_run_match" is true)
);
--> statement-breakpoint
CREATE TABLE "draw_run_category" (
	"draw_run_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"readiness" "category_readiness" NOT NULL,
	"blocked_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_strategy" "pool_strategy",
	CONSTRAINT "draw_run_category_draw_run_id_category_id_pk" PRIMARY KEY("draw_run_id","category_id"),
	CONSTRAINT "draw_run_category_blocked_ck" CHECK ("draw_run_category"."readiness" = 'READY' or "draw_run_category"."selected_strategy" is null)
);
--> statement-breakpoint
CREATE TABLE "match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"match_uid" uuid NOT NULL,
	"bracket_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"position" smallint NOT NULL,
	"feeder_a_slot" smallint,
	"feeder_a_match_id" uuid,
	"feeder_b_slot" smallint,
	"feeder_b_match_id" uuid,
	"arena_id" uuid,
	"order_no" integer,
	"public_code" text,
	"status" "match_status" DEFAULT 'PENDING' NOT NULL,
	CONSTRAINT "match_uid_uq" UNIQUE("revision_id","match_uid"),
	CONSTRAINT "match_position_uq" UNIQUE("bracket_id","round","position"),
	CONSTRAINT "match_round_ck" CHECK ("match"."round" >= 1 and "match"."position" >= 1),
	CONSTRAINT "match_feeder_a_ck" CHECK (("match"."feeder_a_slot" is null) <> ("match"."feeder_a_match_id" is null)),
	CONSTRAINT "match_feeder_b_ck" CHECK (("match"."feeder_b_slot" is null) <> ("match"."feeder_b_match_id" is null)),
	CONSTRAINT "match_public_code_ck" CHECK ("match"."public_code" is null or "match"."public_code" ~ '^[A-Z]{1,3}[0-9]{3,4}[A-Z]?$')
);
--> statement-breakpoint
CREATE TABLE "match_code_registry" (
	"tournament_id" uuid NOT NULL,
	"public_code" text NOT NULL,
	"arena_id" uuid NOT NULL,
	"match_uid" uuid NOT NULL,
	"first_revision_id" uuid NOT NULL,
	"retired_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_code_registry_tournament_id_public_code_pk" PRIMARY KEY("tournament_id","public_code"),
	CONSTRAINT "match_code_registry_uid_uq" UNIQUE("tournament_id","match_uid")
);
--> statement-breakpoint
CREATE TABLE "official_category_assignment" (
	"category_id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"pool_uid" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"is_walkover" boolean NOT NULL,
	"metrics" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	CONSTRAINT "pool_uid_uq" UNIQUE("revision_id","pool_uid"),
	CONSTRAINT "pool_ordinal_uq" UNIQUE("revision_id","category_id","ordinal"),
	CONSTRAINT "pool_id_revision_uq" UNIQUE("id","revision_id"),
	CONSTRAINT "pool_ordinal_ck" CHECK ("pool"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE TABLE "pool_candidate" (
	"draw_run_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"strategy" "pool_strategy" NOT NULL,
	"rank" smallint NOT NULL,
	"selected" boolean NOT NULL,
	"tier0_violations" integer NOT NULL,
	"tier1_cost_fp" bigint NOT NULL,
	"tier2_cost_fp" bigint NOT NULL,
	"partition" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "pool_candidate_draw_run_id_category_id_strategy_pk" PRIMARY KEY("draw_run_id","category_id","strategy"),
	CONSTRAINT "pool_candidate_rank_uq" UNIQUE("draw_run_id","category_id","rank"),
	CONSTRAINT "pool_candidate_selected_valid_ck" CHECK (not "pool_candidate"."selected" or "pool_candidate"."tier0_violations" = 0)
);
--> statement-breakpoint
CREATE TABLE "pool_member" (
	"pool_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	CONSTRAINT "pool_member_pool_id_entry_id_pk" PRIMARY KEY("pool_id","entry_id"),
	CONSTRAINT "pool_member_once_per_revision_uq" UNIQUE("revision_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "quality_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_run_id" uuid,
	"revision_id" uuid,
	"report" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"error_count" integer NOT NULL,
	"warning_count" integer NOT NULL,
	"info_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_report_subject_ck" CHECK (("quality_report"."draw_run_id" is null) <> ("quality_report"."revision_id" is null)),
	CONSTRAINT "quality_report_counts_ck" CHECK ("quality_report"."error_count" >= 0 and "quality_report"."warning_count" >= 0 and "quality_report"."info_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "warning_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"finding_code" text NOT NULL,
	"finding_subject" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warning_acknowledgement_uq" UNIQUE("revision_id","finding_code","finding_subject"),
	CONSTRAINT "warning_acknowledgement_reason_ck" CHECK (char_length(btrim("warning_acknowledgement"."reason")) >= 15)
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tournament" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"event_start" date NOT NULL,
	"event_end" date NOT NULL,
	"timezone" text NOT NULL,
	"status" "tournament_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_code_unique" UNIQUE("code"),
	CONSTRAINT "tournament_dates_ck" CHECK ("tournament"."event_start" <= "tournament"."event_end")
);
--> statement-breakpoint
CREATE TABLE "tournament_member" (
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_member_tournament_id_user_id_role_pk" PRIMARY KEY("tournament_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "athlete" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"nik_ciphertext" "bytea",
	"nik_blind_index" text,
	"nik_format_valid" boolean,
	"full_name" text NOT NULL,
	"gender" "gender" NOT NULL,
	"birth_date" date,
	"registered_height_mm" integer,
	"registered_weight_g" integer,
	"registered_belt_code" text,
	"source_import_row_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_id_tournament_uq" UNIQUE("id","tournament_id"),
	CONSTRAINT "athlete_height_ck" CHECK ("athlete"."registered_height_mm" is null or "athlete"."registered_height_mm" >= 0),
	CONSTRAINT "athlete_weight_ck" CHECK ("athlete"."registered_weight_g" is null or "athlete"."registered_weight_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contingent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid,
	CONSTRAINT "contingent_name_uq" UNIQUE("tournament_id","name"),
	CONSTRAINT "contingent_id_tournament_uq" UNIQUE("id","tournament_id")
);
--> statement-breakpoint
CREATE TABLE "contingent_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "contingent_group_name_uq" UNIQUE("tournament_id","name")
);
--> statement-breakpoint
CREATE TABLE "data_quality_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "data_quality_override_reason_ck" CHECK (char_length(btrim("data_quality_override"."reason")) >= 15),
	CONSTRAINT "data_quality_override_revocation_ck" CHECK (("data_quality_override"."revoked_at" is null and "data_quality_override"."revoked_by" is null and "data_quality_override"."revoke_reason" is null) or ("data_quality_override"."revoked_at" is not null and "data_quality_override"."revoked_by" is not null and char_length(btrim(coalesce("data_quality_override"."revoke_reason", ''))) >= 15))
);
--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"contingent_id" uuid NOT NULL,
	"external_ref" text,
	"import_row_id" uuid,
	"declared_stream" "stream" NOT NULL,
	"declared_discipline" "discipline" NOT NULL,
	"declared_format" "entry_format" NOT NULL,
	"declared_age_division" text NOT NULL,
	"declared_class" text,
	"category_id" uuid,
	"registration_status" "registration_status" DEFAULT 'REGISTERED' NOT NULL,
	"eligibility_status" "eligibility_status" DEFAULT 'BLOCKED' NOT NULL,
	"eligibility_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed_no" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_id_tournament_uq" UNIQUE("id","tournament_id"),
	CONSTRAINT "entry_seed_ck" CHECK ("entry"."seed_no" is null or "entry"."seed_no" >= 1),
	CONSTRAINT "entry_terminal_not_placeable_ck" CHECK ("entry"."registration_status" not in ('WITHDRAWN', 'DQ', 'NO_SHOW') or "entry"."eligibility_status" = 'BLOCKED')
);
--> statement-breakpoint
CREATE TABLE "entry_group" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"source" "entry_group_source" NOT NULL,
	"status" "entry_group_status" NOT NULL,
	"confidence" "confidence_level" NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_group_confirmation_ck" CHECK ("entry_group"."status" <> 'CONFIRMED' or "entry_group"."source" in ('EXPLICIT', 'IMPORTED') or "entry_group"."confirmed_by" is not null),
	CONSTRAINT "entry_group_confirmed_pair_ck" CHECK (("entry_group"."confirmed_by" is null) = ("entry_group"."confirmed_at" is null)),
	CONSTRAINT "entry_group_heuristic_start_ck" CHECK ("entry_group"."source" <> 'HEURISTIC' or "entry_group"."status" <> 'CONFIRMED' or "entry_group"."confirmed_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "entry_member" (
	"entry_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "entry_member_entry_id_position_pk" PRIMARY KEY("entry_id","position"),
	CONSTRAINT "entry_member_athlete_uq" UNIQUE("entry_id","athlete_id"),
	CONSTRAINT "entry_member_position_ck" CHECK ("entry_member"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"rule_set_id" uuid,
	"source_filename" text NOT NULL,
	"source_sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"status" "import_batch_status" DEFAULT 'UPLOADED' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batch_sha_ck" CHECK ("import_batch"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batch_rows_ck" CHECK ("import_batch"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	CONSTRAINT "import_row_number_uq" UNIQUE("batch_id","row_number"),
	CONSTRAINT "import_row_number_ck" CHECK ("import_row"."row_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "measurement_correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"field" "correctable_field" NOT NULL,
	"original_value" text,
	"corrected_value" text NOT NULL,
	"reason" text NOT NULL,
	"validation_issue_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_correction_reason_ck" CHECK (char_length(btrim("measurement_correction"."reason")) >= 15)
);
--> statement-breakpoint
CREATE TABLE "validation_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"rule_set_id" uuid,
	"batch_id" uuid,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"severity" "issue_severity" NOT NULL,
	"field" text,
	"raw_value" text,
	"suggested_value" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	CONSTRAINT "validation_issue_resolution_ck" CHECK (("validation_issue"."status" = 'OPEN') = ("validation_issue"."resolved_at" is null)),
	CONSTRAINT "validation_issue_override_only_errors_ck" CHECK ("validation_issue"."status" <> 'OVERRIDDEN' or "validation_issue"."severity" = 'ERROR'),
	CONSTRAINT "validation_issue_ack_only_non_errors_ck" CHECK ("validation_issue"."status" <> 'ACKNOWLEDGED' or "validation_issue"."severity" <> 'ERROR')
);
--> statement-breakpoint
CREATE TABLE "weigh_in_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"verified_height_mm" integer,
	"verified_weight_g" integer,
	"verified_at" timestamp with time zone NOT NULL,
	"verified_by" uuid NOT NULL,
	"note" text,
	CONSTRAINT "weigh_in_some_value_ck" CHECK ("weigh_in_record"."verified_height_mm" is not null or "weigh_in_record"."verified_weight_g" is not null),
	CONSTRAINT "weigh_in_positive_ck" CHECK (coalesce("weigh_in_record"."verified_height_mm", 1) > 0 and coalesce("weigh_in_record"."verified_weight_g", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "rule_age_division" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"streams" "stream"[] NOT NULL,
	"min_birth_year" integer NOT NULL,
	"max_birth_year" integer NOT NULL,
	"ord" smallint NOT NULL,
	"play_up_policy" "play_up_policy" NOT NULL,
	"provenance" jsonb NOT NULL,
	CONSTRAINT "rule_age_division_code_uq" UNIQUE("rule_set_id","code"),
	CONSTRAINT "rule_age_division_years_ck" CHECK ("rule_age_division"."min_birth_year" <= "rule_age_division"."max_birth_year"),
	CONSTRAINT "rule_age_division_streams_ck" CHECK (cardinality("rule_age_division"."streams") >= 1)
);
--> statement-breakpoint
CREATE TABLE "rule_belt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"rank" smallint NOT NULL,
	"label" text NOT NULL,
	"source_labels" text[] NOT NULL,
	CONSTRAINT "rule_belt_code_uq" UNIQUE("rule_set_id","code"),
	CONSTRAINT "rule_belt_rank_uq" UNIQUE("rule_set_id","rank"),
	CONSTRAINT "rule_belt_rank_ck" CHECK ("rule_belt"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rule_belt_band" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "rule_belt_band_code_uq" UNIQUE("scheme_id","code"),
	CONSTRAINT "rule_belt_band_id_scheme_uq" UNIQUE("id","scheme_id")
);
--> statement-breakpoint
CREATE TABLE "rule_belt_band_member" (
	"band_id" uuid NOT NULL,
	"scheme_id" uuid NOT NULL,
	"belt_id" uuid NOT NULL,
	CONSTRAINT "rule_belt_band_member_band_id_belt_id_pk" PRIMARY KEY("band_id","belt_id"),
	CONSTRAINT "rule_belt_band_member_one_band_uq" UNIQUE("scheme_id","belt_id")
);
--> statement-breakpoint
CREATE TABLE "rule_belt_band_scheme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"purpose" "band_purpose" NOT NULL,
	"provenance" jsonb NOT NULL,
	CONSTRAINT "rule_belt_band_scheme_code_uq" UNIQUE("rule_set_id","code")
);
--> statement-breakpoint
CREATE TABLE "rule_category_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"stream" "stream" NOT NULL,
	"discipline" "discipline" NOT NULL,
	"format" "entry_format" NOT NULL,
	"gender_mode" "gender_mode" NOT NULL,
	"dimensions" "partition_dimension"[] NOT NULL,
	"draw_format" "draw_format" NOT NULL,
	"pool_policy_id" uuid,
	"movement_map_id" uuid,
	"bye_policy" "bye_policy",
	"bronze_medals" smallint,
	"provenance" jsonb NOT NULL,
	CONSTRAINT "rule_category_template_code_uq" UNIQUE("rule_set_id","code"),
	CONSTRAINT "rule_category_template_scope_uq" UNIQUE("rule_set_id","stream","discipline","format"),
	CONSTRAINT "rule_category_template_pool_ck" CHECK (("rule_category_template"."draw_format" = 'POOLED_SINGLE_ELIMINATION') = ("rule_category_template"."pool_policy_id" is not null)),
	CONSTRAINT "rule_category_template_elimination_ck" CHECK ("rule_category_template"."draw_format" = 'PERFORMANCE_ORDER' or ("rule_category_template"."bye_policy" is not null and coalesce("rule_category_template"."bronze_medals", 0) in (1, 2)))
);
--> statement-breakpoint
CREATE TABLE "rule_composition" (
	"rule_set_id" uuid NOT NULL,
	"format" "entry_format" NOT NULL,
	"size" smallint NOT NULL,
	"genders" "gender"[],
	CONSTRAINT "rule_composition_rule_set_id_format_pk" PRIMARY KEY("rule_set_id","format"),
	CONSTRAINT "rule_composition_size_ck" CHECK ("rule_composition"."size" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rule_movement_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"scheme_id" uuid NOT NULL,
	"provenance" jsonb NOT NULL,
	CONSTRAINT "rule_movement_map_code_uq" UNIQUE("rule_set_id","code")
);
--> statement-breakpoint
CREATE TABLE "rule_movement_map_entry" (
	"map_id" uuid NOT NULL,
	"band_id" uuid NOT NULL,
	"movement" text NOT NULL,
	CONSTRAINT "rule_movement_map_entry_map_id_band_id_pk" PRIMARY KEY("map_id","band_id")
);
--> statement-breakpoint
CREATE TABLE "rule_pool_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"pool_min" smallint NOT NULL,
	"pool_target" smallint NOT NULL,
	"pool_max" smallint NOT NULL,
	"size_penalty_provenance" jsonb NOT NULL,
	"belt_policy" "belt_policy" NOT NULL,
	"belt_scheme_id" uuid,
	"belt_provenance" jsonb NOT NULL,
	"tier1_slack_fp" integer NOT NULL,
	"contingent_weight_permille" integer NOT NULL,
	"bracket_weight_permille" integer NOT NULL,
	"tiers_provenance" jsonb NOT NULL,
	"singleton_policy" "singleton_policy" NOT NULL,
	"singleton_provenance" jsonb NOT NULL,
	"measurement_source" "measurement_source" NOT NULL,
	"contingent_key" "contingent_key" NOT NULL,
	"local_search_budget_per_entry" integer NOT NULL,
	CONSTRAINT "rule_pool_policy_code_uq" UNIQUE("rule_set_id","code"),
	CONSTRAINT "rule_pool_policy_sizes_ck" CHECK (1 <= "rule_pool_policy"."pool_min" and "rule_pool_policy"."pool_min" <= "rule_pool_policy"."pool_target" and "rule_pool_policy"."pool_target" <= "rule_pool_policy"."pool_max"),
	CONSTRAINT "rule_pool_policy_hard_belt_ck" CHECK ("rule_pool_policy"."belt_policy" <> 'HARD' or "rule_pool_policy"."belt_scheme_id" is not null),
	CONSTRAINT "rule_pool_policy_weights_ck" CHECK ("rule_pool_policy"."tier1_slack_fp" >= 0 and "rule_pool_policy"."contingent_weight_permille" >= 0 and "rule_pool_policy"."bracket_weight_permille" >= 0 and "rule_pool_policy"."local_search_budget_per_entry" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rule_pool_size_penalty" (
	"policy_id" uuid NOT NULL,
	"size" smallint NOT NULL,
	"penalty_fp" integer NOT NULL,
	CONSTRAINT "rule_pool_size_penalty_policy_id_size_pk" PRIMARY KEY("policy_id","size"),
	CONSTRAINT "rule_pool_size_penalty_ck" CHECK ("rule_pool_size_penalty"."size" >= 1 and "rule_pool_size_penalty"."penalty_fp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rule_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"status" "rule_set_status" DEFAULT 'DRAFT' NOT NULL,
	"age_policy" "age_policy" NOT NULL,
	"age_reference_year" integer,
	"age_cutoff_date" text,
	"age_provenance" jsonb NOT NULL,
	"plausibility" jsonb NOT NULL,
	"source_vocabulary" jsonb NOT NULL,
	"snapshot" jsonb,
	"fingerprint" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "rule_set_version_uq" UNIQUE("tournament_id","version"),
	CONSTRAINT "rule_set_version_ck" CHECK ("rule_set"."version" >= 1),
	CONSTRAINT "rule_set_active_frozen_ck" CHECK ("rule_set"."status" = 'DRAFT' or ("rule_set"."snapshot" is not null and "rule_set"."fingerprint" is not null and "rule_set"."activated_at" is not null)),
	CONSTRAINT "rule_set_fingerprint_ck" CHECK ("rule_set"."fingerprint" is null or "rule_set"."fingerprint" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "rule_tolerance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"dimension" "tolerance_dimension" NOT NULL,
	"age_division_id" uuid,
	"active" boolean NOT NULL,
	"ideal" integer NOT NULL,
	"ideal_provenance" jsonb NOT NULL,
	"max_status" "tolerance_max_status" DEFAULT 'UNSET' NOT NULL,
	"max_value" integer,
	"max_provenance" jsonb,
	"linear_weight_permille" integer NOT NULL,
	"overflow_weight_permille" integer NOT NULL,
	CONSTRAINT "rule_tolerance_scope_uq" UNIQUE NULLS NOT DISTINCT("policy_id","dimension","age_division_id"),
	CONSTRAINT "rule_tolerance_ideal_ck" CHECK ("rule_tolerance"."ideal" > 0),
	CONSTRAINT "rule_tolerance_max_value_ck" CHECK (("rule_tolerance"."max_status" = 'SET') = ("rule_tolerance"."max_value" is not null)),
	CONSTRAINT "rule_tolerance_max_ge_ideal_ck" CHECK ("rule_tolerance"."max_value" is null or "rule_tolerance"."max_value" >= "rule_tolerance"."ideal"),
	CONSTRAINT "rule_tolerance_max_provenance_ck" CHECK (("rule_tolerance"."max_status" = 'UNSET') = ("rule_tolerance"."max_provenance" is null))
);
--> statement-breakpoint
CREATE TABLE "rule_weight_class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"code" text NOT NULL,
	"lower_exclusive_g" integer,
	"upper_inclusive_g" integer,
	"ord" smallint NOT NULL,
	CONSTRAINT "rule_weight_class_code_uq" UNIQUE("table_id","code"),
	CONSTRAINT "rule_weight_class_ord_uq" UNIQUE("table_id","ord"),
	CONSTRAINT "rule_weight_class_code_ck" CHECK ("rule_weight_class"."code" ~ '^[-+][0-9]+$'),
	CONSTRAINT "rule_weight_class_bounds_ck" CHECK ("rule_weight_class"."lower_exclusive_g" is null or "rule_weight_class"."upper_inclusive_g" is null or "rule_weight_class"."lower_exclusive_g" < "rule_weight_class"."upper_inclusive_g")
);
--> statement-breakpoint
CREATE TABLE "rule_weight_class_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"stream" "stream" NOT NULL,
	"age_division_id" uuid NOT NULL,
	"gender" "gender" NOT NULL,
	"completeness" "table_completeness" NOT NULL,
	"provenance" jsonb NOT NULL,
	CONSTRAINT "rule_weight_class_table_scope_uq" UNIQUE("rule_set_id","stream","age_division_id","gender")
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_filed_by_user_id_app_user_id_fk" FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_contingent_id_contingent_id_fk" FOREIGN KEY ("contingent_id") REFERENCES "public"."contingent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_resulting_command_id_draw_command_id_fk" FOREIGN KEY ("resulting_command_id") REFERENCES "public"."draw_command"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_resulting_revision_id_draw_revision_id_fk" FOREIGN KEY ("resulting_revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_command" ADD CONSTRAINT "draw_command_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_command" ADD CONSTRAINT "draw_command_base_revision_id_draw_revision_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_command" ADD CONSTRAINT "draw_command_resulting_revision_id_draw_revision_id_fk" FOREIGN KEY ("resulting_revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_command" ADD CONSTRAINT "draw_command_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_command" ADD CONSTRAINT "draw_command_complaint_id_complaint_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena" ADD CONSTRAINT "arena_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_pool_id_revision_id_pool_id_revision_id_fk" FOREIGN KEY ("pool_id","revision_id") REFERENCES "public"."pool"("id","revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_slot" ADD CONSTRAINT "bracket_slot_bracket_id_bracket_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."bracket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_slot" ADD CONSTRAINT "bracket_slot_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_template_id_rule_category_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."rule_category_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_age_division_id_rule_age_division_id_fk" FOREIGN KEY ("age_division_id") REFERENCES "public"."rule_age_division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_weight_class_id_rule_weight_class_id_fk" FOREIGN KEY ("weight_class_id") REFERENCES "public"."rule_weight_class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_draw_run_id_draw_run_id_fk" FOREIGN KEY ("draw_run_id") REFERENCES "public"."draw_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_parent_revision_id_draw_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_locked_by_app_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_revision" ADD CONSTRAINT "draw_revision_published_by_app_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_run" ADD CONSTRAINT "draw_run_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_run" ADD CONSTRAINT "draw_run_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_run" ADD CONSTRAINT "draw_run_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_run_category" ADD CONSTRAINT "draw_run_category_draw_run_id_draw_run_id_fk" FOREIGN KEY ("draw_run_id") REFERENCES "public"."draw_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_run_category" ADD CONSTRAINT "draw_run_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_revision_id_draw_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_bracket_id_bracket_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."bracket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_feeder_a_match_id_match_id_fk" FOREIGN KEY ("feeder_a_match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_feeder_b_match_id_match_id_fk" FOREIGN KEY ("feeder_b_match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_code_registry" ADD CONSTRAINT "match_code_registry_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_code_registry" ADD CONSTRAINT "match_code_registry_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_code_registry" ADD CONSTRAINT "match_code_registry_first_revision_id_draw_revision_id_fk" FOREIGN KEY ("first_revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_code_registry" ADD CONSTRAINT "match_code_registry_retired_revision_id_draw_revision_id_fk" FOREIGN KEY ("retired_revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_category_assignment" ADD CONSTRAINT "official_category_assignment_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_category_assignment" ADD CONSTRAINT "official_category_assignment_revision_id_draw_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool" ADD CONSTRAINT "pool_revision_id_draw_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool" ADD CONSTRAINT "pool_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_candidate" ADD CONSTRAINT "pool_candidate_draw_run_id_category_id_draw_run_category_draw_run_id_category_id_fk" FOREIGN KEY ("draw_run_id","category_id") REFERENCES "public"."draw_run_category"("draw_run_id","category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_member" ADD CONSTRAINT "pool_member_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_member" ADD CONSTRAINT "pool_member_pool_id_revision_id_pool_id_revision_id_fk" FOREIGN KEY ("pool_id","revision_id") REFERENCES "public"."pool"("id","revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_report" ADD CONSTRAINT "quality_report_draw_run_id_draw_run_id_fk" FOREIGN KEY ("draw_run_id") REFERENCES "public"."draw_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_report" ADD CONSTRAINT "quality_report_revision_id_draw_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warning_acknowledgement" ADD CONSTRAINT "warning_acknowledgement_revision_id_draw_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draw_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warning_acknowledgement" ADD CONSTRAINT "warning_acknowledgement_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_member" ADD CONSTRAINT "tournament_member_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_member" ADD CONSTRAINT "tournament_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_member" ADD CONSTRAINT "tournament_member_granted_by_app_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete" ADD CONSTRAINT "athlete_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete" ADD CONSTRAINT "athlete_source_import_row_id_import_row_id_fk" FOREIGN KEY ("source_import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingent" ADD CONSTRAINT "contingent_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingent" ADD CONSTRAINT "contingent_group_id_contingent_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contingent_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingent_group" ADD CONSTRAINT "contingent_group_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_quality_override" ADD CONSTRAINT "data_quality_override_issue_id_validation_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."validation_issue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_quality_override" ADD CONSTRAINT "data_quality_override_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_quality_override" ADD CONSTRAINT "data_quality_override_revoked_by_app_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_import_row_id_import_row_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_contingent_id_tournament_id_contingent_id_tournament_id_fk" FOREIGN KEY ("contingent_id","tournament_id") REFERENCES "public"."contingent"("id","tournament_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group" ADD CONSTRAINT "entry_group_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group" ADD CONSTRAINT "entry_group_confirmed_by_app_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_member" ADD CONSTRAINT "entry_member_entry_id_tournament_id_entry_id_tournament_id_fk" FOREIGN KEY ("entry_id","tournament_id") REFERENCES "public"."entry"("id","tournament_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_member" ADD CONSTRAINT "entry_member_athlete_id_tournament_id_athlete_id_tournament_id_fk" FOREIGN KEY ("athlete_id","tournament_id") REFERENCES "public"."athlete"("id","tournament_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_correction" ADD CONSTRAINT "measurement_correction_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_correction" ADD CONSTRAINT "measurement_correction_validation_issue_id_validation_issue_id_fk" FOREIGN KEY ("validation_issue_id") REFERENCES "public"."validation_issue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_correction" ADD CONSTRAINT "measurement_correction_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_resolved_by_app_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_in_record" ADD CONSTRAINT "weigh_in_record_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_in_record" ADD CONSTRAINT "weigh_in_record_verified_by_app_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_age_division" ADD CONSTRAINT "rule_age_division_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_belt" ADD CONSTRAINT "rule_belt_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_belt_band" ADD CONSTRAINT "rule_belt_band_scheme_id_rule_belt_band_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."rule_belt_band_scheme"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_belt_band_member" ADD CONSTRAINT "rule_belt_band_member_belt_id_rule_belt_id_fk" FOREIGN KEY ("belt_id") REFERENCES "public"."rule_belt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_belt_band_member" ADD CONSTRAINT "rule_belt_band_member_band_id_scheme_id_rule_belt_band_id_scheme_id_fk" FOREIGN KEY ("band_id","scheme_id") REFERENCES "public"."rule_belt_band"("id","scheme_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_belt_band_scheme" ADD CONSTRAINT "rule_belt_band_scheme_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_category_template" ADD CONSTRAINT "rule_category_template_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_category_template" ADD CONSTRAINT "rule_category_template_pool_policy_id_rule_pool_policy_id_fk" FOREIGN KEY ("pool_policy_id") REFERENCES "public"."rule_pool_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_category_template" ADD CONSTRAINT "rule_category_template_movement_map_id_rule_movement_map_id_fk" FOREIGN KEY ("movement_map_id") REFERENCES "public"."rule_movement_map"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_composition" ADD CONSTRAINT "rule_composition_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_movement_map" ADD CONSTRAINT "rule_movement_map_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_movement_map" ADD CONSTRAINT "rule_movement_map_scheme_id_rule_belt_band_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."rule_belt_band_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_movement_map_entry" ADD CONSTRAINT "rule_movement_map_entry_map_id_rule_movement_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."rule_movement_map"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_movement_map_entry" ADD CONSTRAINT "rule_movement_map_entry_band_id_rule_belt_band_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."rule_belt_band"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_pool_policy" ADD CONSTRAINT "rule_pool_policy_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_pool_policy" ADD CONSTRAINT "rule_pool_policy_belt_scheme_id_rule_belt_band_scheme_id_fk" FOREIGN KEY ("belt_scheme_id") REFERENCES "public"."rule_belt_band_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_pool_size_penalty" ADD CONSTRAINT "rule_pool_size_penalty_policy_id_rule_pool_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."rule_pool_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tolerance" ADD CONSTRAINT "rule_tolerance_policy_id_rule_pool_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."rule_pool_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tolerance" ADD CONSTRAINT "rule_tolerance_age_division_id_rule_age_division_id_fk" FOREIGN KEY ("age_division_id") REFERENCES "public"."rule_age_division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_weight_class" ADD CONSTRAINT "rule_weight_class_table_id_rule_weight_class_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."rule_weight_class_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_weight_class_table" ADD CONSTRAINT "rule_weight_class_table_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_weight_class_table" ADD CONSTRAINT "rule_weight_class_table_age_division_id_rule_age_division_id_fk" FOREIGN KEY ("age_division_id") REFERENCES "public"."rule_age_division"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_chain_ix" ON "audit_event" USING btree ("chain_key","seq");--> statement-breakpoint
CREATE INDEX "audit_event_subject_ix" ON "audit_event" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "draw_run_tournament_ix" ON "draw_run" USING btree ("tournament_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_public_code_uq" ON "match" USING btree ("revision_id","public_code") WHERE "match"."public_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pool_candidate_one_selected_uq" ON "pool_candidate" USING btree ("draw_run_id","category_id") WHERE "pool_candidate"."selected";--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_lower_uq" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_nik_blind_index_uq" ON "athlete" USING btree ("tournament_id","nik_blind_index") WHERE "athlete"."nik_blind_index" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "data_quality_override_active_uq" ON "data_quality_override" USING btree ("issue_id") WHERE "data_quality_override"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_external_ref_uq" ON "entry" USING btree ("tournament_id","external_ref") WHERE "entry"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "entry_tournament_eligibility_ix" ON "entry" USING btree ("tournament_id","eligibility_status");--> statement-breakpoint
CREATE INDEX "validation_issue_open_ix" ON "validation_issue" USING btree ("tournament_id","status","severity");--> statement-breakpoint
CREATE INDEX "validation_issue_subject_ix" ON "validation_issue" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_set_one_active_uq" ON "rule_set" USING btree ("tournament_id") WHERE "rule_set"."status" = 'ACTIVE';