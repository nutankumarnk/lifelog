CREATE TABLE IF NOT EXISTS "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"display_text" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"priority" varchar(16) DEFAULT 'NORMAL' NOT NULL,
	"due_at" timestamp with time zone,
	"temporal_raw" text,
	"recurrence" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_item_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_item_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"item_id" uuid,
	"source_text" text DEFAULT '' NOT NULL,
	"conversation_text" text DEFAULT '' NOT NULL,
	"provider" varchar(32) DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_item_links" (
	"action_item_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" varchar(32) DEFAULT 'about' NOT NULL,
	CONSTRAINT "action_item_links_action_item_id_entity_id_pk" PRIMARY KEY("action_item_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "action_item_sources" ADD CONSTRAINT "action_item_sources_action_item_id_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_item_sources" ADD CONSTRAINT "action_item_sources_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_item_sources" ADD CONSTRAINT "action_item_sources_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_item_links" ADD CONSTRAINT "action_item_links_action_item_id_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_item_links" ADD CONSTRAINT "action_item_links_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_items_dedupe_uidx" ON "action_items" USING btree ("kind","dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_kind_status_idx" ON "action_items" USING btree ("kind","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_due_idx" ON "action_items" USING btree ("due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_item_sources_action_idx" ON "action_item_sources" USING btree ("action_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_item_sources_conversation_idx" ON "action_item_sources" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_item_links_entity_idx" ON "action_item_links" USING btree ("entity_id");
