-- Billing Phase 7 — materialized views for AR aging + billing KPIs.
--
-- Both views derive everything from posted documents + their settlements
-- (payment_allocations + advance_allocations + credit_notes). Captured-
-- not-computed: no rates / taxes are re-derived; only sums and date
-- diffs.
--
-- Refresh policy (v1): scheduled REFRESH MATERIALIZED VIEW CONCURRENTLY
-- on a 5-minute cadence via Supabase pg_cron. The dashboard query path
-- reads directly; staleness is acceptable for AR aging which moves
-- slowly. A future enhancement (Phase 9+) can wire AFTER-INSERT triggers
-- on payment_allocations / credit_notes to refresh on demand, but the
-- 5-minute lag is fine for v1 and a lot cheaper.
--
-- Both views use `WITH NO DATA` initially so the migration applies
-- against an empty schema. The first REFRESH populates them.

/* ──────────────────────────────────────────────────────────────────────
 * 1. ar_aging — one row per invoice that has outstanding balance > 0.
 * ────────────────────────────────────────────────────────────────────── */

CREATE MATERIALIZED VIEW ar_aging AS
SELECT
  i.id AS invoice_id,
  i.client_id AS party_entity_id,
  i.document_number,
  i.document_date,
  i.due_date,
  i.captured_total_paise AS invoice_total_paise,
  COALESCE(pa.allocated, 0)::bigint AS payment_allocated_paise,
  COALESCE(aa.allocated, 0)::bigint AS advance_allocated_paise,
  COALESCE(cn.credited, 0)::bigint AS credit_noted_paise,
  (
    i.captured_total_paise
      - COALESCE(pa.allocated, 0)
      - COALESCE(aa.allocated, 0)
      - COALESCE(cn.credited, 0)
  )::bigint AS outstanding_paise,
  GREATEST(0, (CURRENT_DATE - i.due_date))::integer AS days_overdue_by_due,
  GREATEST(0, (CURRENT_DATE - i.document_date))::integer AS days_overdue_by_invoice,
  -- Aging bucket by DUE date (most common for collections).
  CASE
    WHEN i.due_date IS NULL THEN 'no_due_date'
    WHEN CURRENT_DATE <= i.due_date THEN 'current'
    WHEN CURRENT_DATE - i.due_date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90'
    ELSE '90+'
  END AS bucket_by_due,
  -- Aging bucket by INVOICE date (compliance reports often use this).
  CASE
    WHEN CURRENT_DATE - i.document_date <= 30 THEN '0-30'
    WHEN CURRENT_DATE - i.document_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - i.document_date <= 90 THEN '61-90'
    ELSE '90+'
  END AS bucket_by_invoice
FROM invoices i
LEFT JOIN (
  SELECT invoice_id, SUM(allocated_paise) AS allocated
  FROM payment_allocations
  GROUP BY invoice_id
) pa ON pa.invoice_id = i.id
LEFT JOIN (
  SELECT invoice_id, SUM(allocated_paise) AS allocated
  FROM advance_allocations
  GROUP BY invoice_id
) aa ON aa.invoice_id = i.id
LEFT JOIN (
  SELECT original_invoice_id, SUM(captured_total_paise) AS credited
  FROM credit_notes
  WHERE state = 'issued'
  GROUP BY original_invoice_id
) cn ON cn.original_invoice_id = i.id
WHERE
  i.state IN ('sent', 'partially_paid', 'paid')
  AND i.deleted_at IS NULL
  AND (
    i.captured_total_paise
      - COALESCE(pa.allocated, 0)
      - COALESCE(aa.allocated, 0)
      - COALESCE(cn.credited, 0)
  ) > 0
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX ar_aging_invoice_id_unique ON ar_aging (invoice_id);
--> statement-breakpoint
CREATE INDEX ar_aging_party_entity_id_index ON ar_aging (party_entity_id);
--> statement-breakpoint
CREATE INDEX ar_aging_bucket_by_due_index ON ar_aging (bucket_by_due);
--> statement-breakpoint
CREATE INDEX ar_aging_bucket_by_invoice_index ON ar_aging (bucket_by_invoice);
--> statement-breakpoint
CREATE INDEX ar_aging_due_date_index ON ar_aging (due_date);
--> statement-breakpoint

/* ──────────────────────────────────────────────────────────────────────
 * 2. billing_kpis — single-row summary view for the dashboard headline.
 *
 *   total_outstanding_paise   — sum of ar_aging.outstanding_paise
 *   oldest_invoice_days       — MAX(days_overdue_by_due)
 *   pct_in_90_plus            — outstanding in 90+ bucket / total * 10000 (bps)
 *   this_month_invoiced_paise — sum of invoices.captured_total_paise this CALENDAR month, state != draft/void
 *   this_month_received_paise — sum of receipts.total_paise this CALENDAR month
 *   avg_days_to_pay_90d       — for invoices PAID in the last 90 days,
 *                                average (paid_date - document_date) in days
 *
 * "this month" uses calendar month in IST (UTC + 5:30). DATE_TRUNC('month',
 * (now() AT TIME ZONE 'Asia/Kolkata')) returns the IST month boundary.
 * ────────────────────────────────────────────────────────────────────── */

CREATE MATERIALIZED VIEW billing_kpis AS
SELECT
  COALESCE((SELECT SUM(outstanding_paise) FROM ar_aging), 0)::bigint AS total_outstanding_paise,
  COALESCE((SELECT MAX(days_overdue_by_due) FROM ar_aging), 0)::integer AS oldest_invoice_days,
  CASE
    WHEN COALESCE((SELECT SUM(outstanding_paise) FROM ar_aging), 0) = 0 THEN 0
    ELSE (
      COALESCE((SELECT SUM(outstanding_paise) FROM ar_aging WHERE bucket_by_due = '90+'), 0) * 10000
      / GREATEST(COALESCE((SELECT SUM(outstanding_paise) FROM ar_aging), 0), 1)
    )
  END::integer AS pct_in_90_plus_bps,
  COALESCE((
    SELECT SUM(captured_total_paise)::bigint
    FROM invoices
    WHERE state NOT IN ('draft', 'void')
      AND deleted_at IS NULL
      AND document_date >= DATE_TRUNC('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date
  ), 0)::bigint AS this_month_invoiced_paise,
  COALESCE((
    SELECT SUM(total_paise)::bigint
    FROM receipts
    WHERE receipt_date >= DATE_TRUNC('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date
      AND deleted_at IS NULL
  ), 0)::bigint AS this_month_received_paise,
  COALESCE((
    -- Avg days to pay for invoices that REACHED 'paid' state in the last 90 days.
    -- Approximation: uses invoices.updated_at as the paid-on date (the
    -- last allocation flips state to 'paid' and bumps updated_at via the
    -- $onUpdate hook). A more precise model would store a paid_at column.
    SELECT (AVG(EXTRACT(EPOCH FROM (updated_at - document_date::timestamp)) / 86400))::integer
    FROM invoices
    WHERE state = 'paid'
      AND updated_at >= now() - INTERVAL '90 days'
      AND deleted_at IS NULL
  ), 0)::integer AS avg_days_to_pay_90d,
  now() AS computed_at
WITH NO DATA;
--> statement-breakpoint

-- Singleton view; no index needed but a unique index on `computed_at` lets
-- us REFRESH MATERIALIZED VIEW CONCURRENTLY (postgres requires at least
-- one unique index for CONCURRENTLY).
CREATE UNIQUE INDEX billing_kpis_computed_at_unique ON billing_kpis (computed_at);
--> statement-breakpoint

/* ──────────────────────────────────────────────────────────────────────
 * 3. RLS — service-role only, matching the rest of the billing surface.
 *    Materialized views inherit RLS-disabled by default; we don't enable
 *    RLS on them in v1 because the only readers are server actions
 *    running under service_role. If the dashboard ever needs a
 *    user-scoped read, add a SECURITY DEFINER function that queries the
 *    view and applies the right WHERE clause.
 * ────────────────────────────────────────────────────────────────────── */

-- Revoke from PUBLIC explicitly so an accidental anon GRANT doesn't
-- expose the views.
REVOKE ALL ON ar_aging FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON billing_kpis FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON ar_aging TO service_role;
--> statement-breakpoint
GRANT SELECT ON billing_kpis TO service_role;
--> statement-breakpoint

/* ──────────────────────────────────────────────────────────────────────
 * 4. Refresh helper function. Callable from the cron job + manually
 *    from the dashboard "refresh KPIs" button. CONCURRENTLY so readers
 *    aren't blocked. Refreshes ar_aging first, then billing_kpis
 *    (which depends on it).
 * ────────────────────────────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION refresh_billing_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY ar_aging;
  REFRESH MATERIALIZED VIEW CONCURRENTLY billing_kpis;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION refresh_billing_views() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION refresh_billing_views() TO service_role;
--> statement-breakpoint

-- First population so the views aren't empty after migration apply.
-- (Concurrent refresh requires data to exist; this initial REFRESH
-- without CONCURRENTLY does the seeding.)
REFRESH MATERIALIZED VIEW ar_aging;
--> statement-breakpoint
REFRESH MATERIALIZED VIEW billing_kpis;
--> statement-breakpoint
