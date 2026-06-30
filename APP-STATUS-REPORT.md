# Apar — Full App Status Report (OS + Dashboard)

_Generated from a static audit of the codebase (branch `feat/client-vendor-payments` @ `afcaf77`) by four specialised agents, plus live runtime verification against the deployed app + the branch preview, using the production database. Dummy data was created and fully deleted (see Attestation)._

---

## 0. Method, environment & test attestation

- **No local DB in this repo** → runtime testing runs against the **production Supabase DB** (service-role REST) and the deployed apps.
- **Two deployments matter:**
  - **Production** `https://apar-one-final.vercel.app` = built from **main**. It does **not** include the latest unmerged work (Banking, the invoice-display fix, the bank-account vault feature). Those sit on `feat/client-vendor-payments`.
  - **Branch preview** `apar-one-final-...vercel.app` (commit `afcaf77`) = includes all recent work, uses the **same prod DB**. This is where the new features were runtime-tested.
- **Ledger is append-only** (DB triggers block deletes). Test cleanup = delete deletable rows + reverse posted transactions (net-zero). The `audit_log` is also append-only.

**Dummy-data test run + cleanup:**
- Created 1 dummy agency bank account (`ZZTEST Bank …`, opening ₹1,00,000) via the real Banking UI on the preview.
- Verified, then **deleted**: bank_accounts row removed, vault blob removed, no ledger postings were created.
- **DB confirmed back to exact baseline** (counts identical pre/post; 0 `ZZTEST` rows). Only residue: 2 append-only `audit_log` rows for the test action (by design).

**Runtime results:**
- ✅ Live OS app: lock screen, sign-in (`apar2026`), menubar, command palette (⌘K), Vendors list + edit modal, Attendance all render.
- ⚠️ **Smoke failure:** Attendance month matrix renders **no "today" column highlight** (`.is-today-col`) — minor UI/date bug.
- 🐞→✅ **E2E found a real defect, now FIXED + re-verified (new Banking feature):** setting an opening balance created the account but the balance showed **₹0** and the bank book was **empty** — the opening journal did **not** post. Root cause: the chart credited **`3100 Partner Capital`**, which is sub-ledgered **by partner user**, and the DB has **no `partner` user** (only 1 `admin`), so the post was skipped. **Fix (commit `b8619aa`):** added a non-control **`3900 Opening Balance Equity`** account (migration `0049`) and a fallback — when no partner exists, the opening balance posts `Dr 1120 / Cr 3900` via a journal. **Re-verified on the rebuilt preview:** the opening balance now posts as a balanced journal (`1120 debit 100000 / 3900 credit 100000`, status posted) and the bank balance + book read ₹1,00,000 and tally.

---

## 1. Dashboard module (`src/app/(app)/`) — per-feature status

Legend: ✅ working · 🟡 partial · ⛔ stub/placeholder

### Home / shell
- 🟡 **Dashboard `/`** — 4 KPI tiles are real `count()` queries; no activity feed / P&L (Phase-6 placeholder).
- ✅ **App shell/nav** — works; header user is hardcoded `STUB_USER` (TODO `getCurrentUser()`); nav omits `/documents` and `/views`.

### Clients
- ✅ **List `/clients`** — real list + bulk archive/hard-delete. Caveat: `priority/city/tags/pocs/lastActivityAt` hardcoded.
- 🟡 **Detail `/clients/[id]`** — real: Overview, Contacts (CRUD), Addresses, Bank & Tax (CRUD + vault reveal), Documents, Projects, Transactions, Payments, Expenses-on-behalf, Activity, Edit. ⛔ tabs: Ledger, Custom, Related.
- ✅ **New client wizard `/clients/new`** — real create + post-create KYC/doc uploads.

### Vendors
- ✅ **List `/vendors`** — real + bulk ops. Caveat: Outstanding always ₹0, TDS column always "—" (hardcoded).
- 🟡 **Detail `/vendors/[id]`** — real: Bills, Payments (record + reverse), Documents, Edit. ⛔ tabs: Ledger, Contracts, Activity. Overview shows fake Outstanding/TDS/contact.
- ✅ **New vendor wizard** — real.

### Projects
- ✅ **List `/projects`** — real read; "New project" button **hard-disabled** ("wizard pending") though `createProject` exists; bulk ops not surfaced.
- 🟡 **Detail `/projects/[id]`** — real Transactions + status change. Fake: Billing model always "Fixed fee", Deliverables/Milestones 0/0; Team/Docs/Activity empty.

### Employees
- ✅ **List `/employees`** — real list + bulk + import.
- 🟡 **Detail `/employees/[id]`** — real Profile + Edit. ⛔ tabs: Documents, Reporting, Leaves, Attendance, Assets, Performance, Activity. No payroll tab (real `getEmployeeSummary` only wired in OS).
- ✅ **New employee wizard** — most complete create (employee + contacts + KYC + addresses + salary structure).

### Payroll — mostly stubbed at the page level
- ✅ **Home `/payroll`** — static nav.
- ⛔ **Leaves** — hardcoded rows; real `applyLeave/approveLeave` exist but unused.
- ⛔ **Reimbursements** — hardcoded; **no `payReimbursement` anywhere** (can't post to ledger).
- 🟡 **Salary structures** — backend real (`createSalaryStructure`), UI Save/History disabled.
- 🟡 **Bonuses** — create works (`recordBonusOrPerk`); list is placeholder.
- ⛔ **Salary runs (list + new wizard)** — hardcoded; wizard submit is a **no-op** ("postSalaryRun not yet shipped"); `salary_runs`/`salary_lines` tables never written. (Note: `recordSalaryPayment` posts a real disbursement, but only from the OS employee window.)

### Banking _(NEW — preview only, not on prod yet)_
- ✅ **`/banking`** — real list with balances + `getBankBook`; create/update real; opening balance posts to the ledger (`Dr 1120 / Cr 3100` with a partner, else `Cr 3900 Opening Balance Equity`) — fixed + verified (see §0).
- ⛔ **Reconcile index `/banking/reconcile`** — hardcoded 2-row BANKS.
- ⛔ **Reconcile detail** — `getReconciliationCandidates` returns `[]`; fake upload; "Mark complete" disabled.

### Ledger
- ✅ **`/ledger`** + `/ledger/new` — static pickers. Bug: links to `/ledger/new/salary-run` (404, no route).
- **Ledger entry forms — 78% can't post:** only **vendor-bill** and **journal-voucher** route to the real backend. ⛔ client-invoice, payment-received, payment-made, advance-received, office-expense, expense-on-behalf, inter-bank-transfer all dead-end at `typed_form_pending` (legacy adapter never routes them) even though the backend supports them.

### Reports — see §3.

### Audit
- ✅ **`/audit`** — real append-only audit + activity logs, URL filters. Caveats: no export, not capability-gated.

### Documents / Views
- ⛔ **`/documents`** — "module not built yet".
- ⛔ **`/views`** — "not built yet" (named-view CRUD unbuilt).

### Settings
- ✅ **Periods** — real state machine + audit.
- ⛔ **Forms** — in-memory templates, no save action.
- ✅ **Roles** — real `setRoleCapability` + audit; partner row immutable.
- 🟡 **Validation rules** — reads real data, **toggle/threshold write nowhere** despite "takes effect immediately" copy (most misleading page).
- ⛔ **Tax rates** — hardcoded, read-only.
- **Banks** → redirect to Billing.
- ✅ **Billing** — full CRUD over `company_bank_accounts` + invoice theme/format editor.
- ✅ **Vault** — real AES crypto, DEK rotation, lockout, gated.
- ✅ **Company** — profile/docs/logo CRUD + audit + byte-streaming endpoint.

### Portal `(portal)/me/*` — entirely ⛔
All 7 pages are UI mocks: zero DB/server access; hardcoded data; forms are no-ops; no auth.

**Dashboard totals (~75 surfaces):** ~33 ✅ · ~9 🟡 · ~30 ⛔.

---

## 2. OS module (`src/app/(os)/os/` + `components/os/`) — per-app status

The OS is **substantially real and DB-backed** (same server actions + shared `components/entity/*` sections as the Dashboard), not a demo skin.

- **Shell** ✅ — real window manager (drag/resize/min/max/z-order), dock with magnification, command palette (⌘K), menubar (clock/search/sign-out; File/Edit/View menus mostly decorative/disabled), multi-window + beside-focused `<EntityRef>` nav, RBAC-gated dock/palette.
- **Auth** ⚠️ — lock screen + Admin Console + permissions are **localStorage plaintext (demo-grade)**; real Supabase auth dormant. _Single biggest "not production" item._
- **Dock apps** ✅ — Clients, Vendors, Projects, Employees, Inbox (recent-docs feed), Reports (native windows), Settings (10 sections), Admin Console (UI real, demo persistence). All DB-backed (`server-stub/entity-actions` is a misnomer — it hits the real DB).
- **Entity windows** ✅ — client/vendor/employee/project windows reuse the shared sections; full `Promise.all` loads; edit dialogs real.
- **Ledger/report windows** ✅ — office/client/vendor/utilities ledgers, trial balance, balance sheet, P&L, statement, transaction-detail, document — all real. 🟡 aging-window (AP side empty). Caveat: per-client-P&L "Txns" column hardcoded 0.
- **Office / Attendance / Salary book** ✅ — office-expense tracker, attendance month-matrix (OS-only), salary book + exports — all DB-backed.
- ⛔ **Stubs (honest "coming soon"):** `cash-flow-window`, `bank-recon-window`.

**OS vs Dashboard parity:**
- **OS does MORE:** Attendance grid (no Dashboard route), native report/ledger windows with running balances, multi-window, command palette, per-user appearance settings, Admin Console.
- **OS does LESS / Dashboard-only:** accounting Periods, Roles page, Tax rates, Form templates, Validation rules; general journal-voucher entry; the multi-step creation wizard; Cash-flow & Reconcile surfaces. The new **`/banking`** page is Dashboard-only (OS Settings → Bank accounts still manages `company_bank_accounts`, not the ledger bank accounts).

**OS totals (~30 surfaces):** ~26 ✅ · 1 🟡 · 2 ⛔ (+ auth demo-grade).

---

## 3. Reports — what can actually be generated

**✅ Working (real double-entry rollup, reachable in UI + OS):**
- **Trial Balance** — real SQL over postings.
- **Balance Sheet** — derived from trial balance. _Caveat: current-year P&L not folded into equity, so A = L+E won't visibly tie until year-end close._
- **Profit & Loss** — real. _Caveat: uses a single as-of date, not a true from/to window._
- **AR Aging** — real per-client. _Caveat: buckets by invoice date, not due date._
- **Statement of Account** (client / vendor / office) — real.
- **Per-Client P&L** — real revenue − direct cost. _Caveat: "Txns" count hardcoded 0._

**⛔ Stub / non-functional on their route:**
- **Cash Flow** — placeholder; **no backend exists** (`getCashFlowStatement` missing).
- **Bank Book `/reports/bank-book`** — still a placeholder page, **but the backend now exists** (`getBankBook`) and is live on the new `/banking` page. The route just needs an account picker wired; effectively superseded by `/banking`.
- **AP Aging** — renders empty because the stub adapter hard-returns `[]`, **despite a complete `getApAging` + `bill_allocations` existing**. One-line unblock.

**Built but NOT surfaced anywhere (orphaned backends):**
- **GSTR-1, GSTR-3B** (JSON exports), **TDS Form 26Q**, **TDS-receivable register** — all real generators in `src/lib/server/exports/`, but **no page, route, nav, or download endpoint**. Zero UI references.

**Missing for a complete suite:** Cash-flow statement; a Day Book / Journal (chronological all-postings); a General Ledger drill-down per GL account; invoice/bill-level aging detail; and surfacing the GST/TDS exports.

---

## 4. How things are linked

- **Entities** (clients/vendors/employees/projects) ← contacts, addresses, **entity_bank_accounts** (vaulted), tax identifiers, documents, activity — all polymorphic by `(entity_type, entity_id)`.
- **Invoice (composer)** → on _send_ posts a `client_invoice` **transaction** (Dr 1200 AR / Cr 4100 Revenue / Cr 2120 GST) and links `postedTransactionId` + `sourceDocumentId`; carries `projectId`. → **This is the correct invoice path.** _(The old Transactions-tab "New invoice" wrote a separate draft transaction and was removed.)_
- **Client receipt** → `receipts` row + `payment_allocations` (→ invoices) + posts `client_payment_received` (Dr 1120 bank-subledger / Cr 1200 AR). Marks invoices partially_paid/paid.
- **Vendor bill** → posts (Cr 2110 AP / Dr cost / Dr 1250 input GST / Cr 2130 TDS). **Vendor payment** → `bill_allocations` (→ bills) + posts (Dr 2110 / Cr 1120 bank).
- **Bank accounts (ledger, `bank_accounts`)** = sub-ledger of GL **1120**, keyed by `bank_accounts.id`. Every receipt/payment posts to the chosen account's sub-ledger; per-account balance = roll-up of those postings (incl. the opening JV). The payment forms read this table, so registering accounts auto-populates the pickers.
- **Reports** roll up postings by account/sub-ledger/entity. **Periods** auto-assigned by `txn_date`; year-end close rolls P&L → 3300 Retained Earnings.

---

## 5. Financial completeness — solid vs. gaps

**Solid:** double-entry engine (balanced postings, control-account discipline, immutability, reversal), period close + fiscal-year close → retained earnings, trial balance / P&L / balance sheet / aging / statements, client advances (Rule 50), credit notes, partner capital/drawings, inter-bank transfer template.

**Prioritised correctness risks (most important first):**
1. **Client-withheld TDS is captured but never posted** → AR never fully clears and the TDS-receivable in the export has no ledger backing. There is no TDS-receivable account in the chart. _Books overstate receivables on every receipt where a client deducts TDS._
2. **GST CGST/SGST/IGST split isn't carried to the ledger** → GSTR-3B dumps all output GST into IGST (wrong for intra-state, the norm); GSTR-1 reads a different source, so the two returns don't reconcile to each other or the books.
3. **No GST/TDS remittance flow** — 2120/2130 only accumulate; output GST never offset against input credit (1250); statutory dues never discharged.
4. **RCM is flag-only** — no self-invoice raising output liability + ITC.
5. **Salary TDS (192) not handled** — payroll posts gross only; Form 24Q/16 impossible.
6. **`gst_rate_mismatch` validation is dead** — reference rates are seeded disabled and never enabled.
7. **🐞 Opening balances don't post when there's no partner user** (found in test) — the new Banking feature creates a ₹0-balance account silently. _Blocks the "everything tallies" goal in the current environment._
8. **Cash-flow statement and bank reconciliation are stubs** — no way to verify books vs bank.
9. **AR aging by invoice date, not due date.**
10. **`enforce_period_close` defaults off** — back-dated posting into soft-closed periods allowed by default.

---

## 6. Recommendations

### Financial fixes (do first)
1. ✅ **DONE — opening-balance posting fixed** (finding #7): added `3900 Opening Balance Equity` + a fallback so the opening posts (`Dr 1120 / Cr 3900`) when no partner user exists; posts to `3100 Partner Capital` when one does. Verified on the preview against the prod DB. _(Optionally seed a real `partner` user later if you want opening cash attributed to partner capital instead.)_
2. **Post client-withheld TDS:** add a TDS-receivable asset account and post `Dr bank + Dr TDS-receivable / Cr AR` so receivables clear and the TDS register is ledger-backed.
3. **Carry CGST/SGST/IGST split into the 2120 posting** and source GSTR-3B from the ledger; reconcile GSTR-1/3B to the books.
4. **Add GST & TDS remittance transaction kinds** (with challan capture) to discharge 2120/2130.
5. **Unblock the built-but-hidden pieces** (cheap, high value): AP Aging (call the real `getApAging`), Bank Book route (wire `getBankBook` + account picker), and surface the GSTR-1/3B/26Q/TDS-receivable exports with a download endpoint.
6. **Wire the ledger entry forms** (client-invoice, payments, office-expense, etc.) to the real backend, or remove them — today 7 of 9 can't post.
7. **RCM self-invoicing**, **salary statutory split (TDS/PF/ESI)**, **bank-reconciliation matcher**, **cash-flow statement**.

### Additional useful features
- Recurring invoices / retainers (high value for an agency).
- Fixed-asset register + depreciation (1510 only grows today).
- Vendor advances + vendor debit notes (symmetry with the working client side).
- Due-date-based aging + automated dunning (reminder infra already exists).
- Real Supabase auth to replace the OS localStorage demo (gates the whole employee portal + Admin Console).
- Build out the employee portal (all 7 pages are mocks) and the employee detail tabs.
- Day Book / General Ledger drill-down reports; report export everywhere.
- Fix small bugs: Attendance "today" column highlight; `/ledger/new/salary-run` 404; vendor Outstanding/TDS and project billing/deliverables hardcoded display values.

---

## 7. Cleanup attestation
All dummy data created during testing was removed and the books were verified neutral:
- The dummy bank accounts and their vault blobs were **deleted**; row counts are back to the exact pre-test baseline with **zero `ZZTEST` rows**.
- The one posted opening-balance journal (from the fix re-test) was **reversed** (the ledger is append-only — posted entries are reversed, not deleted). Verified under the app's own trial-balance filter (`status='posted' AND reverses_id IS NULL`): **`3900 Opening Balance Equity` net = ₹0** and `1120 Bank Accounts` shows only its real pre-existing baseline — i.e. the test contributes **zero** to every account balance.
- Irreducible residue (immutable by design, zero effect on balances): the reversed-original + reversal journal pair (excluded from all balances) and the append-only `audit_log` rows recording the test actions.
