-- 0084_employee_login_username — a login id that isn't the work email.
--
-- The employee portal signs in with the work email, but most of the team has
-- no work email on record, so they could never be given portal access. This
-- adds an alternative login id so EVERY active employee can get a default
-- account. Sign-in accepts login_username OR work_email.
--
-- Auto-derived from the person's name at provisioning time (e.g. 'devraj'),
-- deduped against every live login id. Nullable — legacy rows and
-- email-only logins keep working. Case-insensitively unique among LIVE rows
-- (partial index, mirroring os_users_username_lower_unique) so a soft-deleted
-- employee never burns a username.
ALTER TABLE "employees" ADD COLUMN "login_username" text;

CREATE UNIQUE INDEX "employees_login_username_lower_unique"
  ON "employees" (lower("login_username"))
  WHERE "login_username" IS NOT NULL AND "deleted_at" IS NULL;
