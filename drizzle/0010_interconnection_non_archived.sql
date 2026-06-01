-- SPEC-AMENDMENT-001 §7.1 — interconnection invariants.
--
-- The FKs on transactions already ensure references exist; this trigger
-- adds the second half: references must not point at ARCHIVED entities.
-- Plain CHECK constraints can't query other tables, so we use a
-- BEFORE INSERT OR UPDATE trigger that raises on any archived reference.
--
-- Applies to: on_behalf_of_client_id, paid_to_vendor_id,
-- incurred_by_employee_id, project_id. All four are nullable; trigger
-- short-circuits on NULL.
--
-- Idempotent: drops then recreates so re-running the migration is safe.

CREATE OR REPLACE FUNCTION check_transaction_non_archived_refs()
RETURNS TRIGGER AS $$
DECLARE
  archived_flag boolean;
BEGIN
  IF NEW.on_behalf_of_client_id IS NOT NULL THEN
    SELECT is_archived INTO archived_flag FROM clients WHERE id = NEW.on_behalf_of_client_id;
    IF archived_flag THEN
      RAISE EXCEPTION 'transactions.on_behalf_of_client_id (%) points at an archived client', NEW.on_behalf_of_client_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.paid_to_vendor_id IS NOT NULL THEN
    SELECT is_archived INTO archived_flag FROM vendors WHERE id = NEW.paid_to_vendor_id;
    IF archived_flag THEN
      RAISE EXCEPTION 'transactions.paid_to_vendor_id (%) points at an archived vendor', NEW.paid_to_vendor_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.incurred_by_employee_id IS NOT NULL THEN
    SELECT is_archived INTO archived_flag FROM employees WHERE id = NEW.incurred_by_employee_id;
    IF archived_flag THEN
      RAISE EXCEPTION 'transactions.incurred_by_employee_id (%) points at an archived employee', NEW.incurred_by_employee_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT is_archived INTO archived_flag FROM projects WHERE id = NEW.project_id;
    IF archived_flag THEN
      RAISE EXCEPTION 'transactions.project_id (%) points at an archived project', NEW.project_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS check_transaction_non_archived_refs_trigger ON transactions;
--> statement-breakpoint

CREATE TRIGGER check_transaction_non_archived_refs_trigger
BEFORE INSERT OR UPDATE OF on_behalf_of_client_id, paid_to_vendor_id, incurred_by_employee_id, project_id
ON transactions
FOR EACH ROW EXECUTE FUNCTION check_transaction_non_archived_refs();
--> statement-breakpoint
