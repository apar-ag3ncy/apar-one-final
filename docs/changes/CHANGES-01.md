# CHANGES-01 — Founder Feature Batch (Decision Record)

> **RECONSTRUCTION.** The original `docs/changes/CHANGES-01.md` was lost before the
> repository history begins; the founder's original prose is unrecoverable and has
> **not** been re-invented here. This file was rebuilt on 2026-07-14 from the surviving
> references to it (chiefly `src/components/os/Handover.md`) plus direct inspection of
> the codebase. The decision dispositions in §4 were verified against the code on
> 2026-07-14 (`main` @ `ce87a8d5`). Nothing below claims to be the original text.

## §1 — What this file was

CHANGES-01 was the founder's feature batch for Apār One: a project intro (the full
"what this project is" description), nineteen feature notes (C-01…C-19) with specs and
rationale, and a set of open decisions (D1–D5) that implementation was not allowed to
build past. The pre-code handover document treated it as the fifth authority in the
project's file order, after `CLAUDE.md`, the agent role files, `COORDINATION.md`, and
the phase task ledgers.

## §3 — Feature notes C-01…C-19 (tombstone)

C-01…C-19 were merged into the phase task files (`docs/tasks/phase-1.md` …
`phase-4.md`) before implementation; both the change notes and those files are lost.
Their outcomes live in the built system and the GitHub PR history.

## §4 — Open decisions D1–D5: dispositions as of 2026-07-14

The original one-liners below survive verbatim in `src/components/os/Handover.md` §"Open
decisions". Each disposition was verified by opening the cited files — nothing is
inferred from memory or from the lost original.

### D1 — Invoice generation (blocked P4.04–P4.06 only)

**RESOLVED — shipped.** Server-side PDF generation exists and is wired end-to-end:

- `src/lib/server/billing/pdf/invoice.tsx` — `renderInvoicePdf()` /
  `InvoiceDocument`, alongside `credit-note.tsx`, `payment-receipt.tsx`,
  `receipt-voucher.tsx`, `refund-voucher.tsx`, `payment-voucher.tsx`, `load-data.ts`,
  `upload.ts`, and render tests (`invoice.render.test.ts` etc.).
- Invoice themes are a real schema surface: `src/lib/db/schema/invoice_themes.ts`,
  migrations `drizzle/0037_invoice_themes.sql`, `drizzle/0038_invoice_theme_capability.sql`,
  and `0039_invoice_theme_immutability` (see `drizzle/meta/_journal.json`).
- Compose UI: `src/components/entity/billing/invoice-composer.tsx` renders a live PDF
  preview (`PdfJsViewer`) and "save & download" posts the invoice and makes it
  immutable.

### D2 — WhatsApp (P4.07 defaults to wa.me links)

**STILL OPEN — nothing shipped.** A repo-wide search for `wa.me` / `whatsapp` across
`src/` (`*.ts`, `*.tsx`) returns zero matches. Neither the wa.me-link default nor any
deeper WhatsApp integration exists in the codebase.

### D3 — GSTIN API provider (P1.19 ships with the mock adapter until decided)

**STILL OPEN — and the mock adapter itself is no longer present.** No GSTIN lookup
adapter (mock or real) exists. GSTIN today is a manually entered identifier with
format-only validation:

- `src/lib/validators.ts` — `GSTIN_RE` (15-char structural regex) and
  `isValidGSTIN()`; reused by `src/lib/forms/billing/schemas.ts` (`GstinSchema`) and
  `src/lib/server/settings/company.ts`.
- Stored on clients / vendors / organizations and consumed by the GST report exports
  (`src/lib/server/exports/gstr1.ts`, `src/lib/server/exports/gstr3b.ts`) and invoice
  PDFs — all from the stored value, never from a provider API.

No provider has been chosen; if live GSTIN verification is still wanted, it is
greenfield work.

### D4 — Share-link interpretation

**STILL OPEN — nothing shipped.** Searches for `share-link`, `share_link`,
`shareToken`, `share_token` across `src/`, and for any `*share*` route under
`src/app/`, return zero matches. No share-link or share-token functionality of any
interpretation exists.

### D5 — "Chats" = comments/notes

**PARTIALLY — the interpretation was adopted, but user-authored notes never got a UI.**
No real-time chat exists anywhere (consistent with the decision). What shipped:

- Schema for a client interaction feed exists since the initial migration:
  `src/lib/db/schema/client_activities.ts` (type enum `meeting | email | call | note`,
  doc-commented as "P2.01 — chronological feed of meetings / emails / calls / notes"),
  plus `client_activity_attendees.ts` and `client_activity_attachments.ts`
  (`drizzle/0000_init.sql`). However, nothing outside the schema references these
  tables — no server action or component reads or writes them.
- Free-text `notes` columns shipped on `clients`, `vendors`, and `projects`
  (`src/lib/db/schema/clients.ts`, `vendors.ts`, `projects.ts`).
- The Activity tab that did ship (`src/components/clients/client-detail-tabs.tsx` →
  `src/components/entity/activity-feed.tsx`, backed by
  `src/lib/server/entities/activity.ts` over `entity_activity_log`, 30-day retention)
  is a system-generated event feed. Its event union reserves a `note` kind, but no
  code path writes one — there is no compose-a-note/comment affordance yet.

## Provenance

- Surviving reference: `src/components/os/Handover.md` (pre-code handover; describes
  this file's role, confirms C-01…C-19 were merged into the phase files, and preserves
  the D1–D5 one-liners).
- Everything in §4 was verified by direct file inspection on 2026-07-14; file paths
  above are the evidence trail.
