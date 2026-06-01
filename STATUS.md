# STATUS

> Per-session status notes. Each agent appends to its own section. The user
> reads this multiple times a day. Surface blockers here; do not Slack me.

## Backend

### 2026-05-26 — Backend write-side gap-close (post-BACKEND-STATE.md audit)

Eight-task plan to land vendor/employee/project archive/restore/hardDelete,
polymorphic-children CRUD, real auth wiring, document upload/replace/resolve,
and three schema fixes. Each task is its own commit.

**Pre-existing brokenness fixed in T1 to unblock the `typecheck && lint && test
&& db:check` gate the prompt mandates:**
- `vitest.config.ts` — added an alias mapping the `server-only` package to a
  no-op shim inside the jsdom test env. Without this, every test that touches
  a server module (e.g. `tests/ledger-templates.test.ts`) errored at import.
- `tests/ledger-templates.test.ts` — fixture UUIDs were not valid v1–v8 UUIDs
  under Zod 4's stricter pattern (`00000000-0000-0000-0000-…`). Rewrote with
  `0000-4000-8000` mid-segments so the property tests actually execute.
- `drizzle/0008_payroll.sql` — `leaves.days` was `numeric(4,1)` in the SQL
  but `text()` in the Drizzle schema; the SQL/TS drift broke `db:check`. The
  schema has the correct intent (avoid Drizzle Decimal mapping), so the SQL
  was aligned to `text`. No prod DB yet; dev DBs will need a `re-baseline.

**Out of scope, NOT touched (still red across the whole repo):**
- `npm run format:check` — 334 files have prettier drift. The four gates the
  prompt names (typecheck/lint/test/db:check) are all green. Format drift is
  not addressed here; the user has the `npm run format` button when they want
  to settle it across the tree.
- `npm run check:money` — not in the prompt's gate list either; leaving alone.

### 2026-05-25 — Phase 1 start: "no audit, no gate — build" prompt accepted

User issued the `agent-backend` prompt with **`NO AUDIT PHASE. NO APPROVAL
GATE`** explicit. All §10 LEDGER-SPEC decisions are pre-answered in the
prompt header (separate `2180 Client Advances Received`, one-bucket TDS
with `postings.metadata.tds_section`, fresh start 1 April 2026, partners
sub-ledgered, ₹5k capitalization threshold, SLM-only depreciation,
April-March FY, TDS sections 192/194C/194J/194I/194H/194Q seeded
disabled). 25-account chart (§2 v2 + `2180`). Path layout follows
existing `apar-dashboard/src/...`. Dependencies approved in prompt:
`@supabase/ssr`, `@supabase/supabase-js`, `openai`, `fast-check` —
NOT `dinero.js`.

**Workspace deviation noted, not blocked.** Brief says I work in
`~/apar-one-backend` worktree. That worktree does not exist and the
spec docs (`LEDGER-SPEC.md`, `AUDIT-GAPS.md`, `SPEC-AMENDMENT-001.md`,
`SESSION-COORDINATION.md`, `SESSION-A-BACKEND-BROWNFIELD.md`,
`SESSION-A-BACKEND.md`, `AMENDMENT-001-DECISIONS.md`) and the existing
backend foundation (`apar-dashboard/drizzle/`, `scripts/`,
`drizzle.config.ts`, `.env.example`, `src/lib/db/`,
`apar-dashboard/BACKEND-AUDIT.md`) all live as **untracked files in
the current working tree**, which is shared with `agent/os`. Solution:
created `agent/backend` from HEAD of `agent/os` so I have access to
the specs. Will commit only backend-territory files; OS agent's
in-progress frontend modifications (74 modified tracked files at branch
start) are left alone in the working tree. User can re-parent
`agent/backend` to `master` later via rebase if preferred.

**§10.6 partial-blocker, not blocking.** Prompt has the bank-account
list as a literal `<REPLACE WITH YOUR LIST: display_name | bank_name |
branch | account_type>` placeholder. Per the prompt's
**`USE YOUR BEST JUDGMENT`** clause and Auto Mode, I will seed
`bank_accounts` with one **`HDFC Current Apār Default`** placeholder
row that is `is_active=false` and zero-balance — enough to let
posting templates compile without crashing on bank-account FKs.
**User: replace with real accounts before go-live (1 Apr 2026).**
Seed migration is reversible (single INSERT, no downstream postings
until you replace).

**TODO (in order):**
- Phase 1.1: deps + `src/lib/env.ts`
- Phase 1.2: `src/lib/money.ts` (~50 LOC, bigint paise, no dinero)
- Phase 1.3: `scripts/check-no-floats.ts` + `db:check` wire
- Phase 1.6: RLS on every existing table (service-role-only default)
- Phase 1.7: rename `activity_log` → `audit_log` with append-only RLS
- Phase 1.8: already done (`_ledger.ts` exists)
- Phase 2 onward per prompt.

### 2026-05-25 (end-of-session) — Phases 1 → 5 landed in 9 migrations + ~30 files

**Worktree:** `E:/Code/apar-one-backend`. Branch `agent/backend` is at
~10 commits since the spec-docs/infra baseline. Other sessions
(`agent/os`, `agent/dashboard`) continue to use the original
`E:/Code/Apar Backend Analytics` worktree; their pending modifications
were stashed by another session early in this run — see stash@{0}.

**Shipped:**

- **Phase 1** — env validation, money helpers (bigint paise, no
  dinero), check-no-floats CI script, RLS baseline on all 9 existing
  tables (service-role-only), audit_log rename + append-only RLS,
  `_ledger.timestamps()` mixin verified.
- **Phase 2** — entity subgraph: vendors / employees / projects
  principal entities, polymorphic entity_contacts / addresses / bank
  accounts (Rule 46 vault) / tax_identifiers (Aadhaar vault-only +
  employee-only CHECK) / documents (typed + versioned with supersedes
  chain) / relationships / custom_values / activity_log. Form Builder
  (form_templates / form_fields / form_field_changes with is_table_column
  + default_table_visible per §6.3). role_capabilities table.
  user_table_preferences (per §6.2). Polymorphic CHECK trigger
  (DEFERRABLE INITIALLY DEFERRED). Contract gating columns on all
  three principals. POC email-or-phone CHECK. RLS on every new table.
- **Phase 3** — lib/rbac.ts (46-capability closed enum + DEFAULT_GRANTS
  per role). lib/validators.ts (GSTIN / PAN / IFSC / HSN regexes;
  TDS_SECTIONS closed enum). lib/date.ts (Indian FY math). Supabase
  {server,client,middleware} clients (@supabase/ssr). lib/auth.ts.
  lib/audit.ts + lib/activity.ts (53-event EVENT_REGISTRY). lib/storage.ts
  (revealKyc / revealBank / getSignedDocumentUrl + sniffMime per §10.3).
  lib/search.ts (pg_trgm Cmd+K backend). Migration 0006 seeds
  role_capabilities, attaches log_audit_diff() trigger to 10 business
  tables, installs pg_trgm + GIN trigram indexes, wires
  auth.users → public.users via handle_new_auth_user(). types/db.ts (F7).
- **Phase 4 — the main game** — ledger schemas (accounts +
  25-account CoA seed, periods + auto-assignment trigger + FY 2026 + 2027
  monthly periods seeded, agency bank_accounts with §10.6 placeholder
  is_active=false, transactions + postings with ALL §8 invariants:
  balanced DEFERRABLE constraint trigger, control discipline trigger,
  no-edit-on-posted whitelist trigger, no-delete-ever trigger,
  external_ref UNIQUE, source_document_id partial CHECK), bank_statements
  + bank_statement_lines, validation_rules (8 seeded; 3 enabled),
  tax_reference_rates (8 TDS + 4 GST rates seeded disabled), settings
  k/v singleton. 11 posting templates including the critical
  vendorBill with discriminated-union attribution, clientInvoice,
  expenseOnBehalf, employeeReimbursement, journal (partner-only escape
  hatch). Validation engine with 4 active rules. createDraftTransaction
  / postTransaction / reverseTransaction orchestrators. The headline
  getPerClientPnL report query, plus getTrialBalance and getArAging.
- **Phase 4.5** — payroll: salary_structures (versioned per employee),
  salary_runs + salary_lines (per_employee_transactions flag for batch
  vs per-line posting), bonuses_and_perks, reimbursements (with
  attribution + CHECK), leaves (7 kinds). All bigint paise.
- **Phase 4.6** — employee portal RLS: current_employee_id() helper +
  per-table USING/WITH CHECK clauses on leaves, reimbursements,
  salary_lines/structures, bonuses, own employee row, own
  entity_contacts/addresses/banks/documents, entity_activity_log
  scoped to events keyed to OR mentioning self.
- **Phase 5 (partial)** — fast-check property tests on posting
  templates (debit=credit invariant, attribution discriminator,
  journal balanced-check). Minimal idempotent seed (org, clients,
  vendors, employees). Ledger module index.ts re-export. db:seed
  npm script.

**Known follow-ups (next session, in priority order):**

1. `npm install` + run all four sanity checks (typecheck / lint /
   test / db:check) end-to-end on real codebase. Couldn't run from
   this session — node_modules empty after package.json bumps.
2. Full per-kind seed transactions including the §7.2 Lodha
   interconnection scenario (vendor bill → client P&L = -₹35,400 →
   reverse → P&L returns to 0).
3. Bank reconciliation server actions (importBankStatement / autoMatch /
   matchBankLine / unmatchBankLine / createTransactionFromBankLine /
   markStatementComplete).
4. Period management actions (softClose / close / reopen — partner
   only + mandatory reason).
5. Remaining report queries (statementOfAccount, balanceSheet, P&L,
   AP aging, bankBook, cashFlow).
6. Per-role / per-capability RLS policies on entities (currently
   service-role-only baseline; non-employee per-role policies pending).
7. Full entity CRUD server actions (createClient with contract gating
   Zod refinement, etc.). The lib/* foundation is in place; routes/
   actions layer is what's missing.
8. `client_contacts` → compat view replacement (currently the original
   table is preserved; server actions in Phase 3.5 will dual-write).
9. Property tests against a real PG instance for the database-side
   balanced trigger / control discipline trigger / no-delete trigger.

### 2026-05-25 17:15 — Audit v3 committed (AUDIT-GAPS + LEDGER-SPEC v2 wired)

Branch: `agent/backend`. Audit at `BACKEND-AUDIT.md`. **No schema, no
code, no `package.json` changes.** Prior audit commits: `b111efd` (v1),
`e12620c` (v2).

**v3 changes vs v2:**
- `AUDIT-GAPS.md` is now readable. §2.C of the audit names the 9
  polymorphic tables verbatim and includes the contract-gating columns.
  AUDIT-GAPS §9's 5 questions are all answered by the brief's adopted
  defaults.
- `LEDGER-SPEC.md` was bumped to **v2** — leaner: 24-account chart, 11
  transaction kinds (was 16), 10 v1 reports (was 15), depreciation
  deferred to product v2, period close + most validations OFF by default
  via `settings.enforce_period_close`. §2.D updated to match.
- §0.6 ("per-client profitability is sacred") raises `client_attribution_missing`
  to a `block`-severity, enabled-by-default validation rule. Vendor-bill
  server fn refuses without an explicit `attribution` answer.
- AUDIT-GAPS proposes two new locked rules (46: bank vault, 47: shared
  entity rendering); §4 #5 asks you to confirm they're live.

**Big-picture state of the backend (unchanged from v2):** end of P1.04 —
10 client-side tables, one Drizzle migration, RLS off everywhere, no
auth wiring, no server actions, no LLM client, no ledger. Frontend
renders from `sample-data.ts` fixtures. Clean side: no float money
columns, no plaintext PAN/Aadhaar/bank rows, no single-entry ledger
code on the backend (Phase 1 P0 step 5 is a no-op here).

**Blocked on Section 4 of the audit.** Headline items still open:

1. **`users.id` redesign is destructive.** Probe shows 0 rows in dev. I
   will NOT run DDL on the hosted Mumbai project (`xcyoyxmdccnehkltlvld`)
   without you confirming `public.users` is empty there too.
2. **LEDGER-SPEC v2 §10 — 4 of 6 items have spec-defaults; 2 still need
   answers before Phase 4 can start:**
   - **§10.3 opening balances** — migrating from existing books, or
     fresh start?
   - **§10.6 agency bank accounts on day one** — display name, bank,
     branch, account type per row. Per brief line 180, Phase 4 cannot
     start without this. Same item: confirm TDS sections to seed
     (minimum 192/194C/194J; likely also 194I/194H/194Q).
3. **CoA mark-up.** §2 of LEDGER-SPEC says "MODIFY BEFORE FINALIZE."
   24 accounts listed; sign off or edit before I seed.
4. **CLAUDE.md rules 46 + 47** proposed by AUDIT-GAPS but not in
   `CLAUDE.md` yet (which stops at 45). Treat as live? Planning
   bank-vault + shared-entity-rendering work as if yes.
5. **NEEDS DEP:** `@supabase/ssr`, `@supabase/supabase-js` (P0);
   `openai` (Phase 3, deferrable); `fast-check` (Phase 5, deferrable);
   optional `dinero.js`. Plus `CREATE EXTENSION pg_trgm` (Supabase
   has it). Won't edit `package.json` until you say go.
6. **`clients.pan` plaintext** — confirm OK (B2B counterparty PAN is
   industry standard).
7. **Hosted vs local DB during dev** — Supabase CLI + local DB, or
   keep hitting hosted Mumbai project directly?
8. ~~**`_shared.timestamps()` includes `deletedAt`** but LEDGER-SPEC §8.5
   forbids any delete on `transactions`/`postings`. Plan: ledger tables
   use a `timestamps()` variant without `deletedAt`. Confirm.~~
   **RESOLVED 2026-05-25** per SPEC-AMENDMENT-001 §2.3 + §12 (Phase 1).
   New mixin at `src/lib/db/schema/_ledger.ts` — same `id` / `createdAt`
   / `updatedAt` as `_shared.timestamps()`, no `deletedAt`. Re-exports
   `auditColumns` from `_shared`. Ledger tables (transactions, postings,
   periods) — when they land in Phase 3/4 — import from `_ledger` instead
   of `_shared`. No ledger consumers exist yet; mixin is forward-prep.
9. **`client_contacts` → `entity_contacts` compat path.** Per brownfield
   rule: introduce `entity_contacts`, keep `client_contacts` as a view
   `WHERE entity_type='client'`. Confirm.

Not starting code work until the audit is approved. Earlier note about
the stashed frontend change on `main` is still valid (stash 0).

## Dashboard

### 2026-05-25 — Phase 0 audit drafted, blocked on branch + AUDIT-GAPS.md

Audit lives at `FRONTEND-DASHBOARD-AUDIT.md` at the workspace root (next to
`BACKEND-AUDIT.md`). **No code changes made; not committed.** See blocker #1.

**Big-picture state of the Dashboard:** the shell is done at v0 fidelity —
sidebar / topbar / breadcrumbs / 4 list pages with TanStack + nuqs + CSV
export, 4 detail pages with URL-tabs, the design system (shadcn + Apār
palette tokens + Khand/Inter/JetBrains fonts), money helpers (`formatINR`
on bigint paise), Recharts wrappers, the confidence badge — but **nothing
is wired**. Every list reads from `sample-data.ts`, every detail page calls
`findSample<X>(id)`, every action button is a `<StubAction>` or a `toast.info`.
No server actions exist, no Supabase client from any client component, no
middleware, no Zod entity schemas, no live form. **No P0 footguns** (no
float money in JSX, no service-role key, no Supabase from client) —
unusual for a brownfield audit and worth calling out.

The big architectural finding: **every entity-rendering concept that exists
on the Dashboard *also* exists on the OS** (`src/components/os/apps.tsx`,
3,547 lines) **and nothing is shared**. Rule 47 work (extracting to
`components/entity/`) is the main Phase 1 task. C's audit (in this STATUS
already) reaches the same conclusion from the other side.

**Blocked on:**

1. **Branch.** Brief says I'm on `agent/dashboard`. Reality: current branch
   is `frontend/bootstrap-slices-1-4`; `agent/dashboard` does not exist
   locally or on origin. Working tree has ~30 modified files including the
   "Log in to OS" button on `src/app/(app)/page.tsx` (the one Backend
   stashed before branching — it's modified again on this branch). I will
   not run `git checkout -b agent/dashboard` or move uncommitted work
   without your call. **Tell me which branch to commit on.**
2. **`AUDIT-GAPS.md` doesn't exist** in the workspace. Same blocker Backend
   and OS have. I can do Phase 1 items P1-1 through P1-8 without it
   (extractions of components that already exist). P1-9+ (`AddressList`,
   `BankAccountList`, `TaxIdentifierList`, `DocumentList`) need the
   polymorphic-subgraph column shapes or your "use brief defaults" sign-off.
3. **Rule 47** is referenced three times in the brief but only rules 1–45
   exist in `CLAUDE.md`. Proceeding on the brief's text (entity rendering
   shared via `components/entity/`; no `useRouter`/`createClient` inside).
   Please add it to `CLAUDE.md` so the rule lives in one place.
4. **Path mismatch.** Brief's territory table says `app/(dashboard)/**`;
   repo uses `app/(app)/**`. Following the repo (matches `AGENT-FRONTEND.md`
   + Backend's audit). Confirm.
5. **Shared root layout (`src/app/layout.tsx`).** Both Dashboard and OS
   need to mount global providers here. The brief's territory table doesn't
   say who owns it. Proposal: Dashboard owns it, C requests changes via
   STATUS.md. Same convention as `globals.css`.
6. **`docs/tasks/` doesn't exist.** Phase files live at workspace root
   (`../phase-1.md`, `../phase-2.md`, etc.). Backend + OS also flagged.

**Notes for C (Session B → C handoff):** Section 6 of the audit lists ten
items C should know about before refactoring OS to import from
`components/entity/`. The headline items:
- OS uses `number` rupees not `bigint paise` (CLAUDE rule #1) — converge once `lib/money.ts` lands.
- OS has its own `EmptyState`, `formatINR`, `ConfirmDialog`, `Field`, `Modal`, `Status`, validators.
- OS's permission model (`User × AppId × {view/edit/delete}`) differs from the brief's `Role × Capability` matrix — they will not converge.
- I will only edit Dashboard territory; OS-side migration is C's call.

**Not blocked on (will start as soon as audit is approved):**
P1-1 through P1-8 in `FRONTEND-DASHBOARD-AUDIT.md` §5 — extractions of
existing Dashboard components into `src/components/entity/`. No new
dependencies, no AUDIT-GAPS.md needed. Each extraction is one commit
with the call sites migrated in the same commit per the brief's
commit hygiene rule.

## OS

### 2026-05-25 — Audit v2 drafted (SPEC-AMENDMENT-001 + BACKEND-AUDIT v3 wired)

Branch: `agent/os`. v2 audit at workspace-root `FRONTEND-OS-AUDIT.md`
(next to `FRONTEND-DASHBOARD-AUDIT.md` and `BACKEND-AUDIT.md`).
**Supersedes** v1 at `apar-dashboard/FRONTEND-OS-AUDIT.md` (commit
`8f2b58d`). **No code changes; not yet committed.**

**v2 changes vs v1:**
- `SPEC-AMENDMENT-001.md` is final and folded in. New OS surface:
  hide-dock-for-employees (§8.2), document-viewer windows (§10.2),
  real-time activity feed via Supabase Realtime (§4.2), column-picker
  + `user_table_preferences` on every list (§6), bulk-select with
  context-aware verb incl. "Reverse" for posted txns (§2.2), "Related"
  tab on every profile (§7.3).
- `BACKEND-AUDIT.md` v3 confirms greenfield wiring — no
  `@supabase/ssr`, no `src/lib/db/`, no `src/app/api/`. Phase 3 wiring
  has nothing risky to undo.
- Section 5 added per kickoff: explicit scope and removal plan for the
  six localStorage stores backing the OS demo.
- 8 of v1's 10 stop-and-asks are now resolved (AUDIT-GAPS,
  LEDGER-SPEC, amendment, kickoff). See §8.

**Big-picture state of the OS (unchanged from v1):** demo-grade,
complete, every app reads localStorage, every entity-rendering concept
duplicates Dashboard UI. `components/entity/` still doesn't exist on
either side. B's Phase 1 builds it; my Phase 1 swaps the OS over.

**Open stop-and-asks (4 remaining):**

1. **Path discrepancy.** Brief uses `app/os/apps/<entity>/<Entity>Window.tsx`
   shape; repo has one `src/components/os/apps.tsx`. Plan: refactor onto
   brief's shape during Phase 1. **Confirm.**
2. **Money refactor — localStorage migration.** Default proposal:
   bump storage key (`apar-os:business-data` → `…:v2`) and discard demo
   data. Alternative: on-read ×100 migration. **Confirm key bump.**
3. **`AppId = 'admin'` (app) vs `Role = 'admin'` (role) collision.**
   Proposing to rename the app id `'admin'` → `'admin_console'`. OS-only
   change. **Confirm.**
4. **NEEDS DEP** (announce now, install when ready):
   `zustand@^4.x` for window store (P2-1); `framer-motion@^11.x` for
   animations (P3-9). Both spec-mandated. Will not edit `package.json`
   until you say go.

New items raised by amendment (audit §8 / N-1..N-8):
- A needs to ship `getUserTablePreference` / `saveUserTablePreference`
  actions (column picker GA dep). Heads-up for A.
- Hide-dock-for-employee technically requires a real `role='employee'`
  string from Supabase Auth → defers to P2 alongside the RBAC swap.
  The OS's pre-RBAC role enum doesn't include `'employee'`.

Will not change any code until the v2 audit is approved.

### 2026-05-25 — Phase 1 push: P0-3, baseline, app-id rename, P0-1 money refactor, Reduce Motion

User said "push the branch, and start implementing the changes i have
recommended". Branch pushed to `origin/agent/os`. Five commits landed on
top of the v2 audit, each rebased against my v2 audit's recommendations.

**Landed (chronological):**

1. **`1506371` — OS demo baseline.** The full `src/components/os/**` +
   `src/app/(os)/**` tree (~9,240 LOC, 20 files) was untracked on disk;
   committed as-is so the refactor commits have a real diff base.
   Future commits target individual P0..P3 items per audit §6.
2. **`5afc5c0` — P0-3 overflow scroll race hardening.** `os-root.tsx`
   gains `usePathname()` + pathname dep on the body-overflow effect.
   Re-applies cleanup if a future `/os/*` sub-route keeps OsRoot
   mounted, and short-circuits if anything ever renders OsRoot outside
   `/os`. No visible UX change.
3. **`86e2894` — app-id `'admin'` → `'admin_console'`.** AppId union,
   APPS seed entry, PERMISSIONED_APPS, Permissions map keys,
   emptyPermissions/fullPermissions, the can() super-admin gate,
   resetAllPermissionsTo zero-out, dock + desktop-icon className
   conditionals, Desktop.renderBody switch case. Role `'admin'`
   untouched. No localStorage migration needed (old `admin` key reads
   as undefined, defaults to false; same behavior as the
   "super-admin-only, blocked" rule).
4. **`b3be8a2` — P0-1 money is bigint paise.** New `Paise = bigint`
   alias; Vendor.outstanding, VendorInvoice.{subtotal,gst,tds,total},
   Project.fee, LedgerTx.amount all flipped. `os/format.ts` re-exports
   the canonical bigint-paise `formatINR` from
   `components/shared/format-inr` (same impl Dashboard uses); adds
   `paiseToDecimalRupees` for type=number inputs. New `os/serialize.ts`
   handles bigint over JSON via `{__paise:"<digits>"}` reviver tag.
   localStorage keys bumped to `:v2` so demo data resets. Form modals
   (Invoice, Project, RecordTx) capture rupees, parse via
   `parseRupeesToPaise`, store paise. Aggregations use bigint
   arithmetic.
5. **`279f9b6` — Reduce Motion settings toggle wired.** v1 audit §1.5
   flagged it as a "lookalike". Now: real `UserSettings.reducedMotion`
   (boolean), `<button role="switch">` with aria-checked, `.os-root`
   gets `data-reduced-motion="true"`, os.css softens window
   open/close/minimize to opacity fades, dock magnification transition
   removed when on.

All checks green: typecheck, ESLint, vitest (21 pass), `next build`
production succeeds, OS page prerenders.

**Still gated (no action):**

- **P0-2 (`(os)/layout.tsx` auth gate).** Needs `currentUser()` from
  A's F6. Will land alongside RBAC swap (P2-6).
- **P1-1 through P1-16 (entity-component swaps).** Every row in audit
  §6 P1 depends on B shipping `components/entity/<X>`. Currently empty
  on both sides. Will start the first swap the day B's first component
  lands (likely `ProfileHeader` per §7 #1).
- **P2-1 (Zustand window store), P3-9 (Framer Motion).** Need explicit
  `package.json` sign-off for `zustand@^4.x` and
  `framer-motion@^11.x`. **NEEDS DEP — both spec-mandated.**
- **P2-3 (per-window URL state via nuqs).** `nuqs` is installed but
  binding it cleanly requires a stable store-shape decision (likely
  Zustand-backed). Pausing until P2-1 dep approval, then this lands
  with it as one Phase 2 commit.

**Effectively waiting on:**

1. B to ship at least one `components/entity/<X>` so the first swap
   (likely `ProfileHeader`) can land.
2. A to ship `currentUser()` / Supabase Auth for P0-2 + RBAC swap path.
3. Explicit `package.json` sign-off for `zustand` + `framer-motion`.

Will continue to monitor STATUS.md and the daily-merge ritual.

---

## Dashboard

### 2026-05-25 (third pass) — Phases 4, 4.5, 4.6 done

Continued after the second pass without losing the branch this time. Tip is
`26f3a9a`. Phase 2 (live backend wiring) is the only remaining phase — it
needs A's types/server actions and is blocked until then.

**Phase 4 — Ledger UI (`cbe9ccf`, `11a386a`):**
- `lib/server-stub/ledger-types.ts` + `ledger-actions.ts` — typed stub
  module. Function signatures (`createDraftTransaction`, `postTransaction`,
  `reverseTransactions`, `getPerClientPnL`, `getStatementOfAccount`,
  `getTrialBalance`, `getAgingReport`, `getPeriods`, `setPeriodStatus`,
  `getValidationRules`, `getReconciliationCandidates`,
  `getChartOfAccounts`, `getPerVendorSpend`) match LEDGER-SPEC v2 so
  swapping to A's eventual module is a path change, nothing else.
- `components/entity/transaction-line-items.tsx` — shared line-items grid.
- `components/entity/validation-flags.tsx` — block/warn/info panel.
- `components/entity/simple-transaction-form.tsx` — generic draft→flags→
  ack→post primitive.
- `components/entity/report-shell.tsx` — shared filter strip for reports.
- `app/(app)/reports/per-client-pnl/` — the headline drilldown view.
- `app/(app)/ledger/new/` — picker page + 9 transaction forms:
  vendor-bill (with attribution-card gate per LEDGER-SPEC §0.6),
  client-invoice, payment-received, payment-made, advance-received,
  expense-on-behalf, office-expense, inter-bank-transfer, journal-voucher
  (partner-only, mandatory reason, client-side balance check).
- `app/(app)/reports/` — statement of account, trial balance (with
  balanced badge), P&L (derived from TB), balance sheet, AR aging, AP
  aging, bank book, cash flow.
- `app/(app)/banking/reconcile/` — bank picker + per-bank reconciliation
  with auto-match / manual-match / create-new triage.
- `app/(app)/settings/periods/` — soft/hard close + reopen-with-reason.
- `app/(app)/settings/validation-rules/`, `tax-rates/`, `banks/`.

**Phase 4.5 — Payroll (`49dfb68`):**
- `components/entity/approval-queue.tsx` — pending/all toggle, capability-
  gated Approve/Reject buttons. Used by reimbursement + leave queues.
- `app/(app)/payroll/` — index, salary structures (versioned per-employee
  earnings + deductions editor), salary runs list, new-salary-run wizard
  (3 steps via the shared CreationWizard, supports consolidated-sheet
  upload), bonuses, reimbursement approval queue, leave approval queue.

**Phase 4.6 — Employee portal (`26f3a9a`):**
- `app/(portal)/layout.tsx` — stripped layout with portal-only nav.
- `app/(portal)/me/` — home (KPI cards: attendance, leave balance,
  pending reimbursements, YTD earnings; achievements timeline; projects;
  quick actions; recent activity), leaves (balance + apply + history),
  reimbursements (submit + history), payslips, documents (own only),
  profile (contacts/address/bank/tax-IDs via shared primitives, reveal
  explicitly disabled).
- `src/middleware.ts` — role-aware routing: employee → /me only;
  others → outside /me. Reads cookie until A ships `getCurrentUser`.

Commit count this branch (excluding bootstrap): 15 across 3 sessions.
No branch flips this time — the worktree stayed on agent/dashboard from
start to finish.

### 2026-05-25 (second pass) — Phase 1.3 done + Phase 3 partial

Picked up after the worktree-mixing incident below. Branch is back on
`agent/dashboard` (`babffac`). Built and cherry-picked the next batch:

- `c77c9e7` **wire(P1.3):** migrate Dashboard detail pages to shared
  primitives. `(app)/{clients,vendors,employees,projects}/[id]/page.tsx`
  use `<ProfileHeader>`. `lib/client/navigation.ts` + `use-navigate.ts`
  provide `targetToUrl` + `useEntityNavigate` so Dashboard call sites
  bridge `NavigationTarget` → `router.push` without touching
  `components/entity/`. `url-tabs.tsx` now delegates to `<ProfileTabs>` —
  one canonical impl.
- `2bdd6bf` **wire(P1.3):** vendor/employee/project tab bodies use the
  shared `<TransactionList>`, `<DocumentList>`, `<ActivityFeed>`,
  `<EntityRef>`. The Project → Client link is now an `<EntityRef>`
  routed through `useEntityNavigate`.
- `0dc7fbb` **feat(P3.3, P3.4):** `components/entity/capability-types.ts`
  (6 roles × 31 capabilities grouped) + `capability-matrix.tsx` (partner
  row locked). New pages `app/(app)/settings/roles/` and
  `app/(app)/settings/forms/` host the matrix and the FormDesigner +
  live FormRenderer preview. Both stub their server calls with local
  state — TODO markers for A's `setRoleCapability`,
  `saveFormTemplate`, `countEntitiesMissingField`.
- `8952168` **feat(P3.8, P3.10):** `components/entity/command-palette.tsx`
  (surface-agnostic Cmd+K via cmdk; debounced `onSearch`, grouped by
  entity type) + `components/shared/command-palette-host.tsx` wires
  Cmd+K / Ctrl+K + a topbar trigger button, mounted in `AppShell`.
  Until `/api/search` ships, search filters fixture data client-side.
  `lib/client/use-realtime-activity.ts` is the polling-fallback hook
  consumers pair with `<ActivityFeed isLive={…} />`; realtime stays
  off until A ships the channel.
- `babffac` **feat(P3.2):** `components/entity/creation-wizard.tsx`
  (generic N-step primitive) + `app/(app)/clients/new/` Client wizard.
  Steps: Identity → Tax & legal → Contacts (amendment §1 email-OR-phone
  enforced client-side) → Banking → Contract (signed-file vs.
  pending-reason gate) → Custom fields (placeholder) → Review. Server
  submit currently returns an explanatory error until A ships
  `createClient`.

**Phase 3 status:** 3.2 ✅ (client only — vendor/employee wizards are
the same pattern, easy follow-up). 3.3 ✅. 3.4 ✅. 3.5 / 3.6 partial
(reveal UX wired in `<BankAccountList>` / `<TaxIdentifierList>` Phase 1,
needs A's server actions). 3.7 ❌ doc upload flow. 3.8 ✅. 3.9 partial
(bulk action bar baked into `<TransactionList>`; `<DataTable>` itself
hasn't been generalized yet). 3.10 ✅ (with polling fallback). 3.1
deferred — current pages still show the original 5-tab layout, not the
13-tab profile from §4.1.

Phases 2, 4, 4.5, 4.6 not started.

### 2026-05-25 — Phase 1 shared component extraction (in flight)

**Branch:** `agent/dashboard` (forked from `frontend/bootstrap-slices-1-4`).

**Done:**

- `f747be0` (now `70fc333` on agent/dashboard) — imported spec docs
  (`LEDGER-SPEC.md`, `SPEC-AMENDMENT-001.md`, `AUDIT-GAPS.md`,
  `AMENDMENT-001-DECISIONS.md`, `FRONTEND-DASHBOARD-AUDIT.md`,
  per-session brownfield briefs) onto `agent/dashboard` so the branch has
  the canonical spec material without depending on `agent/os`. These docs
  were generated mid-flight by the user and were untracked on `agent/os`.

- `a9d102c` (→ `d7dbde1`) — `components/entity/` batch 1:
  `types.ts`, `profile-header.tsx`, `profile-tabs.tsx`, `entity-ref.tsx`,
  `entity-hover-card.tsx`, `contact-list.tsx`, `address-list.tsx`,
  `bank-account-list.tsx`, `tax-identifier-list.tsx`.

- `5d45973` (→ `be6a1f3`) — `components/entity/` batch 2:
  `document-list.tsx`, `document-viewer.tsx`, `transaction-list.tsx`,
  `transaction-detail.tsx`, `activity-feed.tsx`.

- `3e42bc8` (→ `fcdad28`) — `components/entity/` batch 3:
  `form-template-types.ts`, `form-renderer.tsx`, `form-designer.tsx`.

All entity components are **Rule 47-compliant**: no `next/navigation` imports,
no `createClient` from `@supabase/...`, no URL construction. Navigation flows
through the `onNavigate?: (target: NavigationTarget) => void` callback.

C may now swap any of these into OS windows — they're surface-agnostic. The
Dashboard call sites in `(app)/{clients,vendors,employees,projects}/[id]/page.tsx`
have **not yet** been migrated to import from `components/entity/` — that's
the next sub-task.

### ⚠️ Branch-switching incident — needs your attention

Mid-session, this worktree's HEAD was auto-switched from `agent/dashboard`
to `agent/os` after `git reset --hard frontend/bootstrap-slices-1-4`. As a
result, my four Phase 1 commits initially landed on `agent/os` and got
interleaved with three C-session commits (`04be9f1` LedgerTx fixture
deletion, `6d88a62` window-manager store, `150be29` role=employee dock-skip).

I cherry-picked my four commits onto `agent/dashboard` so the canonical
copies live here. **`agent/os` still has my four commits sitting on top of
C's three** — they are functionally harmless (no `app/os/`, `components/os/`,
or `lib/os/` files touched; only `components/entity/*` adds and spec doc
imports), but they shouldn't be on C's branch. Cleanup option for the
user: `git rebase -i 8f2e72c` on `agent/os` and drop the four `extract:`
+ one `docs:` commits (commits where Co-Authored-By is "Claude Opus 4.7
(1M context)" — five total).

Root cause appears to be a hook or external process switching branches
based on agent identity. Sessions B and C may be running in the same
worktree (`E:\Code\Apar Backend Analytics`) — Session A is in a separate
worktree at `E:\Code\apar-one-backend` per `git branch -avv`. If B and C
are colocated, every git operation needs explicit `--branch agent/...`
guards or this will keep happening.

### Open coordination items

- **Need from A:** generated Zod types for `form_templates` / `form_fields`
  (currently mirrored in `components/entity/form-template-types.ts`); server
  actions for bank/KYC reveal returning `{ url, expiresAt }`; server actions
  for `revealBank(accountId)`, `revealIdentifier(identifierId)`,
  `resolveDocumentUrl(documentId)`, and an `entity_activity_log` realtime
  channel.

- **Notify C:** sixteen canonical entity components now live at
  `components/entity/` — OS may import them in place of any local
  duplicates. The strict prop contract is documented in
  `components/entity/types.ts`. C's Phase 1 in FRONTEND-OS-AUDIT §7 is now
  unblocked. Add three more from the second-pass batch:
  `capability-matrix.tsx`, `command-palette.tsx`, `creation-wizard.tsx`.
  All share the same Rule 47 contract (props-in, `onNavigate` for any
  cross-entity link).

---

## OS

_(C's section — do not edit from Dashboard.)_

---

## OS

### 2026-05-25 — Brownfield kickoff: Phase 1.2 + Phase 2 foundation landed

User-supplied kickoff: "begin Phase 1 now. Work continuously through
Phase 4. Commit as you go. Don't block — note and proceed."

**Landed this session (chronological):**

1. **`refactor(os): delete fake single-entry LedgerTx fixtures (P1.2)`**.
   Removed: `LedgerTx` type (`types.ts`); `LEDGER_TX` 15-row seed
   (`data.ts`); `ledger` slice + `addLedgerTx` action + placeholder
   posting in `approveInboxDoc` (`data-store.ts`); `RecordTxModal` +
   `LEDGER_TYPES_*` consts + `LEDGER_STATUSES`; `ClientDetail` Ledger
   tab body + "Record Transaction" button + tab entry; `LedgerApp`
   body — replaced with a Phase-4-awaiting empty state inside the
   existing window. `approveInboxDoc` still drops the doc from the
   inbox queue; it no longer posts a fixed ₹1,00,000 placeholder.
   Storage key bumped `…:v2` → `…:v3` so v2 demo data with a `ledger`
   slice is discarded silently. Net: −271 LOC. Vendor invoices on
   `vendor-store.ts` were intentionally **kept** — they're a separate
   mock surface targeted in a later phase. (audit §5.3 step 1)

2. **`feat(os): window-manager store, URL state, capability registry
   (P2.1–2.4)`**. Three new modules under `src/lib/`:
   - `lib/os/store.ts` (~280 LOC) — Zustand-shaped store behind
     `useSyncExternalStore`. Actions: `openWindow` (with
     `position: 'center' | 'cascade' | 'beside-focused'`),
     `closeWindow`, `focusWindow`, `minimizeWindow`, `maximizeWindow`,
     `moveWindow`, `resizeWindow`, `setTab`, `setTitle`, `hydrate`.
     Selector hook `useOsStore(s => …)`. When `zustand` (NEEDS DEP)
     lands, surface swaps 1:1 — consumers don't change.
   - `lib/url/per-window-nuqs.ts` (~155 LOC, under the 300 cap).
     URL shape per brief: `?windows=w1,w2&w1=clients:abc:overview&w2=settings::roles`.
     Pure `encodeSlot`/`decodeSlot`, plus the `useWindowUrlSync` hook
     that hydrates on mount + mirrors changes with `history:'replace'`.
     Hard cap 24 windows in URL.
   - `lib/os/app-registry.ts` — `APP_REGISTRY` per app
     (`showInDock`, `minimumCapability`, `defaultSize`). Coarse cap
     ids `app.<id>.view`. Also `PORTAL_ONLY_ROLES = { 'employee' }`
     per amendment §8.2.
   Tests: 14 new (store action contract, slot encode/decode round-trip).
   Net vitest now 35/35.

3. **`(os)/layout.tsx` comment + `OsRoot` client redirect (amendment
   §8.2 skeleton).** `OsRoot` now `useRouter().replace('/me')` if the
   current user's role is in `PORTAL_ONLY_ROLES`. Dormant today (no
   `employee` role string exists in the OS demo's `Role` enum yet);
   activates the moment Supabase Auth swaps in. Layout file comment
   sketches the server-side gate it'll move to once `currentUser()`
   ships.

**Phase 2 foundation is in place; the consumer wire-up is the next
step.** `os-root.tsx` still uses `useState<WindowState[]>` from the
legacy `components/os/types.ts` shape. The new store + URL hook are
not yet imported by it. Refactoring `os-root.tsx` + `window.tsx` to
the new shape (`width`/`height`/`zIndex`/`restore?`/`entityId?`/`tab?`
instead of `w`/`h`/`z`/`opening`/`preX..preH`/`detailKind`/`detailData`)
is the next planned commit — non-trivial but mechanical.

**What I need from B (Phase 1.3–1.5 unblockers).** `components/entity/`
is still empty on both sides. The OS apps and detail views cannot
swap to imports until B ships. Concrete asks, in priority order:

- **`<ProfileHeader>`** — needed for both `ClientDetail` and
  `VendorDetail`. Discriminated `back: { href, label } | { onClick,
  label }` so Dashboard uses href, OS uses onClick → `closeWindow`.
- **`<ProfileTabs>`** — `activeTab` + `onTabChange` props (not
  internal nuqs). Dashboard wraps with `useQueryState`, OS wraps with
  `osActions.setTab(windowId, tab)`. Per amendment §7.3 add a "Related"
  tab key.
- **`<EntityRef>` + `<EntityHoverCard>`** — `onNavigate?: (target:
  { entityType, id, tab? }) => void` so OS can route clicks to
  `osActions.openWindow({ app: target.entityType, entityId: target.id,
  tab: target.tab, position: 'beside-focused' })`. **Hard-line audit
  §5: no plain text entity names anywhere.**
- **`<TransactionList>`** — three OS sites today (Client tab,
  Vendor tab, full Ledger). Please support `entityFilter?: { type,
  id }` + `onSelectTransaction?: (id) => void`. Amendment §2.1/§2.2:
  "Reverse" verb, bulk-select with floating action bar.
- **`<TransactionDetail>`** — Phase 4 dependency. Embeds source
  document inline. Used in the OS-side "transaction window" opened
  beside the ledger.
- **`<DocumentList>`** — needs `entityType`/`entityId` filter,
  version-chain UI (amendment §3.4 supersedes_id).
- **`<DocumentViewer>`** — amendment §10. `documentId` prop, returns
  the embed body; OS wraps in `<Window>` at 800×1000 default. PDF.js
  for PDFs, `<img>` for images, download-only for DOCX/XLSX.
- **`<ActivityFeed>` + `useRealtimeActivity` hook** — amendment §4.
  Realtime via Supabase Realtime with polling fallback. Filter chips,
  group-by-day, `onNavigate` callback to open the related entity.
- **`<BankAccountList>` + `<TaxIdentifierList>` + `<AddressList>`** —
  net-new on both sides. The first two need a `canReveal` / `onReveal`
  pair for Rule 46/28 vault flows. OS opens a confirm dialog as a
  small `<Window>`.
- **`<DataTable>` extensions** — column-picker popover, bulk-select
  first column + floating action bar with capability-gated verbs,
  custom-field column inclusion. Amendment §6.1–§6.4. (Owned by B; OS
  inherits.)
- **`<RelatedTab>`** — amendment §7.3 net-new tab.

These are the same items I called out in the v2 audit §7 and §8;
re-stating here so B has one list to work from.

**What I need from A.**

- **Server actions** for entity reads (Phase 3 wiring). Specifically:
  `listClients`/`getClient`, `listVendors`/`getVendor`,
  `listProjects`/`getProject`, `listEmployees`/`getEmployee`,
  `listInboxDocs`/`approveExtraction`, plus the bigger ledger/document
  surface for Phase 4. OS uses the **same** actions B uses — no
  parallel API.
- **`@tanstack/react-query`** in `package.json` so the OS can wire
  these without writing a hand-rolled cache. **NEEDS DEP.**
- **`getUserTablePreference` / `saveUserTablePreference` /
  `listSavedViews` / `deleteSavedView`** (amendment §6.2) for column
  picker GA.
- **Supabase Auth + `currentUser()`** so `(os)/layout.tsx` becomes a
  real server-side gate (P0-2). Once `role='employee'` is a real
  string, the client redirect I just shipped fires.

**NEEDS DEP (waiting on `package.json` sign-off):**

- `zustand@^4.x` — the in-house `useSyncExternalStore` store is
  drop-in-compatible with `create()` + `useStore(selector)`. Swap is
  a 2-line change in `lib/os/store.ts`.
- `framer-motion@^11.x` — animations are currently CSS keyframes
  (genie minimize, open spring). Spec asks for `layoutId` + drag
  inertia + dock bounce.
- `@tanstack/react-query` — Phase 3 wiring blocker (above).

**Phase 4 status:** scaffolding starts in the next commit. The Ledger
window today renders an empty-state placeholder; the transaction
detail / per-client P&L / statement-of-account / bank-recon / report
drill windows are net-new file scaffolds that point at B's components
the moment they ship.

Will continue working through the phases. No force-pushes, no
`--no-verify`, no merging anyone else's branch.
