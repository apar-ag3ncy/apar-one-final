-- Connect office expenses to the real vendors directory. The UI now
-- picks a vendor from the live list instead of free text. The legacy
-- `vendor_name` column stays for one-off sellers (kirana, team-lunch
-- restaurant, etc.) where adding a permanent vendor row isn't worth it.

ALTER TABLE office_expenses
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS office_expenses_vendor_id_index
  ON office_expenses (vendor_id);
--> statement-breakpoint
