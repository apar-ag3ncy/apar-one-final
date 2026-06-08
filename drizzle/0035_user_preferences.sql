-- 0035_user_preferences — per-user UI/app preferences, persisted server-side.
--
-- Replaces the browser-localStorage settings store (session-store.ts) so a
-- user's settings SYNC and are REMEMBERED across sessions / devices / logins.
-- One row per user; a single jsonb `prefs` blob keeps adding new settings
-- cheap (no migration per setting). Mirrors the user_table_preferences RLS
-- pattern: RLS on + a service_role-all policy; server actions scope every
-- query by user_id (getActorContext().userId), so the row is per-user.

CREATE TABLE "user_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "user_id" uuid NOT NULL,
  "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_unique" ON "user_preferences" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "user_preferences"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
