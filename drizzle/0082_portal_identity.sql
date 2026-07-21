-- 0082_portal_identity — link OS accounts to employees, and give employees a
-- portal role. This is the identity foundation for the employee portal.
--
-- (1) os_users.employee_id — the missing "who am I" link. `os_users` is the
--     only login that actually works (scrypt + the signed httpOnly
--     `apar_os_uid` cookie), so it becomes the single identity table for BOTH
--     populations:
--       - employee_id IS NULL  → a staff/OS account (the /os lock screen),
--         behaviour unchanged.
--       - employee_id IS NOT NULL → an employee portal account.
--     SET NULL on employee delete: an orphaned account simply stops resolving
--     to an employee (and is therefore refused by the portal guard) rather
--     than blocking the delete. Note `employees.user_id` is deliberately NOT
--     reused — it is a uuid FK to auth.users for the unbuilt Supabase Auth
--     path, while os_users.id is TEXT ('super-admin' / 'u-<hex>').
--
--     Partial-unique among live rows: one portal account per employee. It is
--     partial on deleted_at so a soft-deleted account does not permanently
--     burn its employee link (mirrors os_users_username_lower_unique).
--
-- (2) employees.portal_role — 'member' | 'manager'. The two employee-facing
--     roles. Managers get the pending-leave queue over their reporting
--     subtree; members only see themselves. Defaults to 'member' so every
--     existing employee is least-privileged until explicitly promoted.
--     This is deliberately NOT derived from designation: the team-policy
--     TL/managerial lists (0147) drive display chips, and conflating a job
--     title with an approval right would silently grant access on rename.
ALTER TABLE "os_users"
  ADD COLUMN "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "os_users_employee_id_unique"
  ON "os_users" ("employee_id")
  WHERE "employee_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "os_users_employee_id_idx" ON "os_users" ("employee_id");

ALTER TABLE "employees"
  ADD COLUMN "portal_role" text NOT NULL DEFAULT 'member';

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_portal_role_check"
  CHECK ("portal_role" IN ('member', 'manager'));
