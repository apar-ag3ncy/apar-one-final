# FRONTEND-OS-AUDIT.md

> Phase 0 audit of the existing Apār One **OS shell** (the macOS-style desktop
> demo), produced by the Frontend-OS agent on (intended) branch `agent/os`.
> **No code changes were made.**
>
> Repo head at audit time: `686bd22` — *Bootstrap Frontend Phase 1 prerequisites
> (Slices 1-4)* on `frontend/bootstrap-slices-1-4`. There are uncommitted
> dashboard-territory edits in the working tree from Session B's work; I left
> them untouched (see §S&A item 1).

---

## TL;DR

The OS shell is **demo-grade, complete, and almost entirely duplicative of the
Dashboard's entity rendering**. Every OS app — Clients, Vendors, Projects,
Employees, Inbox, Ledger, Reports, Settings — reads from its own localStorage
seed store (`data-store.ts`, `auth/vendor-store.ts`) and renders its own
profile/list/form UI inline in one 3,547-line file: `src/components/os/apps.tsx`.

That makes this audit's central finding simple:

> **Every OS app file with entity rendering is a Rule 47 violation.**
> The OS will need to be refactored to import from `components/entity/` once
> Session B extracts those components — `components/entity/` does **not exist
> yet**. The Dashboard ships its own per-module `*-detail-tabs.tsx`,
> `columns.tsx`, and `*-list.tsx` files. **Neither side imports the other**.

Other major gaps:

1. **No Zustand window store.** The window manager is inline `useState` inside
   `src/components/os/os-root.tsx` (`windows: WindowState[]`, `zTop: number`,
   `dockBounds`). The SESSION-C-OS spec mandates Zustand with a typed
   `openWindow`/`closeWindow`/etc. action surface.
2. **No per-window URL state.** Open windows + tabs persist via `localStorage`
   per user (`apar-os:session:${uid}`) — not via nuqs in the URL. Pasting an OS
   URL into Slack does not reproduce the user's open windows.
3. **No cross-window navigation API.** `openClientDetail` / `openVendorDetail`
   / `openReportDetail` are bespoke callbacks plumbed through `OsRoot` only.
   There is no `openWindow({ app, entityId, tab, position })`,
   no `position: 'beside-focused'`, no `<EntityRef onNavigate>` integration.
4. **No Framer Motion.** All animations are pure CSS (`os.css` — referenced
   but not yet read for this audit). Opening, minimising, dragging are
   `setTimeout`-driven CSS-class swaps in `os-root.tsx` / `window.tsx`.
5. **Auth/RBAC is the OS's own model**, not the six-role spec. The OS uses
   `Role = 'super_admin' | 'admin' | 'user'` and a per-app
   `{ view, edit, delete }` matrix in localStorage. The spec mandates six
   roles + a capability matrix backed by `role_capabilities` (Backend's F2).
6. **Money is `number` (rupees), not `bigint` paise.** `os/format.ts` formats
   `n: number` directly. The Vendor/Invoice schema in `os/types.ts` uses
   `number` for subtotal/gst/tds/total. CLAUDE.md rule #1 is violated
   throughout the OS demo, though no money is persisted to the DB yet.
7. **`document.body.style.overflow = 'hidden'`** runs once in `OsRoot`'s
   `useEffect`. The OS owns the whole viewport (correct), but the hijack
   leaks across `(auth)` ↔ `(os)` ↔ `(app)` route-group navigation if a user
   bounces between them; the cleanup function restores `prev` but only on
   unmount of `OsRoot`.

Importantly: nothing in the OS shell is **dangerous** in a P0-security sense
(no Supabase client-side calls, no service-role key usage, no plaintext
PAN/Aadhaar). The risk is **structural debt** that compounds every day until
the refactor lands.

---

## Section 1 — Inventory

### 1.1 Repo layout (relative to `apar-dashboard/`)

The OS lives under one route group and one component subtree:

```
src/
├── app/
│   └── (os)/
│       ├── layout.tsx            ← passthrough layout (no chrome)
│       └── os/
│           ├── page.tsx          ← <OsRoot /> mount point
│           └── os.css            ← all desktop / window / dock styles
├── components/
│   └── os/
│       ├── os-root.tsx           ← THE window manager + app dispatcher (606 LOC)
│       ├── window.tsx            ← <Window> chrome + drag/resize (160 LOC)
│       ├── dock.tsx              ← Dock with magnification + context menu (166 LOC)
│       ├── menubar.tsx           ← Apple-style menu bar (227 LOC)
│       ├── command-palette.tsx   ← Cmd+K palette (107 LOC)
│       ├── icons.tsx             ← shared icon set (Lucide aliases)
│       ├── format.ts             ← formatINR(number), initials() (17 LOC) ⚠️
│       ├── types.ts              ← OS domain types (174 LOC)
│       ├── data.ts               ← APPS registry + sample CLIENTS/VENDORS/… (read-only seed)
│       ├── data-store.ts         ← shared localStorage business-data store (368 LOC)
│       ├── apps.tsx              ← ALL app + detail UI (3,547 LOC) ⚠️ THE giant
│       └── auth/
│           ├── types.ts          ← Role/Permissions/User (81 LOC) — own RBAC model
│           ├── store.ts          ← useAuth() + localStorage backing (371 LOC)
│           ├── session-store.ts  ← per-user settings + window snapshot (156 LOC)
│           ├── vendor-store.ts   ← per-user vendor/invoice/document overlay (266 LOC)
│           ├── lock-screen.tsx   ← sign-in UI (152 LOC)
│           └── admin-console.tsx ← user CRUD + capability matrix (606 LOC)
```

`components/entity/` does not exist anywhere yet — neither the Dashboard nor
the OS imports from it.

### 1.2 OS shell — desktop, dock, menubar, window host, window chrome, palette

| Concern | File | Notes |
|---|---|---|
| Mount point | `src/app/(os)/os/page.tsx` | Server Component, renders `<OsRoot />` and pulls in `os.css`. |
| Layout | `src/app/(os)/layout.tsx` | Empty passthrough — no shared chrome. Deliberate so the OS owns the viewport. |
| Root | `src/components/os/os-root.tsx` | `OsRoot` → `Desktop` (key'd by user id). Gates desktop behind sign-in (`useAuth().currentUser`). Owns all window-manager state. |
| Window host (open/close/focus/drag/resize) | `src/components/os/os-root.tsx` (state) + `src/components/os/window.tsx` (chrome + drag) | Cooperating pair. Window owns its drag/resize listeners; OsRoot owns positions. |
| Window chrome | `src/components/os/window.tsx` | Title bar with traffic-light buttons, opening/closing/minimising animation classes, resize handle bottom-right. Origin CSS vars `--origin-x`, `--target-x`, `--target-y` plug into `os.css` keyframes. |
| Dock | `src/components/os/dock.tsx` | macOS-style magnification (sigma scaled to `itemSize`), running-app indicator, right-click context menu (Open / Quit / Show All Windows / Options stub), per-item bounds registered via `useLayoutEffect` so window-open animations can fly out of the right icon. |
| Menu bar | `src/components/os/menubar.tsx` | File/Edit/View/Window/Help menus (mostly stubs), live clock (`en-IN` 24h), user chip dropdown with Sign Out, Close-all quick action. |
| Command palette | `src/components/os/command-palette.tsx` | Cmd/Ctrl+K toggle (handled in OsRoot), substring filter, arrow + Enter selection, Esc to close. Actions assembled in `OsRoot.actions` from `APPS` + theme toggle + per-cap quick actions (`New Client`, `New Vendor`, etc.) + `Sign out`. **Cmd+K palette is OS-only**; Dashboard has no equivalent yet (per `nav-config.ts`). |
| Desktop icons | inline in `OsRoot` | Renders the first six visible apps as desktop icons when no windows are open. |
| Welcome hint | inline in `OsRoot` | Auto-dismissed after 7.5 s on a clean sign-in. |

### 1.3 OS apps — every app under `src/components/os/apps.tsx`

All app shells **and** their detail views live in a single 3,547-line client
component file. Exports (verified by grep `^export function`):

| Export | Lines | Renders | localStorage source of truth |
|---|---|---|---|
| `ClientsApp` | 136–312 | client table (search + New Client) | `data-store.ts` → `apar-os:business-data` |
| `ClientDetail` | 443–892 | header + 5-tab profile (Overview / Contacts / Projects / Documents / Ledger) | same, plus per-component `useState` for contacts/docs |
| `VendorsApp` | 911–1086 | vendor table (search + New Vendor) | `vendor-store.ts` → `apar-os:vendors:${uid}` |
| `VendorDetail` | 1094–1553 | header + 4-tab profile (Overview / Invoices / Documents / Ledger) | `vendor-store.ts` |
| `ProjectsApp` | 2099–2301 | Kanban-ish board (Proposed / Active / Review / Completed) | `data-store.ts` |
| `EmployeesApp` | 2446–2590 | employee grid | `data-store.ts` |
| `InboxApp` | 2678–2836 | extraction-queue list (Approve / Reject; "Approve" posts to ledger) | `data-store.ts` |
| `LedgerApp` | 2935–3041 | flat transactions table (search + dir filter) | `data-store.ts` |
| `ReportsApp` | 3047–3083 | KPI grid with sparklines | `data.ts` (read-only) |
| `ReportDetail` | 3311–3397 | one-report drill window with `recharts` area chart | static fixtures |
| `SettingsApp` | 3399–3545 | sidebar (General / Appearance / Account / Team / Notifications / Security) — only Appearance is real; others are placeholder cards | per-user `session-store.ts` settings |
| `AdminConsole` | `auth/admin-console.tsx` 1–606 | super-admin-only user CRUD + per-user × per-app `{view, edit, delete}` matrix | `auth/store.ts` |

Each `*App` is dispatched by `Desktop.renderBody()` (`os-root.tsx:457-534`)
on `w.app` discriminator, or — for "detail" windows — on `w.detailKind`
(`client | vendor | report`). `Project` and `Employee` detail windows do not
exist; clicking those entities is no-op or scoped to the list.

Forms + modals (also in `apps.tsx`): `ClientFormModal`, `VendorFormModal`,
`InvoiceFormModal`, `DocumentFormModal`, `ProjectFormModal`,
`EmployeeFormModal`, `NewInboxDocModal`, `AddContactModal`,
`UploadClientDocModal`, `RecordTxModal`, plus shared `Modal`, `ConfirmDialog`,
`EmptyState`, `Field`, `Status`, `Kpi`, `Sparkline`. None are exported; they
live as private helpers inside `apps.tsx`.

### 1.4 Window manager

| Concern | Where | Shape |
|---|---|---|
| Store | `useState` inside `Desktop()` in `os-root.tsx` | Not Zustand. Two pieces of state: `windows: WindowState[]` and `zTop: number`. |
| Window state shape | `src/components/os/types.ts:145-164` | `{ id, app, title, x, y, w, h, z, isMinimized, isMaximized, opening, preX?, preY?, preW?, preH?, detailKind, detailData }` — 14 fields, exceeds the SESSION-C-OS-BROWNFIELD soft cap of 12 (mostly because of pre-maximize bookkeeping + the demo-only `detailData` blob). |
| Actions | `os-root.tsx:178-315` | `focusWindow`, `openApp(appId, opts)`, `closeWindow`, `closeAllWindows`, `minimizeWindow`, `maximizeWindow`, `moveWindow`, `resizeWindow`, `openClientDetail`, `openReportDetail`, `openVendorDetail`. Not a Zustand `OsStore` — they're loose `useCallback`s closed over `setWindows`. |
| Z-order | monotonically increasing `zTop`; bump on focus, decrement never. Window state stores its own `z`. |
| Cascade / position | inline arithmetic in `openApp` (`os-root.tsx:199-204`) — `offsetCount % 5` × 30 px. No `position: 'center' \| 'cascade' \| 'beside-focused'` option. |
| Multi-instance | `opts.alwaysNew` (`os-root.tsx:191-197`) controls whether `openApp` reuses an existing non-detail window. Detail windows always open new. |
| Snap | not implemented (no half-screen / quarter-screen drag-to-edge). |
| Drag / resize | `window.tsx:67-97` adds global `mousemove`/`mouseup` listeners while a drag is in flight. Bounds clamp to (8, 30) ↔ viewport minus dock area. |
| Minimize / maximize | `os-root.tsx:236-267`; maximise stashes pre-max rect in `preX/preY/preW/preH`. Restore reads those back. |
| Persistence | `auth/session-store.ts:108-146` writes `{ windows, zTop, savedAt }` to `apar-os:session:${uid}` on every change; loaded on `Desktop` mount via `useMemo`. |

### 1.5 Animations

- **Framer Motion: not used.** No `motion`, no `AnimatePresence`, no
  `layoutId`. Genie / spring open / dock bounce is all CSS keyframes inside
  `os.css` (referenced but not yet read in this audit) gated by class swaps:
  `window.opening`, `window.closing`, `window.minimizing`, `dock-item`
  `transform: scale(...)` interpolated by JS in `dock.tsx:91-98`.
- **Open animation origin:** `window.tsx:108-122` derives CSS custom
  properties `--origin-x`, `--target-x`, `--target-y` from the dock-item
  bounds the dock registers via `useLayoutEffect`. Closes use the same in
  reverse via the `closing` class.
- **Drag inertia:** none.
- **Backdrop-filter** is referenced in CSS but I have not verified depth /
  nesting; SESSION-C-OS-BROWNFIELD warns against nested `backdrop-filter` —
  flagging for the Phase-2 perf check.
- **Reduce Motion:** a `Reduce Motion` toggle exists in
  `SettingsApp` (`apps.tsx:3515-3521`) but is **not wired** to anything — the
  toggle has no state and no `onClick` (a Rule 47 lookalike: visual UI
  without a backing setting).

### 1.6 URL state

- **None of the window state is in the URL.** `pathname` is just `/os`.
  Refreshing on `/os` restores the session because of localStorage (per-user
  key `apar-os:session:${uid}`), not because the URL describes the state.
- nuqs is installed (used by Dashboard's `UrlTabs` in
  `components/shared/url-tabs.tsx:1-86`) but is **not used anywhere in
  `src/components/os/`**. Grep confirms zero `nuqs` imports under `os/`.
- The SESSION-C-OS-BROWNFIELD target shape is
  `?windows=w1,w2,w3&w1=clients:abc:overview&w2=vendors:def:transactions&w3=settings::roles`
  — that is **net-new Phase 2 work**, not a tweak to existing logic.

### 1.7 RBAC, sign-in, sign-out

- `src/components/os/auth/store.ts` is a full localStorage-backed
  `useAuth()` hook with `signIn / signOut / createUser / updateUser /
  deleteUser / setPermissions / resetAllPermissionsTo / updateSuperAdmin`.
  No password hashing, no JWT, no server. Plaintext credentials in
  `apar-os:users` / `apar-os:super-admin`.
- Role enum: `'super_admin' | 'admin' | 'user'` (3 roles).
- Capability shape: per-app `{ view, edit, delete }` (3 actions) for the 8
  permissioned apps. The super_admin bypasses the matrix entirely.
- This is **not the six-role × capability-matrix model** SESSION-COORDINATION
  / CLAUDE.md mandate (`partner | admin | manager | accountant | employee |
  viewer`; capability strings). On wire-up to Backend's `role_capabilities`,
  the OS RBAC will need to be replaced wholesale — see §3 P1.

### 1.8 Wiring status (mocked vs hits A's endpoints vs Supabase)

| OS file | Calls Supabase? | Calls A's actions? | Backed by | Replacement target |
|---|---|---|---|---|
| `data-store.ts` | ❌ | ❌ | `apar-os:business-data` localStorage | `getClient` / `listClients` / `createClient` / etc. server actions when A ships them |
| `auth/store.ts` | ❌ | ❌ | `apar-os:users` localStorage + plaintext password match | Supabase Auth + RLS (F6 + F7) |
| `auth/session-store.ts` | ❌ | ❌ | `apar-os:settings:${uid}`, `apar-os:session:${uid}` localStorage | partly stays (per-window URL state replaces session snapshot); settings move to `user_settings` table TBD |
| `auth/vendor-store.ts` | ❌ | ❌ | `apar-os:vendors:${uid}` localStorage + per-seed-vendor `removed[]` tombstones + `edits` overlay | Drizzle queries for `vendors`, `vendor_invoices`, `entity_documents` |
| `apps.tsx` (all 11 exports) | ❌ | ❌ | the three localStorage stores above | refactor onto `components/entity/` once B ships them |
| `os-root.tsx`, `dock.tsx`, `window.tsx`, `menubar.tsx`, `command-palette.tsx`, `icons.tsx`, `format.ts`, `types.ts`, `data.ts` | ❌ | ❌ | static / in-memory | OS chrome stays largely as-is; `format.ts` swaps to `@/lib/money` once A ships it |
| `auth/admin-console.tsx`, `auth/lock-screen.tsx` | ❌ | ❌ | `useAuth()` localStorage | RBAC matrix UI moves to B's `components/entity/RoleCapabilityMatrix` (Settings window embeds); lock-screen moves to Supabase Auth magic-link flow |

Bottom line: **nothing in the OS is wired to the database or to any server
action.** Every read is from a localStorage-backed in-memory store.

---

## Section 2 — Duplication check (the critical one)

This is the section the brief asks me to nail. I'm cross-referencing every
entity-rendering concept against the OS (`src/components/os/apps.tsx` unless
noted) and the Dashboard (`src/components/<module>/` and `src/app/(app)/`).
**`components/entity/` does not exist yet on either side**, so every row
below identifies work for B's Phase 1 (extract) and my Phase 1 (replace).

| Concept | OS file | Dashboard file | Duplicated? | Notes |
|---|---|---|---|---|
| Client list (table view) | `apps.tsx` `ClientsApp` (136–312): hand-rolled `<table>` with row hover + delete | `components/clients/{clients-list.tsx, columns.tsx, types.ts}` (TanStack `<DataTable>`) | **YES, complete divergence** | OS rolls its own table; Dashboard uses the reusable `<DataTable>` with sort/filter/CSV. Refactor target: `components/entity/EntityList` wrapping `<DataTable>` with per-entity `ColumnDef`. |
| Client profile header | `apps.tsx` `ClientDetail` 481–564 (avatar + title + status pills + tab-aware action buttons) | `app/(app)/clients/[id]/page.tsx` → `<DetailHeader>` (`components/shared/detail-header.tsx`) + `<StatusBadge>` | **YES** | Both render the same idea: title, status pill, optional subtitle, action buttons on the right. Refactor target: `components/entity/ProfileHeader`. OS needs `onClose` callback (close-window); Dashboard needs `backHref`/`backLabel`. |
| Client profile tabs (Overview / Contacts / Projects / Documents / Ledger) | `apps.tsx` `ClientDetail` 565–809 | `components/clients/client-detail-tabs.tsx` (`UrlTabs`) | **YES** | Same five tabs, same intent. OS uses `useState<ClientTab>`; Dashboard uses `nuqs` `?tab=`. Refactor target: `components/entity/ProfileTabs` taking `activeTab` + `onTabChange` props so OS plugs window state and Dashboard plugs nuqs. |
| Contact list | `apps.tsx` `ClientDetail` 627–667 (avatar grid, seed `SEED_CONTACTS`) | `components/clients/client-detail-tabs.tsx` `ContactsTab` 99–152 (`<Table>` with name/title/email/phone/primary cols) | **YES, two shapes** | OS has fewer fields (name/role only); Dashboard has the full POC model. Refactor target: `components/entity/ContactList`. Dashboard shape is closer to the eventual `entity_contacts` table; OS will need to widen its contact data. |
| Bank account list | ❌ does not exist anywhere | ❌ does not exist anywhere | n/a | Neither side has built this yet. Refactor target: `components/entity/BankAccountList` (B builds), embed everywhere. |
| Document list | `apps.tsx` `ClientDetail` 696–767 (grid of "pdf-thumb" cards with delete) AND `VendorDetail` 1332–1418 (similar grid, with edit + delete + kind label) | `components/shared/tab-placeholders.tsx` `DocumentsTabPlaceholder` (placeholder only — empty state with count) | **YES**, twice on the OS side, once-as-placeholder on the Dashboard | Refactor target: `components/entity/DocumentList`. Phase 1 of B extracts a real one (currently the Dashboard ships a placeholder); OS imports it. |
| Transaction list / ledger | `apps.tsx` `LedgerApp` 2935–3041 (flat table) + `ClientDetail.Ledger` 770–807 (client-filtered) + `VendorDetail.Ledger` 1419–1449 (vendor-filtered) | `app/(app)/ledger/page.tsx` (empty-state placeholder only) | **YES — three OS copies, no Dashboard real one** | Refactor target: `components/entity/TransactionList` (B builds). OS plugs an `entityType`/`entityId` filter prop and embeds the same component three places. |
| Activity feed | `apps.tsx` `ClientDetail.Overview` 595–625 (hardcoded "Invoice sent / Creative approved / SOW shared" rows) | `components/shared/tab-placeholders.tsx` `ActivityTabPlaceholder` (placeholder only) | **YES, OS only; Dashboard is placeholder** | Refactor target: `components/entity/ActivityFeed`. |
| Forms (entity creation / edit) | `apps.tsx` `ClientFormModal`, `VendorFormModal`, `InvoiceFormModal`, `DocumentFormModal`, `ProjectFormModal`, `EmployeeFormModal` (all inline; no schema validation; raw `<input>`/`<select>`) | (Dashboard has no real form yet — pages call `<StubAction>` placeholders) | **YES, OS only** | Refactor target: `components/entity/<Type>Form` wrapping React Hook Form + Zod (per AGENT-FRONTEND.md). OS dumps its own modals and imports B's. |
| Cmd+K palette | `src/components/os/command-palette.tsx` + actions assembled in `OsRoot.actions` (`os-root.tsx:327-381`) | none yet (`nav-config.ts` is purely sidebar nav) | **NO yet** — only OS has one; Dashboard will need to build its own version | Shared-data target: a `/api/search` endpoint A builds, both palettes consume. OS's palette is *chrome* (stays in `components/os/`); Dashboard will build its own. Two palettes, one data source. |
| Status pill | `apps.tsx` `Status` 83–91 (string keyed in `STATUS_TONE`) | `components/shared/status-badge.tsx` `<StatusBadge>` | **YES (low value but worth noting)** | Visual divergence is small. Refactor target: drop OS's `Status` and import `<StatusBadge>` from B (it lives in `components/shared/` already, accessible to both). |
| Empty state | `apps.tsx` `EmptyState` 1559–1609 (own styles, inline icon, optional action) | `components/shared/empty-state.tsx` | **YES** | Refactor target: import the Dashboard's `EmptyState` from `components/shared/`. |
| Modal | `apps.tsx` `Modal` 1611–1647 + `ConfirmDialog` 1651–1694 (own overlay + ESC + cancel buttons) | `components/ui/dialog.tsx` (shadcn) + `components/ui/alert-dialog.tsx` (shadcn) | **YES** | Refactor target: use shadcn dialogs (already in `components/ui/`). |
| Currency formatter | `os/format.ts` `formatINR(n: number)` (rupees → `₹1,23,456` string) | `components/shared/format-inr.ts` (paise-aware) | **YES, AND a hard money-rule violation** | Refactor target: `@/lib/money` (Backend ships per F1). OS must move to `bigint` paise. **CLAUDE.md rule #1.** |
| Sparkline / Kpi | `apps.tsx` `Sparkline` 39–67, `Kpi` 93–122 | `components/charts/*` (Recharts wrappers — `money-bar-chart`, `money-line-chart`, `chart-card`) | **PARTIAL** | OS's tiny SVG sparkline is OS-specific chrome; not necessarily worth sharing. The `Kpi` card is duplicative — Dashboard will likely build its own as part of `app/(app)/page.tsx` KPI work. Refactor target: `components/entity/KpiCard` or move into `components/charts/`. |
| Pdf-thumb placeholder | `apps.tsx` many places (`pdf-thumb` div with line stripes) | none | OS-only chrome (acceptable until real previews ship) | Refactor target: `components/entity/DocumentList` should use real thumbs once A ships signed URLs / `revealKyc`. |
| Status pill colors | `apps.tsx` `STATUS_TONE` 69–81 (hand-rolled keys) | `components/shared/status-badge.tsx` `StatusTone` enum + per-module `*_TONES` maps (`CLIENT_STATUS_TONES`, `CLIENT_PRIORITY_TONES`, `VENDOR_*` etc.) | **YES** | Refactor target: drop OS's `STATUS_TONE`, use the Dashboard maps. |

#### Forms-only details

The Dashboard has **no real entity forms yet** (every "Edit" / "Add" button
is a `<StubAction>`). The OS has full create-and-edit modals for every
entity. When B starts Form Builder (B's Phase 1 target), there's a useful
question: **do B's forms try to consume the OS modals' field lists as
reference?** I think yes — they capture the agency's actual brief better
than any AUDIT-GAPS spec we currently have. Flagging for §6 coordination.

#### Auth UI

| Concept | OS file | Dashboard file | Duplicated? |
|---|---|---|---|
| Lock screen | `auth/lock-screen.tsx` (152 LOC) | `app/(auth)/login/login-form.tsx` (Supabase magic-link + Google stubs) | **NO — divergent shells** |
| Admin console (per-user × per-app matrix) | `auth/admin-console.tsx` (606 LOC) | none | OS-only |
| User chip dropdown | `menubar.tsx:179-221` + Dashboard sidebar `user-menu.tsx` | `components/shared/user-menu.tsx` | divergent |

Both auth UIs will be **replaced** in Phase 3+ once A wires Supabase Auth.
The OS's admin console maps roughly to B's eventual `components/entity/RoleCapabilityMatrix`.

---

## Section 3 — Coverage matrix against OS-specific needs

Legend: ✅ done · ⚠️ partial / needs rework · ❌ missing.

| Required | Status | Where | Notes |
|---|---|---|---|
| Window manager (open/close/focus/drag/resize/z-index/snap) | ⚠️ | `os-root.tsx` + `window.tsx` | All present **except snap to half/quarter screen**. Inline `useState`, not Zustand. Spec asks for Zustand. |
| Multi-window support (multiple instances of same app) | ⚠️ | `os-root.tsx:191-197` (`alwaysNew` opt) | Detail windows already always-new; non-detail apps can only have one instance. The spec's "open a vendor profile beside the current client profile" works **only for detail windows today**. |
| Cross-window navigation API (`openWindow({app, entityId, tab})`) | ⚠️ | `openClientDetail` / `openVendorDetail` / `openReportDetail` | Exists but **bespoke per entity** and **never reaches profile-from-profile navigation**. There is no Project or Employee detail window at all. No `position: 'beside-focused'`. |
| Per-window URL state encoding | ❌ | n/a | Session snapshot is localStorage. nuqs not used in OS. Net-new. |
| Dock with capability-gated app visibility | ✅ | `os-root.tsx:173-176` (`visibleApps = APPS.filter(can(user, a.id, 'view'))`) + `dock.tsx` | Hides apps the user can't see (good). Note the OS's `can(user, appId, action)` is OS-RBAC, not Backend RBAC — will need swap. |
| Cmd+K palette inside OS | ✅ | `command-palette.tsx` + `os-root.tsx:159-170` (`Cmd/Ctrl+K` toggle) | Actions assembled per cap. **Backed by static lists, not `/api/search`** — that's net-new in Phase 3. |
| Window minimize/maximize/genie effects | ✅ | `window.tsx` (`minimizing`/`closing` classes; CSS keyframes drive the genie) | Pure CSS, not Framer Motion `layoutId`. Works. |
| Frosted glass / blur effects | ⚠️ | `os.css` (not read in this audit; visually present in the screenshots under `apar-dashboard/.screenshots/os-*.png`) | Confirm no nested `backdrop-filter` in Phase-2 perf check. |
| Clients/Vendors/Employees app shells | ⚠️ duplicative | `apps.tsx` `ClientsApp`, `VendorsApp`, `EmployeesApp` | Shells exist; entity rendering is duplicative (§2). |
| Projects app shell | ⚠️ | `apps.tsx` `ProjectsApp` | Kanban-style board; **no project detail window**. |
| Inbox app (extraction review queue, Phase 3 placeholder) | ⚠️ | `apps.tsx` `InboxApp` | Demo-grade Approve/Reject pair. Approve currently posts a fixed ₹1,00,000 ledger entry — placeholder. |
| Ledger app (transaction list + reports) | ⚠️ | `apps.tsx` `LedgerApp` | Flat table + dir filter. No drill-into-transaction. No source-document preview. No bank reconciliation. |
| Reports app | ⚠️ | `apps.tsx` `ReportsApp` + `ReportDetail` | 9 KPI sparkline cards. Drills into a recharts area chart with static-fixture data. No drill-to-postings. No cross-window navigation to client/vendor/employee. |
| Settings app | ⚠️ | `apps.tsx` `SettingsApp` | Only the **Appearance** section is functional; General / Account / Team / Notifications / Security are placeholder cards. No Form Builder, no capability matrix (that lives in `auth/admin-console.tsx`), no tax rates, no bank accounts, no period management. |
| Admin Console (super-admin only) | ✅ | `auth/admin-console.tsx` | Full user CRUD + per-app permission matrix. Will be replaced when Backend wires capabilities. |
| Statement-of-account window | ❌ | n/a | Net-new in Phase 4. |
| Bank reconciliation window | ❌ | n/a | Net-new in Phase 4. |
| Statement / Transaction detail window | ❌ | n/a | Net-new in Phase 4. The OS has no transaction-detail window — clicking a ledger row does nothing. |

---

## Section 4 — Wiring status

Already summarised in §1.8. To restate concisely:

- **Mocked:** every list, every detail, every form. Three localStorage
  stores carry all state (`apar-os:business-data`, `apar-os:vendors:${uid}`,
  `apar-os:users` + `apar-os:session:${uid}` + `apar-os:settings:${uid}` +
  `apar-os:super-admin`).
- **Hits old endpoints:** none. No `/api/*` routes are called.
- **Calls Supabase directly:** none. `@supabase/ssr` and
  `@supabase/supabase-js` are **not installed** (per BACKEND-AUDIT.md
  Section 4 item 7).
- **OS-specific data the OS owns indefinitely:** open-windows state + tabs
  + dock prefs + theme. Everything else is entity data that moves to
  Backend.

There is therefore **no risky direct-DB / direct-Supabase code to undo**.
All wiring is greenfield — write the React-Query / server-action layer
fresh, swap each store's reads to it, leave the writes for last.

---

## Section 5 — Risk-ranked plan

### 🔴 P0 — Must fix before any feature work

These are spec-violating issues the OS demo introduced. None are
*security* P0s (no DB / Supabase code in client land); they're
**rule-violation P0s**.

| # | Issue | Effort | Files | Breaks UI? |
|---|---|---|---|---|
| P0-1 | **OS uses `number` (rupees) for money everywhere.** `os/format.ts:formatINR(n: number)`, `os/types.ts` (`Vendor.outstanding: number`, `VendorInvoice.{subtotal,gst,tds,total}: number`, `Project.fee: number`, `LedgerTx.amount: number`, `Report.spark: number[]`). CLAUDE.md rule #1 is violated. | M | `os/format.ts`, `os/types.ts`, `os/data.ts`, every form modal in `apps.tsx`, `apar-os:business-data` localStorage seed | All money displays change format; values in localStorage need a one-time migration (multiply by 100). |
| P0-2 | **No defense-in-depth on the `(os)` route:** anyone hitting `/os` enters the localStorage-auth OS even if they aren't a real Supabase user yet. Once Supabase Auth is wired (A's F6), `(os)/layout.tsx` must gate on `currentUser()` server-side, just like `(app)`. | S | `src/app/(os)/layout.tsx` | Adds a redirect to `/login` when no session. |
| P0-3 | **`document.body.style.overflow = 'hidden'` race.** `OsRoot` hijacks page scroll; cleanup runs only on `OsRoot` unmount. If a user navigates from `/os` to `/clients` *without* the route group unmounting (e.g. via a `<Link>`), scroll stays hidden. Either move the side-effect to a route segment with an explicit cleanup boundary, or detect the route transition in a `useEffect`. | S | `os-root.tsx` | None visible; protects future navigation. |

P0 has **no Supabase-from-client fix** because Supabase isn't called from
anywhere in OS yet. P0 has **no plaintext-PII fix** because no PII is
stored in OS state (the Vendor model captures GSTIN/PAN, which CLAUDE.md
rules treat as B2B-acceptable per BACKEND-AUDIT.md §4 item 6).

### 🟠 P1 — Duplication with Dashboard (extract to shared once B's audit finds it)

Every row here depends on B's Phase 1 shipping `components/entity/<X>`.
For each I'll: (a) replace the OS local copy with `import { … } from
'@/components/entity'`, (b) pass `onNavigate={(target) => openWindow(target,
{ position: 'beside-focused' })}` instead of a router push, (c) plumb
window-state-aware tab callbacks.

| # | Shared component B should extract | OS local copy to delete | Dashboard local copy to fold in | Notes |
|---|---|---|---|---|
| P1-1 | `ProfileHeader` | `apps.tsx:481-564` (ClientDetail header), `apps.tsx:1128-1218` (VendorDetail header) | `components/shared/detail-header.tsx` | Needs both `backHref/backLabel` (Dashboard) and `onClose` (OS) wired through a single `onBack` prop. |
| P1-2 | `ProfileTabs` | `apps.tsx:565-575` (Client tab strip), `apps.tsx:1220-1232` (Vendor tab strip) | `components/shared/url-tabs.tsx` (already nuqs-based) | OS wraps with window-state-backed `activeTab` + `onTabChange`; Dashboard wraps with nuqs. |
| P1-3 | `ContactList` | `apps.tsx:627-667` | `components/clients/client-detail-tabs.tsx:99-152` | Widen OS contact shape to match Dashboard's full POC. |
| P1-4 | `DocumentList` | `apps.tsx:696-767` (client docs), `apps.tsx:1332-1418` (vendor docs) | `components/shared/tab-placeholders.tsx` (placeholder today) | Add `entityType` / `entityId` props for filtering. |
| P1-5 | `TransactionList` | `apps.tsx:770-807` (client-filtered), `apps.tsx:1419-1449` (vendor-filtered), `apps.tsx:2935-3041` (full ledger) | `app/(app)/ledger/page.tsx` (empty-state today) | Required for Phase 4 ledger work too — this is the biggest unlock. |
| P1-6 | `ActivityFeed` | `apps.tsx:595-625` (hard-coded) | `components/shared/tab-placeholders.tsx` (placeholder today) | OS removes the hard-coded list; both sides render from one prop. |
| P1-7 | `EntityRef` + `EntityHoverCard` | inline `<Link>` in `project-detail-tabs.tsx:62-69` (Dashboard) | n/a in OS | Needed for the cross-window-nav workflow ("click a client in the project profile"). |
| P1-8 | `StatusBadge` | OS's `Status` (`apps.tsx:83-91`) + `STATUS_TONE` (`apps.tsx:69-81`) | `components/shared/status-badge.tsx` (already exists) | Already shared-ish — OS just needs to import it. |
| P1-9 | `EmptyState` | `apps.tsx:1559-1609` | `components/shared/empty-state.tsx` (already exists) | OS imports B's. |
| P1-10 | `<Modal>` + `<ConfirmDialog>` | `apps.tsx:1611-1694` | `components/ui/dialog.tsx`, `components/ui/alert-dialog.tsx` (shadcn) | OS swaps to shadcn primitives. |

### 🟡 P2 — Wire windows to A's server actions, replace mocked data

| # | Item | Effort | Notes |
|---|---|---|---|
| P2-1 | **Window manager → Zustand.** Move `windows` / `zTop` / `dockBounds` out of `Desktop()` into a single Zustand store at `lib/os/store.ts`. Action surface per SESSION-C-OS-BROWNFIELD §Phase 2. | M | Spec calls this out; today it's inline `useState`. |
| P2-2 | **`openWindow({ app, entityId?, tab?, position? })`** with `position: 'beside-focused' \| 'cascade' \| 'center'`. | M | Beside-focused is the OS's central UX. |
| P2-3 | **Per-window URL state.** Write `lib/url/per-window-nuqs.ts`. Encode windows + tabs in the URL; drop the localStorage session snapshot in favour. | M | Spec target. Keep settings (theme, dock size) in localStorage for now. |
| P2-4 | **Replace `data-store.ts` reads** with React Query against A's server actions for each entity, **as A ships them**. Writes follow. | L | Per-entity, one at a time. Cascade carefully so the OS doesn't go blank between commits. |
| P2-5 | **Replace `vendor-store.ts`** with `vendors` + `vendor_invoices` + `entity_documents` queries; drop the seed-overlay model entirely. | L | Same. |
| P2-6 | **Replace OS RBAC** (`auth/store.ts` + `auth/types.ts`) with `useUser()` reading from Supabase Auth + `useCapabilities()` reading from `role_capabilities`. Keep the `<LockScreen>` UI shape (it's nice) but back it with Supabase magic-link. The Admin Console matrix gets re-skinned around the new capability model. | L | Touches lots of files; do once the rest is wired. |
| P2-7 | **OS-only telemetry / persistence** of preferred window sizes per app per user. Optional; nice-to-have. | S | Stays in localStorage. |

### 🟢 P3 — Net-new

| # | Item | Notes |
|---|---|---|
| P3-1 | **Ledger app real:** transaction-detail window with side-by-side source document. Embeds B's `<TransactionDetail>`. Phase 4. |
| P3-2 | **Per-Client P&L window** + drill-through-multiple-windows workflow. Phase 4. |
| P3-3 | **Statement of Account window** opened from any entity profile's Ledger tab. Phase 4. |
| P3-4 | **Bank reconciliation window** (drag-to-match). Phase 4. |
| P3-5 | **Reports app real:** opens one report per window; drill-down opens another window beside; embeds B's `<EntityRef>`. Phase 4. |
| P3-6 | **Cmd+K palette → `/api/search`** instead of static action lists. Phase 3 once A ships the search endpoint. |
| P3-7 | **Framer Motion** for window open / minimise / drag inertia / dock bounce / focus shadow — replace CSS-keyframe-class-swap pattern. Phase 2 polish. |
| P3-8 | **Snap-to-edge** drag behaviour (half-screen, quarter-screen). Phase 2. |
| P3-9 | **Project detail window** + **Employee detail window** — neither exists today. |
| P3-10 | **Settings → Form Builder embed**, **Capability matrix embed**, **Tax rates**, **Bank accounts**, **Period management** — five real settings sections embedding B's UIs. |

---

## Section 6 — Coordination notes for Session B

These are the things my audit found that affect B's Phase 1 extraction plan:

1. **`<ProfileHeader>` needs both `backHref/backLabel` (Dashboard) AND
   `onBack` callback (OS).** Concrete shape proposal:
   `back: { href: string; label: string } | { onClick: () => void; label: string }`.
   Either / or. Don't bake `next/navigation` into the component.

2. **`<ProfileTabs>` must not call `nuqs` internally.** Take `activeTab` +
   `onTabChange` as props. Dashboard wraps with `useQueryState`; OS wraps
   with window-state setter. Today the Dashboard's `<UrlTabs>` *does* call
   nuqs internally (`components/shared/url-tabs.tsx:34`) — that needs to be
   refactored when it moves to `components/entity/`.

3. **`<TransactionList>` is wanted by the OS in three places** (Client tab,
   Vendor tab, full Ledger). Please support an `entityFilter?: { type:
   'client' | 'vendor' | 'employee' | 'project'; id: string }` prop and a
   `null` / undefined = unfiltered case for the full Ledger window. Also
   please support a `onSelectTransaction?: (id) => void` callback so the OS
   can open a transaction-detail window beside (Phase 4) and the Dashboard
   can navigate to a detail route.

4. **`<EntityRef>` needs `onNavigate?: (target: NavigationTarget) => void`.**
   Default: Dashboard renders a `<Link href={…}>`. With `onNavigate` provided
   (OS case): renders a `<button>` calling `onNavigate({ type, id, tab? })`.
   No `useRouter` inside the component.

5. **`<DocumentList>` and `<BankAccountList>` need a `canReveal` /
   `onReveal` pair for KYC + bank — never inline the reveal; surface
   callbacks so the OS / Dashboard can pop the right confirm + audit-log
   wiring. OS-side: opens a confirm-dialog window. Dashboard-side: opens
   a shadcn `<AlertDialog>`. Both call the same server action via the
   callback.

6. **OS form modals are a better reference than the (absent) AUDIT-GAPS
   field lists.** Specifically `ClientFormModal` (`apps.tsx:322-418`),
   `VendorFormModal` (`apps.tsx:1732-1873`), `InvoiceFormModal`
   (`apps.tsx:1875-1996`), `DocumentFormModal` (`apps.tsx:1998-2097`),
   `ProjectFormModal` (`apps.tsx:2303-2444`), `EmployeeFormModal`
   (`apps.tsx:2592-2676`). They capture what fields Apār's operators
   actually want. When B starts the Form Builder schema, these are the
   intended field lists per entity.

7. **`<StatusBadge>` already lives in `components/shared/`** — when it moves
   to `components/entity/`, please keep an export path that doesn't break
   existing Dashboard imports.

8. **Cmd+K palette stays in `components/os/` and `app/(dashboard)/`
   respectively** (two palettes, one search endpoint). The OS palette's
   action assembly (`os-root.tsx:327-381`) is OS-specific — leave it.

9. **No new shared `<KpiCard>` / `<Sparkline>` extraction needed yet.** OS
   sparkline is OS-specific chrome. If/when Dashboard `app/(app)/page.tsx`
   adds KPIs, B picks whether to share — I won't pre-extract for them.

---

## Section S&A — Stop-and-ask list

I will not write any code beyond this audit until each item below is
resolved or explicitly waived.

1. **Branch + worktree mismatch.** SESSION-COORDINATION expects me on
   `agent/os` in a `~/apar-one-os` worktree, but the workspace is a single
   `apar-dashboard/` directory on branch `frontend/bootstrap-slices-1-4`,
   with ~50 modified files in the working tree (Session B's WIP). I will:
   - create branch `agent/os` from the current HEAD,
   - commit **only** `apar-dashboard/FRONTEND-OS-AUDIT.md` (this file) and
     `apar-dashboard/STATUS.md` (my OS section, separate commit if needed),
   - leave Session B's WIP untouched in the working tree.

   **Confirm this is what you want**, or tell me whether to branch off
   `master` (clean) instead and let the WIP stay on the current branch.

2. **`AUDIT-GAPS.md` is missing from the workspace.** Backend's audit
   already flagged this (BACKEND-AUDIT.md §4 item 1). I cannot finalise
   §2's "what does `components/entity/<X>` look like" without it. Two
   options:
   - **(a)** Share the doc. Until then, my §6 coordination notes are my
     best guess at the shared API.
   - **(b)** Tell me to treat SESSION-C-OS-BROWNFIELD §Phase 2 + this
     audit's §6 as the working spec until AUDIT-GAPS lands.

3. **`AGENT-FRONTEND.md` does not differentiate Dashboard vs OS.** It
   reads as if there is one frontend agent. SESSION-COORDINATION splits B
   and C, with C importing B's components. The two docs are consistent
   but not identical — I followed SESSION-COORDINATION + the brownfield
   spec where they go further. Flag if I should re-anchor on
   AGENT-FRONTEND.md.

4. **Path discrepancy (same as BACKEND-AUDIT §4 item 2).** The brief uses
   `app/os/apps/clients/ClientWindow.tsx` shape; the repo uses
   `src/components/os/apps.tsx` as one giant file. I will follow the repo
   layout and refactor (when Phase 1 starts) toward
   `src/components/os/apps/<entity>/<Entity>Window.tsx` per the brief.
   **Confirm.**

5. **Money refactor scope (P0-1).** Migrating the OS demo from `number`
   rupees to `bigint` paise is straightforward in code but breaks anyone's
   existing localStorage. Two options:
   - **(a)** Add a one-time migration on read: detect old shape, multiply
     by 100, write back.
   - **(b)** Bump the `STORAGE_KEY` namespace (`apar-os:business-data` →
     `apar-os:business-data:v2`) so old data is discarded silently.

   Default if no answer: **(a)** — least surprise.

6. **OS RBAC swap timing.** Replacing the OS's `super_admin/admin/user`
   model with the six-role + capability matrix is destructive to existing
   localStorage. I propose deferring it to **after** B ships
   `components/entity/RoleCapabilityMatrix` so the two land together. Flag
   if you want them sequenced differently.

7. **OS RBAC's `'admin'` app id collides with the SESSION-COORDINATION
   role name `admin`.** `os/types.ts` has `AppId = '…' | 'admin'` and
   `auth/types.ts` has `Role = '…' | 'admin'`. They're independent today
   (one is an app, one is a role). When we swap to the new RBAC, the
   "Admin Console" app needs a new id — proposing `admin_console` — so
   `app === 'admin'` doesn't read as `role === 'admin'`. Flag if the
   rename is OK.

8. **Wiring order.** SESSION-C-OS-BROWNFIELD says I should refactor to
   `components/entity/` (Phase 1) *before* wiring to A's actions
   (Phase 3). That assumes B ships shared components on a tighter cycle
   than A ships server actions. If A ships actions first (likely
   given the foundation gate), tell me whether to wire the OS to A's
   actions even while still calling its inline UI — or wait for B's
   extracts and bundle the two.

9. **No worktree, no daily merge.** SESSION-COORDINATION assumes a daily
   merge ritual the user runs. Today the repo has two branches and no
   merge automation. I'll assume daily-merge happens manually and won't
   try to merge anything myself. Flag if the cadence is different.

10. **`STATUS.md` location.** Backend put `apar-dashboard/STATUS.md` (not
    workspace-root `STATUS.md`). I'll follow that precedent and write to
    `apar-dashboard/STATUS.md`'s `## OS` section. Confirm.

---

## What I am *not* asking

To be explicit about what I'm comfortable doing without further questions
once this audit is approved:

- Create branch `agent/os` from current HEAD, commit this audit + STATUS
  section, push nothing remote.
- Phase-1 refactors that **replace** an OS local-UI block with an import
  from `components/entity/<X>` once B's matching component lands and the
  shared API matches my §6 proposal. Each refactor in its own commit per
  the brief's commit hygiene (`refactor: ClientWindow imports
  components/entity/ProfileHeader`).
- Wire `format.ts → @/lib/money` once A ships the helper.
- Replace OS's `Status` + `EmptyState` + `Modal` + `ConfirmDialog` with
  the existing Dashboard / shadcn primitives (these don't need B to
  extract; they already live in `components/shared/` or `components/ui/`).
- Create a Zustand store at `lib/os/store.ts` for the window manager (P2-1).
- Add per-window URL state at `lib/url/per-window-nuqs.ts` (P2-3).
- Add `openWindow({ position: 'beside-focused' })` support (P2-2).
- Add Project + Employee detail windows once B ships matching shared
  components.

I will **stop and ask** before:

- Renaming any file outside `src/components/os/`, `src/lib/os/`,
  `src/app/(os)/`.
- Editing anything in B's territory: `src/components/clients`,
  `src/components/vendors`, `src/components/projects`,
  `src/components/employees`, `src/components/data-table`,
  `src/components/charts`, `src/components/ui`, `src/components/shared`,
  `src/app/(app)/`, `src/app/(auth)/`.
- Editing anything in A's territory: `src/lib/db/`, `src/services/`,
  `src/app/api/`, `drizzle/`, `middleware.ts`, `tests/`.
- Touching `CLAUDE.md`, `LEDGER-SPEC.md`, `AUDIT-GAPS.md`,
  `docs/tasks/**`, `SESSION-*.md`.
- Force-pushing or using `--no-verify`.
- Anything that would weaken or bypass an RLS policy (none exist yet, but
  none will be touched).
- Adding a dependency. None expected for the audit's follow-on work
  except possibly `framer-motion` (P3-7) and `zustand` (P2-1) — both
  will be announced via `NEEDS DEP:` and stopped on.

---

*— Frontend-OS agent · branch `agent/os` (to be created) · no code changes
made yet*
