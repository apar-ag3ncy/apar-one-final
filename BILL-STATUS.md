# BILL-STATUS — Billing Backend agent notes

## Phase 1 — COMPLETE ✓ (all 5 commits landed on `agent/billing-backend`)

| # | Commit | What |
|---|---|---|
| 1 | `26bd7da` feat(billing): phase 1.1 | 20 schema files + 0019 migration (tables, enums, indexes, CHECKs, allocation-sum + posted-doc immutability triggers, RLS baseline); `index.ts` and `types/db.ts` re-exports; journal entry. |
| 2 | `e4db585` feat(billing): phase 1.2 | 0020 adds `1252 Advance-Output-GST-Asset` (asset) and `6600 Bank Charges` (expense) to the chart. |
| 3 | `9d33080` feat(billing): phase 1.3 | 0021 seeds `tds_reference_sections` (192/194C/194J/194I-b/194I-p/194H/194Q, effective 2025-04-01) and `service_items` SAC catalog (998311/998313/998361/998363/998391/998399 at 18% / 4100). |
| 4 | `a3a0969` feat(billing): phase 1.4 | 0022 adds 5 new warn-severity validation rules (`gst_split_mismatch`, `hsn_digit_count_vs_turnover`, `credit_note_outside_window`, `advance_tax_default_rate`, `place_of_supply_vs_supplier_state`) and enables the existing `tds_threshold_crossed`. |
| 5 | `b10f459` feat(billing): phase 1.5 | `lib/rbac.ts` gains 12 billing capabilities; 0023 seeds `role_capabilities` for partner / admin (all) / accountant (10) / manager (3) / employee + viewer (none). |

### Schema surface — what's now available for downstream phases

20 tables shipped: `service_items`, `party_billing_profiles`, `invoices`,
`invoice_lines`, `estimates`, `estimate_lines`, `estimate_invoice_links`,
`credit_notes`, `credit_note_lines`, `bills`, `bill_lines`, `receipts`,
`payment_allocations`, `customer_advances`, `advance_allocations`,
`receipt_vouchers`, `refund_vouchers`, `tds_reference_sections`,
`invoice_reminder_log`, `billing_settings` (singleton, pre-seeded).

11 new enums: `invoice_state`, `estimate_state`, `estimate_link_kind`,
`credit_note_state`, `bill_state`, `bill_attribution`, `receipt_method`,
`reminder_channel`, `reminder_status`, `gateway_default`,
`party_default_payment_method`.

12 new capabilities: `create_invoice`, `send_invoice`, `void_invoice`,
`manage_credit_note`, `manage_estimate`, `receive_payment`,
`manage_recurring`, `manage_billing_settings`, `manage_service_items`,
`manage_party_billing_profile`, `view_gst_reports`,
`manage_tax_reference_sections`.

6 new validation rules (5 net-new + 1 enabled).

8 new chart-of-accounts seeds total (7 TDS sections + 2 accounts —
note: tds rows live in `tds_reference_sections`, not in the chart;
actual accounts added = 1252 + 6600).

### What downstream agents can now build on

- **Dashboard agent** can wire up invoice / estimate / credit-note /
  bill / receipt CRUD lists (TanStack Table) reading via
  `db.select().from(invoices)...` etc. The header tables + line tables
  + state enums + RLS baseline are all in place.
- **OS agent** can spin up the billing app windows. The `entityType` of
  these new tables is implicit (invoices belong to a client, bills to a
  vendor); use `client_id` / `vendor_id` FKs directly.
- Both agents should import types from `@/types/db` (Invoice, Bill, etc.) —
  the re-export surface is up to date for Phase 1.

### What's NOT in Phase 1 (gates for Phase 2+)

- Server actions (`src/lib/server/billing/**`). Phase 2.
- Posting templates extending `lib/server/ledger/postings/` for invoice /
  credit-note / receipt / advance flows. Phase 2-5.
- PDF generation. Phase 2.4 (will surface NEEDS DEP: notice when chosen).
- PaymentGateway interface + Razorpay impl. Phase 4 (will surface
  NEEDS DEP: razorpay + env vars).
- AR aging materialised view. Phase 7.
- GSTR-1 / 26Q exports. Phase 8 (will need CA review).
- Reminder cron. Phase 9.

## Deviations from the agent brief

| Item | Brief | Actual | Reason |
|---|---|---|---|
| Repo path | `~/apar-one-billing-backend` | `E:\Code\Apar Backend Analytics\apar-dashboard\` | Inner repo of a nested layout; outer holds docs. |
| Package manager | pnpm | npm | Matches existing `package.json` + lock file. |
| Schema path | `db/schema/**` | `src/lib/db/schema/**` | Existing convention. |
| Migration path | `db/migrations/**` | `drizzle/**` | Existing Drizzle convention. |
| Pre-commit | `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check` | `npm run check` (typecheck + lint + format:check + test + db:check + check:money) | The repo's full gate. `format:check` has 360+ pre-existing failures on unrelated files; new billing files format clean. |
| `types/db.ts` | "regenerate" | extend (it's a curated re-export, not auto-generated) | The file ships type names per-table, not a generated dump. |
| Branch | `agent/billing-backend` | `agent/billing-backend` (newly created off `main`) | Brief's branch didn't exist. Created it. See "Branch state" below. |
| `service_items` shape | text `default_income_account_code`, `default_tax_rate_bps`, no unit | FK `default_income_account_id`, `default_gst_rate_bps`, `default_unit`, `default_tds_section` | Pre-existing draft in the working tree was honored — it's better aligned with the codebase. The Phase 1.3 seeder uses `default_gst_rate_bps = 1800`. |

## Branch state — IMPORTANT for the user

The inner repo `apar-dashboard/` has an unusual VCS pattern:

- `main` has only the `d383d13 Initial commit: Apār One desktop OS demo`
  commit — 163 tracked files.
- Branches `agent/backend`, `agent/billing-dashboard` are at the same
  initial state + 3 docs-only commits (`audit: backend gap audit v1/v2/v3`).
- All real foundation code (18 migrations 0001-0018, the polymorphic
  entity subgraph, the ledger module, server actions, components) lives
  **uncommitted in the working tree** of `agent/billing-dashboard`.
  The OUTER repo (`E:\Code\Apar Backend Analytics`) does periodic
  snapshot-commits of `apar-dashboard/` as a whole (`Sync latest
  changes…` etc.) and is the canonical history.

**What I did:**

1. Created `agent/billing-backend` from `main`.
2. Stashed the dashboard agent's WIP as `stash@{0}` BEFORE switching
   branches: `"dashboard-agent WIP + billing-backend Phase 1 schema
   (preserved by billing-backend agent during branch swap)"`.
   The pre-existing `stash@{1}` (`wip: dashboard page.tsx (frontend
   territory; not mine)`) is untouched.
3. After branching, re-applied stash@{0} to restore the buildable
   working tree, then committed ONLY the 24 billing-specific paths
   explicitly. The other ~80 dashboard-WIP modifications and ~370
   foundation/dashboard-untracked files remain in the working tree
   (and in stash@{0}).
4. Did NOT drop the stash — dashboard's WIP is recoverable from it.

**Implications for the user:**

- This branch's HEAD diff vs `main` includes contributions to three
  shared files (`drizzle/meta/_journal.json`,
  `src/lib/db/schema/index.ts`, `src/types/db.ts`) that pulled in
  dashboard's foundation additions alongside my billing additions —
  unavoidable because those files are shared and need both for the
  codebase to function.
- The branch is NOT independently buildable. A fresh `git clone` +
  `git checkout agent/billing-backend` would fail typecheck because
  the imports in my billing schemas reference `clients`,
  `transactions`, `documents`, `vendors`, etc. — none of which exist
  at this branch's HEAD. The branch is buildable only when overlaid
  on the same foundation working-tree state the user already has.
- Continue treating the outer repo as canonical history; commits on
  the inner repo's agent branches are advisory.

## Phase 2 — invoice server actions (in progress)

| # | Commit | What |
|---|---|---|
| 2.1 | `b4aefaf` feat(billing): phase 2.1 | service_items CRUD + 0024 fix-up reconciling the Phase 1 service_items DDL drift (drops `default_income_account_id` FK, adds `default_posting_account_code` text NOT NULL default '4100', makes `default_gst_rate_bps` NOT NULL default 1800, reseeds SAC catalog). |
| 2.2 | `0bd91ac` feat(billing): phase 2.2 | party_billing_profiles CRUD — polymorphic (client/vendor), single-statement ON CONFLICT upsert. |
| 2.3a | `2686cfe` feat(billing): phase 2.3a | Invoice draft + read actions. New modules: `lib/billing/fy.ts` (pure helpers + 10 unit tests), `lib/server/billing/numbering.ts` (FY-aware document numbering with retry-on-conflict), `lib/server/billing/validation.ts` (billing rule runner — gst_split_mismatch, hsn_digit_count_vs_turnover, place_of_supply_vs_supplier_state), `lib/server/billing/invoices.ts` (createDraftInvoice with idempotency, updateDraftInvoice, getInvoice, listInvoices). |
| 2.3b | `aba6c87` feat(billing): phase 2.3b | sendInvoice / voidInvoice / markInvoiceViewed state transitions + 0025_billing_event_kinds pgEnum extension (21 new kinds front-loaded for later phases). **sendInvoice currently flips state only — ledger posting deferred to Phase 2.4 follow-up** (requires real documents.id for source_document_id; PDF generator pending dep). voidInvoice already reverses ledger txns when present, so 2.4 wiring will close the loop without further changes here. |
| 2.4 | `63b62ff` feat(billing): phase 2.4 | PDF skeleton (`InvoicePdfData` shape + `totalsRowsFor` helper with 3 unit tests). `renderInvoicePdf` throws until dep is chosen. **Dep approved: `@react-pdf/renderer` — Phase 2.5 follow-up will install + wire.** |

## Phase 3 — estimate server actions ✓

| # | Commit | What |
|---|---|---|
| 3.1 + 3.2 + 3.3 | `490535d` feat(billing): phase 3 | `estimates.ts` (CRUD + `sendEstimate` / `markEstimateRejected` / `markEstimateExpired`) and `estimate-conversion.ts` (`markEstimateAccepted`, `convertEstimateToInvoice` with full/partial_pct/partial_amount/partial_lines kinds). Cumulative-link-value tracking auto-flips estimate → 'converted' when total reaches captured_total_paise. No ledger interaction — the invoice that comes out goes through the standard `sendInvoice` flow (still pending Phase 2.5 PDF/ledger wiring). |

## Phase 2.5 — invoice PDF + ledger wiring ✓

| # | Commit | What |
|---|---|---|
| 2.5a | `baa24b4` chore(deps) | `@react-pdf/renderer ^4.5.1` installed (required `--legacy-peer-deps` — pre-existing openai vs zod conflict). |
| 2.5b | `a074fb9` feat(billing): phase 2.5b | renderInvoicePdf (Rule 46 layout via @react-pdf/renderer) + uploadInvoicePdf (Supabase Storage → documents row) + sendInvoice rewritten as a 5-step pipeline that closes the ledger loop. |

## Phase 4 — payment + advance flow ✓ (no Razorpay)

User opted out of 4.2 (Razorpay impl) and 4.4 (webhook handler) for this build. The interface is shaped so a future Razorpay drop-in is purely additive.

| # | Commit | What |
|---|---|---|
| 4.1+4.3 | `b5bc472` feat(billing): phase 4.1+4.3 | `PaymentGateway` interface (`lib/server/payments/gateway.ts`) with `mintPaymentLink` / `verifyWebhookSignature` / `parseWebhookEvent`. `ManualPaymentGateway` no-op impl for bank/UPI/cheque/card receipts. |
| 4.5 | `d44a3bc` feat(billing): phase 4.5 | `recordManualReceipt` (posts via existing `client_payment_received` template). `allocateReceipt` with FIFO default + invoice state transitions (`partially_paid` / `paid`). |
| 4.6 | (this build) feat(billing): phase 4.6 | Extended `clientAdvanceReceived` posting template with optional `advanceTaxPaise` (adds Dr 1252 / Cr 2120 GST split). `pdf/upload.ts` generalised to `uploadBillingPdf` per-category. Rule 50 receipt-voucher PDF. `recordCustomerAdvance` orchestrates receipts + receipt_vouchers + customer_advances + ledger + PDF in one DB tx + 1 follow-up storage write. |
| 4.7+4.8 | `ebdb2a3` feat(billing): phase 4.7+4.8 | `adjustAdvanceToInvoice` (insert advance_allocations + journal Dr 2180/Cr 1200 + Dr 2120/Cr 1252; updates invoice state from combined payment + advance settlements). `issueRefundVoucher` (Rule 51 voucher + PDF + reversing journal Dr 2180/Cr 1120 + Dr 2120/Cr 1252; zeros customer_advances.balance_paise). |

## Phase 5 — credit notes ✓

`feat(billing): phase 5` — `lib/billing/credit-note-window.ts` (CGST §34(2) Nov 30 window helper + tests), Rule 53 PDF, credit-notes CRUD (`createCreditNote` validates ≤ original totals per line, computes `gst_impact_allowed`, seeds `credit_note_outside_window` warn flag when past window), `issueCreditNote` posts the reversing journal (Dr 4100/Cr 1200 + Dr 2120 when allowed; full Dr 4100/Cr 1200 with TODO(human) when commercial-only), `voidCreditNote` reverses the txn.

## Phase 6 — vendor bills ✓

`feat(billing): phase 6` — `lib/server/billing/bills.ts` wraps the existing `vendor_bill` posting template. Discriminated-union input by attribution; `createDraftBill` requires `sourceDocumentId` upfront (caller uploaded vendor PDF first); `recordBill` posts via the template + back-links + flips state; `voidBill` reverses. TDS section normalised against the `TDS_SECTIONS` enum (handles legacy `194I-b` → `194I_building`).

## Phase 7 — AR aging + KPIs ✓

`feat(billing): phase 7` — `0026_billing_views.sql` materialises `ar_aging` (per-invoice outstanding = total − payment_alloc − advance_alloc − issued credit_notes; buckets by_due + by_invoice; aging-bucket indexes) and `billing_kpis` (singleton: total outstanding, oldest days, % in 90+, this-month invoiced + received in IST month boundary, avg days to pay last 90d). `refresh_billing_views()` SECURITY DEFINER fn refreshes both CONCURRENTLY. `lib/server/billing/reports.ts` exposes `getArAging`, `getBillingDashboard` (KPIs + buckets + top 10 debtors), `refreshBillingViews`.

## Phase 8 — exports ✓

`feat(billing): phase 8` — `lib/server/exports/`:
- `gstr1.ts` `generateGstr1({period: 'YYYY-MM'})` — GSTN Phase-3 JSON with B2B + B2CS + HSN + cdnr sections. **TODO(human): CA review against the live CBIC Offline Utility template before the first filing.**
- `tds26q.ts` `generateTds26q({fyLabel, quarter})` — quarterly TDS deduction CSV in the NSDL RPU template format. **TODO(human): add a `tds_challans` capture table for the challan-bsr/serial/date columns before the first filing.**
- `tds-receivable.ts` `tdsReceivableRegister({fyLabel, clientId?})` — register of TDS deducted from Apār by customers, aggregated by section. Drives 26AS / AIS reconciliation at ITR filing.

## Phase 9 — reminders + cron ✓

`feat(billing): phase 9` — `0027_reminder_schedules.sql` adds `reminder_schedules` (per-client OR global default; two partial-unique indexes; seeded global default = 5-step sequence at -3d/0d/+7d/+30d/+60d). `lib/server/billing/reminders.ts`:
- CRUD: `upsertReminderSchedule`, `listReminderSchedules`, `deleteReminderSchedule` (capability `manage_recurring`).
- `decideRemindersForToday(todayIst?)` — pure-ish planner: walks open invoices, picks per-client schedule (falling back to global default), matches today's distance-from-due against rule.offset_days, dedupes against today's `invoice_reminder_log` entries.
- `runDailyReminderCron(sendEmail?)` — for each due reminder: pulls recipient email (primary contact first), composes subject + body, calls `sendEmail` (default = console.warn stub), writes `invoice_reminder_log` (sent | failed), logs `reminder.sent` activity, emits a single audit row per run.

`src/app/api/cron/billing-reminders/route.ts` — POST + GET handlers, shared-secret auth via `Authorization: Bearer $CRON_SECRET`. Returns the run result JSON.

**NEEDS DEP: `resend` for real email send.** Cron is wired and functional today with the stub. To enable real sends:
1. `npm install resend --legacy-peer-deps`
2. Implement `src/lib/server/billing/email-sender.ts` using `new Resend(env.RESEND_API_KEY).emails.send(...)`.
3. Pass it into `runDailyReminderCron(sendEmail)` from the route or via global default.
4. Add `RESEND_API_KEY` to `lib/env.ts` Zod schema.

### Razorpay drop-in checklist (when needed)

The Phase 4 build is structurally complete; switching on Razorpay later requires only additive steps — no caller changes:

1. `npm install razorpay --legacy-peer-deps` (in a single chore(deps) commit).
2. Add `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` to `lib/env.ts` Zod schema.
3. Implement `lib/server/payments/razorpay.ts` with `mintPaymentLink` + `verifyWebhookSignature` + `parseWebhookEvent` per the `PaymentGateway` interface.
4. Add `lib/server/payments/select.ts` to pick the right impl by `billing_settings.gateway_default`.
5. Add `src/app/api/webhooks/razorpay/route.ts` that calls `gateway.verifyWebhookSignature` → `parseWebhookEvent` → on `payment.captured` insert a `receipts` row with `method='razorpay'` + `razorpay_event_id` (unique index = idempotency) + `gateway_payment_id` + `razorpay_payment_link_id`, look up the invoice via `invoices.razorpay_payment_link_id`, post via `client_payment_received` with the captured amount, then post the gateway fee leg (Dr 6600 / Cr 1120).
6. Teach `sendInvoice` to call `gateway.mintPaymentLink` after the ledger post and persist `razorpayPaymentLinkId` + `razorpayPaymentLinkUrl` on the invoice.

## Stop-and-asks / open items

- **NEEDS DEP — invoice PDF renderer** (BLOCKING Phase 2.4 wiring). Per
  CLAUDE.md ("Do not introduce new dependencies without explicit
  approval"), holding off on `npm install` until you choose. Four
  candidates:

  | Choice | Pros | Cons | Bundle |
  |---|---|---|---|
  | `@react-pdf/renderer` | declarative JSX components; great Next.js fit; well-supported for invoice/receipt layouts; streams `Buffer` | flex-only layout (no CSS grid); limited CSS subset | ~250 kB server |
  | `puppeteer-core` + chromium | full HTML/CSS power; can reuse existing Tailwind components | needs Chromium binary; awkward on Vercel Hobby (`@sparticuz/chromium` workaround); cold start cost | ~50 MB + Chromium |
  | `pdfkit` | tiny, imperative, pure JS, no JSX dep | tedious table building; no React parity | ~150 kB |
  | `pdf-lib` | tiny; good for manipulating existing PDFs | manipulation-first; new-doc workflows feel awkward | ~150 kB |

  Recommendation: **`@react-pdf/renderer`** — closest to the project's
  React/Next.js style; bundle penalty is one-time per cold start; the
  declarative API maps cleanly onto Rule 46's structured invoice fields.

- **`check:money` violation in dashboard agent's tree** —
  `src/components/entity/billing/reference-rate-pill.tsx:140` uses
  `pct.toFixed(2)`. The file is dashboard-agent territory (not in my
  write set per the brief). The file is allow-listed via filename
  pattern in `scripts/check-money.mjs:42` only for
  `per-client-pnl-table.tsx`; the new `reference-rate-pill.tsx` isn't
  in the allow-list. Two options for the dashboard agent: add the file
  to `TO_FIXED_ALLOW`, or refactor to render the percentage some other
  way. None of my Phase 1 commits touch this file; `npm run check:money`
  is unrelated to billing-backend changes.

Will surface when reaching:

- **Phase 4.2** (Razorpay) — needs `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` env vars and the
  `razorpay` npm dep (`NEEDS DEP:` will be surfaced in the relevant
  commit).
- **Phase 4.6** (advance receipt postings) — needs 1252 +
  Advance-Output-GST-Asset chart entry (planned as next commit per
  user-confirmed plan).
- **Phase 8.1** (GSTR-1 export) — `TODO(human): verify schema against
  latest CBIC Phase-3 notification before filing` will be embedded in
  the export code. Recommend CA review.
- **Phase 2.4** (PDF generation) — need to choose between
  `@react-pdf/renderer` and `puppeteer-core`. Will surface a
  `NEEDS DEP:` notice with both options when reached.

## File territory (per brief)

I write:
- `src/lib/db/schema/{billing tables listed above}.ts`
- `drizzle/0019_*.sql` and successor billing migrations
- `src/lib/server/billing/**` (Phase 2+)
- `src/lib/server/payments/**` (Phase 4+)
- `src/app/api/webhooks/razorpay/**` (Phase 4.4)
- `src/app/api/cron/billing-reminders/**` (Phase 9)
- `src/lib/server/exports/**` (Phase 8)
- `src/lib/server/billing/pdf/**` (Phase 2.4+)
- `src/types/db.ts` (additive; billing entries only)
- `BILL-STATUS.md` (this file)

I read but do not edit:
- `components/`, `app/(dashboard)/billing/`, `app/os/billing/`,
  `lib/os/`, `CLAUDE.md`, `LEDGER-SPEC.md`, `SPEC-AMENDMENT-001.md`,
  `docs/tasks/`.
