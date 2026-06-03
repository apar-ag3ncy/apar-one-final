-- Phase 6 — closing entries.
--
-- Two changes:
--   1. Add 'closing' to transaction_source_kind so the year-end
--      closing JV (Dr every 4xxx + 5xxx + 6xxx, Cr 3300 Retained
--      Earnings) can be distinguished from a regular JV. The entry is
--      still kind='journal' (uses the journal posting template); the
--      source_kind discriminator lets reports filter it out when
--      presenting the current-period view of P&L accounts.
--   2. Seed account 3300 Retained Earnings — the destination for the
--      P&L roll-up. Non-control equity account, no subledger.

ALTER TYPE transaction_source_kind ADD VALUE IF NOT EXISTS 'closing';
--> statement-breakpoint

INSERT INTO accounts (code, name, type, is_control, subledger_kind)
VALUES ('3300', 'Retained Earnings', 'equity', false, NULL)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
