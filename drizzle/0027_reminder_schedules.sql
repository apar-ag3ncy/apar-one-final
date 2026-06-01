-- Billing Phase 9 — reminder_schedules table.
--
-- Per-customer (or global default) configuration for the dunning cron
-- that walks open invoices daily and fires emails via Resend. Each
-- row defines a sequence of "send a reminder N days after / before
-- due date" entries.
--
-- A NULL client_id row is the global default — applies to any client
-- without an explicit schedule. Exactly one global default allowed
-- (partial-unique index).
--
-- The cron handler (src/app/api/cron/billing-reminders/route.ts)
-- joins invoices in 'sent' / 'partially_paid' state against this
-- table + invoice_reminder_log to decide what to send today.

CREATE TABLE reminder_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  /** NULL = global default. */
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  /** Name shown in the schedule picker UI. */
  name text NOT NULL,
  /** Whether this schedule is active. Disabling pauses sends without deleting history. */
  is_active boolean NOT NULL DEFAULT true,
  /** Array of {offset_days, template, channel} rule objects. Negative offset = before due. */
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text
);
--> statement-breakpoint

-- Exactly one global default row.
CREATE UNIQUE INDEX reminder_schedules_global_default_unique
  ON reminder_schedules ((client_id IS NULL))
  WHERE client_id IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX reminder_schedules_client_id_unique
  ON reminder_schedules (client_id)
  WHERE client_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX reminder_schedules_is_active_index
  ON reminder_schedules (is_active);
--> statement-breakpoint

-- RLS — service-role only.
ALTER TABLE reminder_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON reminder_schedules
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Seed the global default with a reasonable starter sequence:
-- -3 days before due (gentle reminder), 0 days (due today), +7 / +30 / +60
-- after due (escalating).
INSERT INTO reminder_schedules (client_id, name, rules, is_active, notes)
VALUES (
  NULL,
  'Global default — 5-step dunning',
  jsonb_build_array(
    jsonb_build_object('offset_days', -3, 'template', 'gentle_pre_due', 'channel', 'email'),
    jsonb_build_object('offset_days',  0, 'template', 'due_today',      'channel', 'email'),
    jsonb_build_object('offset_days',  7, 'template', 'friendly_nudge', 'channel', 'email'),
    jsonb_build_object('offset_days', 30, 'template', 'firm_followup',  'channel', 'email'),
    jsonb_build_object('offset_days', 60, 'template', 'final_notice',   'channel', 'email')
  ),
  true,
  'Auto-seeded by 0027_reminder_schedules.sql. Disable or edit the rules array as needed.'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
