CREATE TABLE IF NOT EXISTS "memory_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mention_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "object_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"analysis_id" uuid,
	"source_entity_id" uuid,
	"source_item_id" uuid,
	"origin_type" varchar(32) DEFAULT 'extracted' NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "object_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"source_object_id" uuid NOT NULL,
	"target_object_id" uuid NOT NULL,
	"relationship_type" varchar(64) NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "processing_status" varchar(32) DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_object_id_memory_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."memory_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_origins" ADD CONSTRAINT "object_origins_source_item_id_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_source_object_id_memory_objects_id_fk" FOREIGN KEY ("source_object_id") REFERENCES "public"."memory_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_target_object_id_memory_objects_id_fk" FOREIGN KEY ("target_object_id") REFERENCES "public"."memory_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_objects_user_type_name_uidx" ON "memory_objects" USING btree ("user_id","type","normalized_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_objects_type_idx" ON "memory_objects" USING btree ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_objects_normalized_name_idx" ON "memory_objects" USING btree ("normalized_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_objects_user_idx" ON "memory_objects" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "object_origins_object_conversation_uidx" ON "object_origins" USING btree ("object_id","conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "object_origins_object_idx" ON "object_origins" USING btree ("object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "object_origins_conversation_idx" ON "object_origins" USING btree ("conversation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "object_relationships_src_tgt_type_uidx" ON "object_relationships" USING btree ("source_object_id","target_object_id","relationship_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "object_relationships_source_idx" ON "object_relationships" USING btree ("source_object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "object_relationships_target_idx" ON "object_relationships" USING btree ("target_object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "object_relationships_conversation_idx" ON "object_relationships" USING btree ("source_conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_processing_status_idx" ON "conversations" USING btree ("processing_status");