-- Per-employee UI preferences (theme, dock size, accent, …) for the employee
-- OS session. Stored as jsonb so the shape can evolve without migrations.
-- Employees can't use the operator user_preferences table (that path denies
-- employee sessions), so their prefs live here and are read/written by the
-- self-scoped getMyPreferences / saveMyPreferences actions. NULL = defaults.
ALTER TABLE "employees" ADD COLUMN "ui_prefs" jsonb;
