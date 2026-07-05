-- ───────────────────────────────────────────────────────────────────────────
-- 0052_entity_type_period — let period close/reopen write its activity event.
--
-- setPeriodStatus (src/lib/server/ledger/periods.ts) logs the transition to
-- entity_activity_log with entity_type='period', but the enum only ever
-- contained client|vendor|employee|project|office — so EVERY period
-- soft-close/close/reopen failed at the INSERT and rolled back the whole
-- transition (the event kinds period.closed / period.reopened existed; only
-- the entity_type label was missed). Found by the 2026-07-04 prod sweep.
--
-- Two steps:
--   1. ALTER TYPE … ADD VALUE 'period' (PG12+ allows this inside the
--      migration's transaction as long as the new value isn't consumed in the
--      same transaction — it isn't; the function below only compares text).
--   2. Teach the polymorphic-FK checker to resolve 'period' → periods, so the
--      deferred trigger on entity_activity_log validates the period id.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'period';
--> statement-breakpoint

-- Same body as 0004 plus the 'period' mapping.
CREATE OR REPLACE FUNCTION public.assert_polymorphic_entity_exists(
  p_entity_type text,
  p_entity_id uuid
) RETURNS void AS $$
DECLARE
  v_table_name text;
  v_exists boolean;
BEGIN
  IF p_entity_type IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'assert_polymorphic_entity_exists: NULL entity_type or entity_id';
  END IF;

  v_table_name := CASE p_entity_type
    WHEN 'client'   THEN 'clients'
    WHEN 'vendor'   THEN 'vendors'
    WHEN 'employee' THEN 'employees'
    WHEN 'project'  THEN 'projects'
    WHEN 'period'   THEN 'periods'
    WHEN 'office'   THEN NULL  -- synthetic; no row
    ELSE NULL
  END;

  IF v_table_name IS NULL THEN
    -- 'office' is the only legitimate no-row case
    IF p_entity_type = 'office' THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'unknown entity_type: %', p_entity_type;
  END IF;

  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_table_name)
    INTO v_exists
    USING p_entity_id;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'polymorphic FK violation: % entity % does not exist in public.%',
      p_entity_type, p_entity_id, v_table_name;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
