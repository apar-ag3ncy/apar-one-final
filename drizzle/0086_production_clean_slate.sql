-- 0086_production_clean_slate — DEFUSED, does nothing.
--
-- The original version of this migration wiped every operational table
-- (employees, clients, vendors, invoices, the whole ledger, documents,
-- audit log, users) for a "clean slate" go-live reset. It referenced two
-- table names that don't exist (public.salary / public.attendance — the
-- real names are salary_* / attendance_records), so it has failed on
-- every deploy since 2026-07-29 and was never recorded as applied.
-- Production stayed on the pre-2026-07-29 build the whole time.
--
-- Rewritten as a no-op instead of "fixed": correcting those table names
-- would make this migration actually run — deleting real production data
-- entered after 2026-07-29, which is the opposite of what's needed now.
-- This just lets deploys succeed again with zero data touched.

DO $noop$
BEGIN
  RAISE NOTICE '0086: defused — no-op, no data touched.';
END
$noop$;
