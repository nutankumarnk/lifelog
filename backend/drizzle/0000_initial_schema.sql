CREATE TABLE "ai_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"intent" varchar(32) NOT NULL,
	"intent_confidence" double precision DEFAULT 0.5 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"analysis" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"raw_text" text NOT NULL,
	"char_count" integer NOT NULL,
	"language" varchar(32),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timezone" varchar(64),
	"source" varchar(32) DEFAULT 'api' NOT NULL,
	"client_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"local_id" varchar(32) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"raw_kind" varchar(64),
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"relation" varchar(64),
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_entities" (
	"item_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" varchar(32) DEFAULT 'mentioned' NOT NULL,
	CONSTRAINT "item_entities_item_id_entity_id_pk" PRIMARY KEY("item_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"local_id" varchar(32) NOT NULL,
	"type" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"source_text" text DEFAULT '' NOT NULL,
	"span_start" integer,
	"span_end" integer,
	"segment_position" integer,
	"tense" varchar(16) DEFAULT 'UNSPECIFIED' NOT NULL,
	"temporal_raw" text,
	"occurred_at" timestamp with time zone,
	"occurred_end_at" timestamp with time zone,
	"temporal_precision" varchar(16) DEFAULT 'NONE' NOT NULL,
	"recurrence" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_entities" ADD CONSTRAINT "item_entities_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_entities" ADD CONSTRAINT "item_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_invocations_created_idx" ON "ai_invocations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_invocations_status_idx" ON "ai_invocations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analyses_conversation_idx" ON "analyses" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "analyses_intent_idx" ON "analyses" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "analyses_created_at_idx" ON "analyses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversations_user_created_idx" ON "conversations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_analysis_local_uidx" ON "entities" USING btree ("analysis_id","local_id");--> statement-breakpoint
CREATE INDEX "entities_normalized_name_idx" ON "entities" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "entities_kind_idx" ON "entities" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "entities_conversation_idx" ON "entities" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "follow_ups_conversation_idx" ON "follow_ups" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "item_entities_entity_idx" ON "item_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_analysis_local_uidx" ON "items" USING btree ("analysis_id","local_id");--> statement-breakpoint
CREATE INDEX "items_type_idx" ON "items" USING btree ("type");--> statement-breakpoint
CREATE INDEX "items_conversation_idx" ON "items" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "items_occurred_at_idx" ON "items" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "items_type_occurred_idx" ON "items" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_analysis_position_uidx" ON "segments" USING btree ("analysis_id","position");--> statement-breakpoint
CREATE INDEX "segments_conversation_idx" ON "segments" USING btree ("conversation_id");