-- Attendance records per employee per day. SPEC-AMENDMENT-001 §8.4
-- "attendance % MTD" KPI feeds off this table.

CREATE TYPE attendance_status AS ENUM (
  'present',
  'work_from_home',
  'absent',
  'half_day',
  'on_leave',
  'weekly_off',
  'holiday'
);
--> statement-breakpoint

CREATE TABLE attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date date NOT NULL,
  status attendance_status NOT NULL,
  leave_id uuid REFERENCES leaves(id) ON DELETE SET NULL,
  notes text
);
--> statement-breakpoint

CREATE UNIQUE INDEX attendance_employee_date_unique
  ON attendance_records (employee_id, date);
--> statement-breakpoint

CREATE INDEX attendance_records_employee_id_date_index
  ON attendance_records (employee_id, date DESC);
--> statement-breakpoint

CREATE INDEX attendance_records_date_index
  ON attendance_records (date);
--> statement-breakpoint

-- RLS — service-role-only baseline (per-role policies layered later).
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "service_role all" ON attendance_records
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
--> statement-breakpoint
