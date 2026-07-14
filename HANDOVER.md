# HANDOVER — Read This First

> You are Claude Code, opening the `apar-one-final` directory for the first time.
> This file tells you what this project is, what state it's in, and exactly what to do next.
> The human you're working with is the founder of Apār LLP — a developer; treat them as such.

## What this project is

**Apār One** — the internal operations platform for Apār LLP, a Mumbai digital marketing & branding agency (clients in jewellery and real estate). Five domains: Clients, Vendors, Projects, Employees, Office & Finance. Core philosophy: **capture, don't calculate** — financial documents are uploaded and AI-extracted, a human verifies, the ledger records. The system never computes GST/TDS/payroll for filing.

## State of this repo (updated 2026-07-11)

The system is **built and in production**. It is deployed on Vercel at `apar-one-final.vercel.app`; every deploy (including per-commit preview builds) runs `drizzle-kit migrate && next build`, so migrations apply against the production database. Do not treat this repo as a playground.

- ~70 hand-authored SQL migrations live in `drizzle/` (0000–0069). New migrations are hand-written SQL plus a `_journal.json` entry — `db:generate` is broken.
- The UI is an OS-style desktop shell under `src/components/os/` (windows, dock, command palette) mounted at the `(os)` route group, alongside conventional dashboard routes under `src/app/(app)/`.
- Server logic lives under `src/lib/server/` (server actions) with the Drizzle schema in `src/lib/db/schema/`.
- The ledger is real double-entry: `transactions` + `postings`, balanced at COMMIT, all money as **bigint paise**.
- OS login is server-backed in `os_users` (scrypt hashes, `apar_os_uid` cookie) — it is not localStorage-only anymore.

Per-session engineering notes live in `STATUS.md`; the change history lives in the GitHub PR log.

## The five core rules

1. **No financial calculation.** Capture, don't calculate. The system never computes GST/TDS/payroll for filing — a human enters verified figures.
2. **Soft delete everywhere.** Rows get `deleted_at`; nothing is hard-deleted without an explicit, audited reason.
3. **RLS on every table.** No table ships without a row-level security policy.
4. **Money is bigint paise.** No floats, no numeric — enforced by `npm run db:check` and `npm run check:money`.
5. **No new npm packages without asking.** Ever.

## The files and their authority order

1. `CLAUDE.md` — project bible (currently points at `AGENTS.md`: this repo runs Next.js 16, which has breaking changes — read the guides in `node_modules/next/dist/docs/` before writing code). Rules here win over everything except the human's explicit instruction.
2. `HANDOVER.md` — this file. Orientation for a fresh session.
3. `docs/tasks/phase-1.md` — the reconstructed task ledger (being added in a sibling branch; reference it once it lands).
4. `docs/changes/CHANGES-01.md` — the reconstructed decision record (likewise being added in a sibling branch).
5. `STATUS.md` / `BILL-STATUS.md` / `FRONTEND-OS-AUDIT.md` — historical status notes from past sessions. Read for context; do not treat as current instructions.

## Your working rhythm (every task, every session)

1. Read `CLAUDE.md` fully, then the current phase file.
2. Wait for the human to assign a task. Never pick one yourself.
3. Plan the task in 3–6 bullets. Wait for approval.
4. Implement. Run `npm run check` — must pass.
5. Report what changed. Mark the task `[x]` in the phase file. Stop.

## Open decisions — do not build past these

(see `docs/changes/CHANGES-01.md` for current dispositions)

**D1** (invoice generation — blocks P4.04–P4.06 only), **D2** (WhatsApp — P4.07 defaults to wa.me links), **D3** (GSTIN API provider — P1.19 ships with the mock adapter until decided), **D4** (share-link interpretation), **D5** ("chats" = comments/notes). If a task seems to need a decision resolved, ask the human; never resolve a D-item yourself.
