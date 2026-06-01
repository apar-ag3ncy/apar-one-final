-- Office expenses — lightweight system-of-record for everyday outflows
-- (stationary, tea/coffee, cleaning, leisure, utilities, rent,
-- reimbursements). Captured, never computed (CLAUDE rules #1, #2). The
-- Office OS app reads and writes this table directly; posting to the
-- GL (`office_expense` / `employee_reimbursement` templates) happens
-- as a follow-up once a receipt is attached.

CREATE TYPE office_expense_category AS ENUM (
  'stationary',
  'toiletries',
  'tea_coffee',
  'cleaning',
  'leisure',
  'utilities',
  'rent',
  'travel',
  'repairs',
  'reimbursement',
  'other'
);
--> statement-breakpoint

CREATE TYPE office_expense_payment_method AS ENUM (
  'cash',
  'bank',
  'card',
  'upi',
  'employee_paid'
);
--> statement-breakpoint

CREATE TYPE office_expense_status AS ENUM (
  'pending',
  'approved',
  'reimbursed',
  'rejected'
);
--> statement-breakpoint

CREATE TABLE office_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  expense_date date NOT NULL,
  category office_expense_category NOT NULL,
  description text NOT NULL,
  vendor_name text,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  amount_paise bigint NOT NULL,
  gst_paise bigint NOT NULL DEFAULT 0,
  payment_method office_expense_payment_method NOT NULL DEFAULT 'bank',
  status office_expense_status NOT NULL DEFAULT 'approved',
  reference_number text,
  notes text
);
--> statement-breakpoint

CREATE INDEX office_expenses_expense_date_index ON office_expenses (expense_date);
--> statement-breakpoint
CREATE INDEX office_expenses_category_index ON office_expenses (category);
--> statement-breakpoint
CREATE INDEX office_expenses_employee_id_index ON office_expenses (employee_id);
--> statement-breakpoint
CREATE INDEX office_expenses_status_index ON office_expenses (status);
--> statement-breakpoint

-- RLS — service-role-only baseline. Per-role policies layered on later
-- (accountants + admins write; everyone with the office_expenses view
-- capability reads).
ALTER TABLE office_expenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "service_role all" ON office_expenses
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
--> statement-breakpoint
