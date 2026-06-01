-- 0014_dev_admin_user_seed — seed the dev-fallback actor row.
--
-- src/lib/server/actor.ts returns a hard-coded user id when no auth session
-- is present in dev mode:
--
--   { userId: '00000000-0000-0000-0000-000000000000',
--     role:   'admin',
--     capabilities: CAPABILITY_SET }
--
-- Every server action stamps that id into createdBy / updatedBy / postedBy
-- columns. createdBy / updatedBy on most tables are bare uuid (no FK) so
-- those writes succeed quietly — but transactions.posted_by, reversed_by,
-- and validation_acknowledged_by all FK to public.users(id) ON DELETE SET
-- NULL. Without a matching row the very first postTransaction call fails
-- with a foreign-key violation that surfaces as:
--
--   Failed query: update "transactions" set ..., "posted_by" = $5 ...
--
-- This seeds the row idempotently so dev / demo environments stop tripping
-- the FK on the first post. Once real Supabase Auth is wired through and
-- ctx.userId always comes from auth.users, the dev fallback in actor.ts
-- becomes dead code and this row stays around as a harmless ghost admin.

INSERT INTO "users" (id, role, full_name, email)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'admin',
  'Dev Admin (system)',
  'dev-admin@apar.local'
)
ON CONFLICT (id) DO NOTHING;
