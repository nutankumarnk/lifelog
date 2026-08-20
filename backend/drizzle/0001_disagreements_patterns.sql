CREATE TABLE IF NOT EXISTS "disagreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"field" varchar(64) NOT NULL,
	"algorithm_value" jsonb,
	"ai_value" jsonb,
	"winner" varchar(16) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pattern_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" varchar(64) NOT NULL,
	"label" varchar(64) NOT NULL,
	"weight" double precision DEFAULT 0.5 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disagreements" ADD CONSTRAINT "disagreements_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disagreements" ADD CONSTRAINT "disagreements_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disagreements_analysis_idx" ON "disagreements" USING btree ("analysis_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disagreements_conversation_idx" ON "disagreements" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disagreements_field_idx" ON "disagreements" USING btree ("field");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pattern_weights_feature_label_uidx" ON "pattern_weights" USING btree ("feature","label");
