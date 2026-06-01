-- ───────────────────────────────────────────────────────────────────────────
-- 0004_polymorphic_check_trigger — Phase 2 of the agent-backend brief.
--
-- AUDIT-GAPS §1.1 calls for "CHECK constraint + trigger validating
-- entity_id resolves in the right principal table." Polymorphic FKs cannot
-- be expressed natively in Postgres (a FK targets exactly one table), so
-- we use a deferred trigger that runs the lookup at row write time.
--
-- Why deferred: bulk loads (Phase 5 seed, future imports) want to insert
-- the child rows in a transaction that also creates the parent rows. A
-- deferred trigger fires at COMMIT, so the parent rows are visible by
-- then.
--
-- 'office' is the one entity_type without a row — it represents
-- "the agency itself" for chart-of-accounts attribution, and the trigger
-- short-circuits for it.
-- ───────────────────────────────────────────────────────────────────────────

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
--> statement-breakpoint

-- ── Trigger for tables with a single (entity_type, entity_id) pair ────────

CREATE OR REPLACE FUNCTION public.tg_check_polymorphic_entity() RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.assert_polymorphic_entity_exists(NEW.entity_type::text, NEW.entity_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ── Trigger for entity_relationships (two polymorphic ends) ───────────────

CREATE OR REPLACE FUNCTION public.tg_check_polymorphic_relationship() RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.assert_polymorphic_entity_exists(NEW.from_entity_type::text, NEW.from_entity_id);
  PERFORM public.assert_polymorphic_entity_exists(NEW.to_entity_type::text, NEW.to_entity_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ── Attach to each polymorphic-child table ────────────────────────────────
-- Use CONSTRAINT TRIGGER so we can mark it DEFERRABLE INITIALLY DEFERRED.
-- This lets a seed script create the parent + child in the same transaction
-- and have the check run at COMMIT.

CREATE CONSTRAINT TRIGGER trg_entity_contacts_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_contacts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_addresses_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_addresses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_bank_accounts_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_bank_accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_tax_identifiers_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_tax_identifiers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_documents_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_documents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_custom_values_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_custom_values
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_activity_log_polymorphic_check
  AFTER INSERT OR UPDATE OF entity_type, entity_id ON public.entity_activity_log
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_entity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_entity_relationships_polymorphic_check
  AFTER INSERT OR UPDATE OF from_entity_type, from_entity_id, to_entity_type, to_entity_id
  ON public.entity_relationships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_check_polymorphic_relationship();
