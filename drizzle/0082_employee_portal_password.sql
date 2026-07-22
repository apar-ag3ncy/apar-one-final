-- Employee portal login (Supabase-free). Adds a scrypt password hash so an
-- employee can sign in to the /me self-service portal with their work email.
--
-- NULL = no portal access yet (mirrors the legacy `user_id IS NULL` intent in
-- SPEC-AMENDMENT-001 §8.1). Hashes are 'scrypt$<salt_hex>$<hash_hex>', produced
-- by src/lib/server/employee-auth.ts — plaintext is never stored. The value is
-- read only through the service-role connection in server actions and is never
-- surfaced to the client (currentEmployee() sanitizes it out), so no extra RLS
-- policy is required on top of the existing employees-table policies.
ALTER TABLE "employees" ADD COLUMN "password_hash" text;
