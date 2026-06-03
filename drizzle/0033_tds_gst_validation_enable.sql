-- Phase 7 — TDS cumulative tracking + GST rate validation.
--
-- 1. Enable the three seeded-but-disabled rules from 0007:
--    - gst_rate_mismatch  (warn)
--    - tds_missing        (warn)
--    - tds_threshold_crossed (warn)
--    These are warn-severity for v1; can flip to 'block' via UPDATE
--    once data quality is high enough that false positives are rare.
--
-- 2. Create vw_tds_vendor_fy_cumulative — vendor × section × fiscal
--    year rollup of TDS bases (the gross amount) from the bills
--    table. Used by the tds_threshold_crossed handler to check if a
--    new bill would cross a section threshold, and by reports that
--    need "how close is vendor X to the 30L 194C limit this FY".
--
--    Indian FY runs Apr–Mar. We compute fiscal_year as:
--      fiscal_year = year(document_date) + (1 if month >= 4 else 0)
--    so an Apr 2025 bill lands in FY 2026.

UPDATE validation_rules
SET is_enabled = true,
    updated_at = now()
WHERE code IN ('gst_rate_mismatch', 'tds_missing', 'tds_threshold_crossed');
--> statement-breakpoint

CREATE OR REPLACE VIEW vw_tds_vendor_fy_cumulative AS
SELECT
  b.vendor_id,
  b.captured_tds_section AS section,
  CASE
    WHEN EXTRACT(MONTH FROM b.document_date) >= 4
      THEN EXTRACT(YEAR FROM b.document_date)::int + 1
    ELSE EXTRACT(YEAR FROM b.document_date)::int
  END AS fiscal_year,
  COALESCE(SUM(b.subtotal_paise), 0)::bigint AS cumulative_base_paise,
  COALESCE(SUM(b.captured_tds_amount_paise), 0)::bigint AS cumulative_tds_paise,
  COUNT(*) AS bill_count
FROM bills b
WHERE b.state IN ('recorded', 'partially_paid', 'paid')
  AND b.captured_tds_section IS NOT NULL
GROUP BY b.vendor_id, b.captured_tds_section,
  CASE
    WHEN EXTRACT(MONTH FROM b.document_date) >= 4
      THEN EXTRACT(YEAR FROM b.document_date)::int + 1
    ELSE EXTRACT(YEAR FROM b.document_date)::int
  END;
--> statement-breakpoint

COMMENT ON VIEW vw_tds_vendor_fy_cumulative IS
  'Phase 7: vendor × TDS section × FY cumulative base + TDS captured. '
  'Used by tds_threshold_crossed validation and TDS reports. Indian FY '
  '(Apr-Mar). Re-evaluated on every read; promote to MATERIALIZED VIEW '
  'with a refresh trigger if read perf becomes an issue.';
--> statement-breakpoint
