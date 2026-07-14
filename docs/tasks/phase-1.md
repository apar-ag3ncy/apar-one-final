# Phase 1 — Task Ledger (RECONSTRUCTION)

> **RECONSTRUCTION — THE ORIGINAL FILE IS LOST.**
>
> The original `docs/tasks/phase-1.md` — the Phase-1 task ledger, tasks
> P1.01–P1.21, referenced by `src/components/os/Handover.md` — was deleted or
> lost before this repository's surviving history begins. This replacement was
> mined on 2026-07-11 from git history, `STATUS.md`, `BILL-STATUS.md`,
> `src/components/os/Handover.md` (untracked, present in the working tree at
> reconstruction time), and the surviving code and migrations. **The original
> task titles and numbering are mostly unrecoverable** — only three P1.xx
> numbers survive in other documents (see "Known original task numbers").
> Nothing below is reconstructed from memory; every line cites evidence that
> exists in this repository.
>
> Why git history cannot recover the ledger: the repo's root commit
> `fc0c562a` (2026-06-01, "Add /api/debug JSON probe for production
> diagnosis") imports the entire already-built tree in one squash — 521 files,
> 96,425 insertions, including migrations `0000`–`0027` — so every per-task
> Phase-1 commit predates the surviving history. `BILL-STATUS.md`
> (§"Branch state") documents the earlier layout that explains this: an inner
> repo whose foundation code lived uncommitted in the working tree, with an
> outer repo taking periodic snapshot commits as the canonical history.

## Numbering schemes — read before citing anything

Three unrelated numbering schemes appear in the surviving documents. Do not
conflate them:

1. **P1.xx** — the original Phase-1 ledger's task numbers (this file's lost
   content). Only P1.01, P1.04, and P1.19 survive; see below.
2. **STATUS.md "Phase 1.1 … 1.8"** — the _agent-backend brief's_ internal
   sub-steps (`STATUS.md` §Backend, "2026-05-25 — Phase 1 start", lines
   73–80). They describe backend foundation work and are cited
   per-deliverable below, but they are **not** P1.xx numbers.
3. **BILL-STATUS.md "Phase 1"** — the _billing-backend agent's_ internal
   numbering (schema migrations `0019`–`0023`). Later than, and unrelated to,
   this ledger's Phase 1.

## Verified Phase-1 deliverables (all complete)

Foundation deliverables that survive in the tree with a citation. All shipped
long ago; the production system at `apar-one-final.vercel.app` is built on
them. `Handover.md`'s kickoff checklist names the five rules this phase
existed to enforce: no financial calculation, soft delete via `deleted_at`,
RLS on every table, money as bigint paise, no new packages without asking.

- [x] **Next.js repo & tooling scaffold** — TypeScript app plus
      `.editorconfig`, `.prettierrc.json`, `.prettierignore`,
      `eslint.config.mjs`, `vitest.config.ts` + `vitest.setup.ts`,
      `playwright.config.ts`, `.nvmrc`, `.npmrc`, `.env.example`.
      EVIDENCE: all present in root commit `fc0c562a`; `Handover.md` names
      "P1.01 (repo & tooling setup)" as the first implementation task, the one
      that "scaffolds Next.js into this directory".
- [x] **Composite quality gate `npm run check`** — chains
      `typecheck → lint → format:check → test → db:check → check:money`.
      EVIDENCE: `package.json` §scripts; `Handover.md` §"Your working rhythm"
      mandates "Run `npm run check` — must pass" for every task. (One caveat:
      the `check:money` link, `scripts/check-money.mjs`, self-describes as
      "Phase 2 brief" in its header, so that link post-dates Phase 1; the rest
      of the chain is Phase-1 era.)
- [x] **Server-only validated environment registry** — `src/lib/env.ts`:
      Zod-validated at import, fails loud at boot, `'server-only'` guard,
      `.env.example` kept as the source of truth for required vars.
      EVIDENCE: the file itself; `STATUS.md:74` "Phase 1.1: deps +
      `src/lib/env.ts`" and the end-of-session entry "Phase 1 — env
      validation, money helpers …" (`STATUS.md:92`).
- [x] **Money is bigint paise** — `src/lib/money.ts`: `Paise = bigint` alias,
      `assertBigint()` runtime guard at wire boundaries, `en-IN` INR
      formatters, explicitly no `dinero.js`. The file header cites CLAUDE.md
      rule #1 and LEDGER-SPEC §0.4.
      EVIDENCE: the file itself; `STATUS.md:75` "Phase 1.2: `src/lib/money.ts`
      (~50 LOC, bigint paise, no dinero)".
- [x] **Float ban wired into the gate** — `scripts/check-no-floats.ts` scans
      every `drizzle/*.sql` migration for `numeric` / `decimal` / `real` /
      `double precision` / `float` and fails on any finding; wired as
      `npm run db:check`.
      EVIDENCE: the script itself (its header names `db:check` and CLAUDE.md
      rule #1); `STATUS.md:76` "Phase 1.3: `scripts/check-no-floats.ts` +
      `db:check` wire"; `package.json` §scripts.
- [x] **Initial Drizzle schema + first migration** — `drizzle/0000_init.sql`
      (drizzle-kit generated; RLS deliberately deferred to a later migration
      per its header).
      EVIDENCE: the migration itself; `STATUS.md:192` characterizes that
      state as "end of P1.04 — 10 client-side tables, one Drizzle migration".
- [x] **RLS baseline on every table** — `drizzle/0001_rls_baseline.sql`
      enables RLS on every existing table with a service-role-only fallback
      policy (CLAUDE.md rule #30: RLS on every table, default deny).
      EVIDENCE: the migration's own header: "0001_rls_baseline — Phase 1.6 of
      the agent-backend brief"; `STATUS.md:77`.
- [x] **Append-only audit log** — `drizzle/0002_audit_log_append_only.sql`
      renames `activity_log` → `audit_log` and locks it append-only via RLS.
      EVIDENCE: the migration's own header: "0002_audit_log_append_only —
      Phase 1.7 of the agent-backend brief"; `STATUS.md:78`.
- [x] **Ledger timestamps mixin without `deletedAt`** —
      `src/lib/db/schema/_ledger.ts`: a `timestamps()` variant with no
      `deletedAt`, because LEDGER-SPEC §8.5 forbids any delete on
      `transactions` / `postings`; ledger tables import from `_ledger`
      instead of `_shared`.
      EVIDENCE: the file itself; `STATUS.md:79` "Phase 1.8: already done
      (`_ledger.ts` exists)" and the resolution note at `STATUS.md:225–233`
      ("RESOLVED 2026-05-25 per SPEC-AMENDMENT-001 §2.3 + §12 (Phase 1)").
- [x] **GSTIN structural validation** — `src/lib/validators.ts`: `GSTIN_RE`
      (15-char deterministic structure) + `isValidGSTIN()`, alongside the
      PAN / IFSC / TDS-section validators in the same file.
      EVIDENCE: the file itself; `Handover.md` ties P1.19 to GSTIN work.
      **Honest caveat:** `Handover.md` says P1.19 "ships with the mock
      adapter" (decision D3, GSTIN API provider, was open). No mock GSTIN
      _lookup adapter_ survives anywhere in the current tree — the structural
      validator is the only surviving GSTIN artifact, consumed today by the
      GSTR exports and billing validation.

## Known original task numbers

The only P1.xx numbers with surviving evidence:

| Task  | What it was                                                                                                                                                                              | Source                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.01 | Repo & tooling setup — the first implementation task; scaffolds Next.js into this directory                                                                                             | `Handover.md` §"State of this directory"                                                                                                           |
| P1.04 | Initial database schema — real schema code created fresh (`docs/reference/schema-reference.ts` was illustrative only); "end of P1.04" = 10 client-side tables, one Drizzle migration     | `Handover.md` §"The files and their authority order"; `STATUS.md:192`                                                                              |
| P1.19 | GSTIN lookup — shipped with the mock adapter pending decision D3 (GSTIN API provider)                                                                                                    | `Handover.md` §"Open decisions"                                                                                                                    |

P1.02–P1.03, P1.05–P1.18, and P1.20–P1.21: titles unrecovered. No surviving
document names them, and they are deliberately **not** reconstructed here.

## Where the rest of the trail lives

- `docs/tasks/phase-2.md` … `phase-4.md` are likewise lost, as are the other
  planning documents `Handover.md` refers to (`docs/changes/CHANGES-01.md`,
  `docs/reference/*`, `AGENT-BACKEND.md`, `AGENT-FRONTEND.md`,
  `COORDINATION.md`, and the original "project bible" `CLAUDE.md` with its
  numbered rules — today's `CLAUDE.md` is a one-line Next.js note, not that
  document).
- Current work is tracked in `STATUS.md` (per-session notes) and the GitHub
  pull-request history of `apar-ag3ncy/apar-one-final`. At reconstruction
  time the repo carries migrations `0000`–`0069` and a PR trail past #113.
