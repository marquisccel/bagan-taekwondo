CREATE TABLE "schedule_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"day_number" smallint NOT NULL,
	"date" text NOT NULL,
	"arena_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"stream" "stream" NOT NULL,
	"discipline" "discipline" NOT NULL,
	"gender" "category_gender" NOT NULL,
	"age_division_code" text NOT NULL,
	"weight_class_or_format" text NOT NULL,
	CONSTRAINT "schedule_entry_order_uq" UNIQUE("tournament_id","arena_id","day_number","order_index"),
	CONSTRAINT "schedule_entry_day_ck" CHECK ("schedule_entry"."day_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "display_no" integer;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_display_no_ck" CHECK ("match"."display_no" is null or "match"."display_no" >= 1);