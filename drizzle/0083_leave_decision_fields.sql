-- 0083_leave_decision_fields — give a leave decision somewhere to live.
--
-- BACKGROUND: `leaves` had exactly ONE free-text column, `notes`. `applyLeave`
-- writes the APPLICANT's reason into it, and `approveLeave` then did
--     .set({ ..., notes: args.notes ?? null })
-- unconditionally — so every approve/reject silently ERASED the employee's own
-- reason. (The only caller passed no notes, so in practice every decision to
-- date nulled it.) There was therefore nowhere to put a manager's reply, and
-- nothing recorded whether an approved leave was paid or unpaid.
--
-- (1) manager_note — the manager's reply, shown to the employee alongside the
--     decision. Kept SEPARATE from `notes` rather than reusing it, so the two
--     sides of the conversation can both exist. `notes` keeps its meaning
--     (the applicant's reason) and existing rows need no backfill.
--
-- (2) decided_by_employee_id / decided_at — who decided and when, as an
--     EMPLOYEE uuid. The pre-existing `approved_by` is a users.id FK, and
--     portal managers authenticate through os_users (whose id is TEXT) and so
--     resolve to the system sentinel user — meaning approved_by cannot
--     identify the actual person. This column can. SET NULL on employee delete
--     so a departing manager never blocks anything.
--
-- (3) is_paid — the stored paid/unpaid decision. Until now paid-vs-unpaid was
--     re-derived from `kind` in three mutually inconsistent places, so a
--     manager could not approve (say) a casual leave AS unpaid, and the
--     employee could never be told which they got. NULL = undecided / legacy;
--     the reader falls back to deriving from kind.
--
--     NOTE: this is a RECORD of the decision only. It deliberately does not
--     feed payroll — salary proration docks days explicitly marked 'absent' in
--     attendance_records, and this migration does not change that.
ALTER TABLE "leaves" ADD COLUMN "manager_note" text;
ALTER TABLE "leaves" ADD COLUMN "decided_at" timestamp with time zone;
ALTER TABLE "leaves" ADD COLUMN "is_paid" boolean;

ALTER TABLE "leaves"
  ADD COLUMN "decided_by_employee_id" uuid
  REFERENCES "employees"("id") ON DELETE SET NULL;

CREATE INDEX "leaves_decided_by_employee_id_idx"
  ON "leaves" ("decided_by_employee_id");

-- The manager queue reads pending leaves for a set of employees, newest first.
CREATE INDEX "leaves_status_from_date_idx" ON "leaves" ("status", "from_date" DESC);
