-- Billing Phase 1.4 — extend validation_rules with billing-specific checks.
--
-- All new rules are 'warn' severity (LEDGER-SPEC §1.6 + captured-not-computed:
-- we never auto-correct, only flag). The validation engine runs enabled
-- rules during createDraftTransaction / postTransaction; warnings attach
-- to transactions.validation_flags. Billing server actions (Phase 2+)
-- mirror the same rule set against the invoice/bill/receipt headers and
-- attach to <doc>.validation_flags.
--
-- Two flavours of change here:
--   (a) INSERT 5 new rule codes that don't exist yet.
--   (b) UPDATE the existing `tds_threshold_crossed` row (seeded in
--       0007_ledger.sql:612 as disabled) to enabled — the billing
--       module needs it on.

-- ============================================================================
-- (a) New rule codes.
-- ============================================================================

INSERT INTO validation_rules (code, description, is_enabled, severity, config) VALUES
  (
    'gst_split_mismatch',
    'Captured CGST + SGST + IGST + CESS components do not sum to the captured total tax amount on an invoice / credit-note / bill.',
    true, 'warn',
    jsonb_build_object(
      'applies_to', ARRAY['invoices', 'credit_notes', 'bills'],
      'tolerance_paise', 100
    )
  ),
  (
    'hsn_digit_count_vs_turnover',
    'Service line uses a SAC code shorter than required by the seller turnover (4-digit < ₹5 Cr, 6-digit ≥ ₹5 Cr per CBIC notif 78/2020).',
    true, 'warn',
    jsonb_build_object(
      'turnover_threshold_paise', 50000000000,
      'min_digits_under_threshold', 4,
      'min_digits_at_or_above_threshold', 6
    )
  ),
  (
    'credit_note_outside_window',
    'Credit note issued past the Section 34(2) window (earlier of 30 November of FY+1 OR the date GSTR-9 was filed for the original invoice''s FY). Posting must omit the GST output reversal leg (gst_impact_allowed=false).',
    true, 'warn',
    jsonb_build_object(
      'window_end_month', 11,
      'window_end_day', 30
    )
  ),
  (
    'advance_tax_default_rate',
    'Captured advance-tax rate on a customer-advance receipt differs from the reference rate for the service category. Apār typically advances at 18% on services; SAC-specific rates may differ.',
    true, 'warn',
    jsonb_build_object(
      'reference_rate_bps', 1800,
      'tolerance_bps', 0
    )
  ),
  (
    'place_of_supply_vs_supplier_state',
    'Place of supply on an invoice differs from supplier state but no IGST captured (or matches state but IGST captured anyway). Intra-state should split CGST+SGST; inter-state should be IGST only.',
    true, 'warn',
    jsonb_build_object(
      'apar_state_code', '27'
    )
  )
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ============================================================================
-- (b) Enable the existing tds_threshold_crossed rule (seeded disabled in
--     0007_ledger.sql:612). Billing/bill posting (Phase 6) needs it on.
-- ============================================================================

UPDATE validation_rules
SET is_enabled = true,
    config = jsonb_build_object(
      'applies_to', ARRAY['bills', 'receipts'],
      'lookup_table', 'tds_reference_sections'
    ),
    description = 'Cumulative payments to a vendor in the FY crossed the section''s threshold without TDS captured, or captured TDS differs materially from the reference rate.'
WHERE code = 'tds_threshold_crossed';
--> statement-breakpoint
