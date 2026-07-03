# Supabase/Postgres → GoDaddy MariaDB migration

Target: host the app on **aparone.apar.agency** (GoDaddy cPanel Node app) with the
database on the **same box's MariaDB 10.11** (`apar-one`), reached over `localhost`.
Supabase (Postgres + Auth + Storage) is removed at the end.

**Safety rule:** prod stays on `main` (Supabase/Postgres) the whole time. All work
happens on `feat/mariadb-migration`. We only cut over once each stage is verified.

## Why this is large (from the codebase recon)

| Area | Coupling to Postgres/Supabase | MariaDB has… |
|---|---|---|
| Schema | 71 tables, 56 enum types, 29 jsonb, 156 timestamptz, 73 `gen_random_uuid()` | no uuid type, no jsonb, TIMESTAMP is UTC-only |
| Queries | 83 `.returning()`, 187 `::` casts, 31 `FILTER(WHERE)`, `ON CONFLICT` | none of these |
| Security | 103 RLS policies / 76 tables | **no RLS** → app-layer WHERE filters |
| Integrity | 42 triggers + 38 PL/pgSQL fns (ledger locks, balanced-txn, audit, state machines) | **no PL/pgSQL, no deferred triggers** → app code |
| Auth | Supabase Auth (login not built yet) | none → build sessions |
| Storage | 4 buckets, 8 ops (KYC vault, docs, PDFs, logos) | none → filesystem/S3 |

## Type mapping (locked conventions)

| Postgres | MariaDB (drizzle mysql-core) | Notes |
|---|---|---|
| `uuid` PK `gen_random_uuid()` | `char(36)` + app `randomUUID()` | keeps existing string ids stable for data copy |
| `timestamptz` | `datetime(3)`, UTC by convention | DATETIME (not TIMESTAMP) to dodge the 2038 range cap |
| `text` (indexed/unique/short) | `varchar(n)` | MySQL can't index/unique a TEXT without a prefix |
| `text` (long free text) | `text` | non-indexed only |
| `jsonb` | `json` | operators rewritten `->>` → `JSON_EXTRACT`/`JSON_UNQUOTE` |
| `pgEnum('x',[…])` reused | `mysqlEnum(col,[…])` from a shared `as const` array | enum is per-column in MySQL |
| partial unique `WHERE deleted_at IS NULL` | app-layer uniqueness check | MariaDB has no partial indexes |

## Stages (each ends green before the next starts)

- **Stage 1 — Schema.** Translate all 71 schema files pg-core→mysql-core; generate + apply
  the MariaDB DDL to `apar-one`; verify every table/column/index exists. *(walking skeleton
  first: `_shared` + `organizations` + `users` proven on the real DB, then fan out the rest.)*
- **Stage 2 — Query layer.** Rewrite `.returning()` (→ insert + re-select on `LAST_INSERT_ID`/id),
  `::` casts (→ `CAST`), `ON CONFLICT` (→ `ON DUPLICATE KEY UPDATE`), `FILTER(WHERE)`
  (→ `SUM(CASE WHEN …)`), `date_trunc`/`to_char`, jsonb operators. Swap the db client to
  `drizzle-orm/mysql2`.
- **Stage 3 — Integrity → app code.** Reimplement the 42 triggers / 38 functions as
  application services **while still on Postgres** (verify parity against the DB triggers),
  then the dialect switch simply drops the now-redundant DB enforcement. Covers: audit trail,
  ledger balanced/immutable postings, invoice/bill state-machine locks, polymorphic-FK checks.
- **Stage 4 — Security (RLS → app).** Map all 103 policies to app-layer filters + the existing
  capability RBAC / employee-portal scoping; verify per table that no data leaks.
- **Stage 5 — Auth.** Replace Supabase Auth with self-hosted sessions (login, password reset,
  middleware). Note: login UI is currently unbuilt (runs on the dev-admin fallback).
- **Stage 6 — Storage.** Replace the 4 Supabase buckets with protected filesystem storage on
  cPanel (signed-URL KYC reveal → app-served time-limited downloads); migrate existing files.
- **Stage 7 — Data.** Export Supabase Postgres → transform types → import to MariaDB.
- **Stage 8 — Host + cut over.** Deploy the standalone build to the cPanel Node app at
  aparone.apar.agency (DB over localhost), verify end-to-end, point DNS.
- **Stage 9 — Decommission Supabase.**

## Hard gate (blocks Stages 5–8)

cPanel must have the **"Setup Node.js App"** tile (Node 18.18+/20+). Unconfirmed. If absent,
the app can't run on GoDaddy shared hosting → small VPS instead. The DB work (Stages 1–4, 7)
is independent of this and can proceed now.
