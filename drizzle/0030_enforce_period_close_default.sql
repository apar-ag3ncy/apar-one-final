-- Phase 1.4 — flip period-close enforcement on by default.
--
-- Before this migration:
--   - settings.enforce_period_close was seeded `false` in 0007 (v1 demo
--     default per LEDGER-SPEC §7).
--   - validation_rules.period_closed was seeded `is_enabled = false` in 0007.
--
-- After this migration:
--   - The settings flag is `true`, signalling intent that the books are
--     authoritative. The flag is read by `src/app/(app)/settings/periods`
--     and any future UI gate.
--   - The validation rule is enabled at warn severity. The HARD BLOCK lives
--     inside `postTransaction` (`src/lib/server/ledger/transactions.ts`)
--     where it queries `periods.status` directly and throws
--     `AppError('ledger.period_closed', ...)`. The validation rule warns
--     earlier so the UI can highlight the draft before the user reaches
--     the post step.
--
-- Idempotent — re-applying is a no-op (UPDATEs run twice land on the same
-- final value).

UPDATE settings
SET value_bool = true,
    updated_at = now()
WHERE key = 'enforce_period_close';
--> statement-breakpoint

UPDATE validation_rules
SET is_enabled = true,
    severity = 'warn',
    updated_at = now()
WHERE code = 'period_closed';
--> statement-breakpoint
