'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { APPS } from './data';
import { useBusinessData } from './data-store';
import { navigateBesideFocused } from './apps/navigate';
import { CompanySettingsPane } from './apps/company-settings-pane';
import { BillingSettingsPane } from './apps/billing-settings-pane';
import { VaultPane } from './apps/vault-pane';
import { ImportEmployeesDialog } from '@/components/employees/import-employees-dialog';
import { InvoiceFormatEditor } from '@/components/settings/invoice-format-editor';
import { EntityRef } from '@/components/entity/entity-ref';
import {
  listClients as listDbClients,
  listEmployees as listDbEmployees,
  listVendors as listDbVendors,
  listUsers as listDbUsers,
  listDepartments as listDbDepartments,
} from '@/lib/server-stub/entity-actions';
import { departmentLabel, type Employee as HrEmployee } from '@/components/employees/types';
import {
  ACCENTS,
  DOCK_GAP_MAX,
  DOCK_GAP_MIN,
  DOCK_SIZE_MAX,
  DOCK_SIZE_MIN,
  type NotificationSettings,
  type UserSettings,
} from './auth/session-store';
import { formatINR, initials, paiseToDecimalRupees, parseRupeesToPaise } from './format';
import { Icon, type IconName } from './icons';
import type {
  Client,
  Project,
  Vendor,
  VendorDocument,
  VendorDocumentKind,
  VendorInvoice,
  VendorInvoiceStatus,
} from './types';
import type { VendorStore } from './auth/vendor-store';
import {
  archiveProject,
  createProject,
  listAllProjects,
  updateProject,
  type ProjectListRow,
} from '@/lib/server/entities/projects';
import { archiveVendor, createVendor, updateVendor } from '@/lib/server/entities/vendors';
import { archiveClient, createClient, updateClient } from '@/lib/server/entities/clients';
import {
  archiveEmployee,
  createEmployee,
  getEmployeeEditable,
  updateEmployee,
  type EditableEmployee,
} from '@/lib/server/entities/employees';
import {
  getMyProfile,
  getMySecurity,
  updateMyProfile,
  type MyProfile,
  type MySecurity,
} from '@/lib/server/entities/account';
import {
  listTeamMembers,
  setUserActive,
  setUserRole,
  type TeamMember,
} from '@/lib/server/entities/team';
import {
  createDepartment,
  deleteDepartment,
  listDepartmentsDetailed,
  renameDepartment,
  type DepartmentRow,
} from '@/lib/server/entities/departments';
import {
  getGlobalReminderSchedule,
  saveGlobalReminderSchedule,
  type GlobalReminderSchedule,
} from '@/lib/server/billing/reminders';
import {
  getActivityDigestConfig,
  saveActivityDigestConfig,
  sendActivityDigestNow,
  type ActivityDigestConfigView,
} from '@/lib/server/entities/activity-digest';
import {
  listRecentDocuments,
  type RecentDocumentRow,
} from '@/lib/server/entities/entity-documents';
import { colToDbStatus, dbStatusToCol } from '@/lib/project-status';
import { toast } from 'sonner';

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function Sparkline({ data, color = '#E63A1F' }: { data: number[]; color?: string }) {
  const w = 100;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x},${y}`;
    })
    .join(' ');
  const last = data[data.length - 1]!;
  const lastX = w;
  const lastY = h - ((last - min) / span) * h;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={1.6} fill={color} />
    </svg>
  );
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  Active: 'green',
  Cleared: 'green',
  Sent: 'green',
  Approved: 'green',
  Review: 'amber',
  Pending: 'amber',
  Draft: 'slate',
  Paused: 'slate',
  Onboarding: 'amber',
  Pitch: 'red',
  Completed: 'slate',
};

function Status({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? 'slate';
  return (
    <span className={`pill ${tone}`}>
      <span className="dot" />
      {value}
    </span>
  );
}

function Kpi({ label, value, trend }: { label: string; value: ReactNode; trend?: string }) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div className="font-display" style={{ fontSize: 28, marginTop: 4 }}>
        {value}
      </div>
      {trend ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{trend}</div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Clients                                                                    */
/* -------------------------------------------------------------------------- */

const CLIENT_STATUSES: readonly string[] = ['Active', 'Onboarding', 'Review', 'Pitch', 'Paused'];

// Deterministic avatar tone palette — keyed by name so the OS list shows a
// stable color across reloads.
const OS_AVATAR_TONES = ['#7A4E2D', '#3F4E8E', '#5E7344', '#7A2D4E', '#2D5E7A', '#7A6A2D'] as const;
function toneForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % OS_AVATAR_TONES.length;
  return OS_AVATAR_TONES[idx]!;
}
function logoForName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const DB_TO_OS_CLIENT_STATUS: Record<string, Client['status']> = {
  active: 'Active',
  onboarding: 'Onboarding',
  inactive: 'Paused',
  archived: 'Paused',
};

// OS display status → DB `client_status` enum for quick-create.
const OS_TO_DB_CLIENT_STATUS: Record<string, 'prospect' | 'active' | 'inactive'> = {
  Active: 'active',
  Onboarding: 'prospect',
  Review: 'prospect',
  Pitch: 'prospect',
  Paused: 'inactive',
};

export function ClientsApp({
  openClient,
  canEdit = true,
  canDelete = true,
}: {
  openClient: (c: Client) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [confirmDel, setConfirmDel] = useState<Client | null>(null);

  // Real DB-backed list. Replaces the localStorage useBusinessData read so
  // clicking a row passes a real UUID into openWindow → routes to the
  // ClientWindow (apps/client-window.tsx) that composes the shared Section
  // components. The legacy localStorage add/edit/delete buttons remain for
  // demo continuity but new rows won't appear here.
  const [dbClients, setDbClients] = useState<readonly Client[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function fetchClientList(): Promise<readonly Client[]> {
    const rows = await listDbClients();
    return (
      rows
        // Archived clients drop out of the active directory but stay
        // queryable from anywhere they're referenced (projects, txns,
        // invoices) where the UI renders them as "<name> (ex-client)".
        .filter((r) => r.status !== 'archived')
        .map(
          (r): Client => ({
            id: r.id,
            name: r.name,
            industry: r.industry || '—',
            status: DB_TO_OS_CLIENT_STATUS[r.status] ?? 'Active',
            manager: r.accountManager || '—',
            managerId: r.accountManagerId,
            activity: r.lastActivityAt
              ? new Date(r.lastActivityAt).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                })
              : '—',
            logo: logoForName(r.name),
            tone: toneForName(r.name),
          }),
        )
    );
  }

  useEffect(() => {
    let cancelled = false;
    fetchClientList()
      .then((mapped) => {
        if (!cancelled) setDbClients(mapped);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load clients');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = { clients: dbClients ?? [] };

  const filtered = data.clients.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q) ||
      c.manager.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Clients</h2>
        <span className="sub">{data.clients.length} accounts</span>
        <div className="grow" />
        <div className="search-input">
          <Icon name="search" size={13} />
          <input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn primary"
          type="button"
          disabled={!canEdit}
          onClick={() => setShowNew(true)}
          title={canEdit ? undefined : 'You need edit permission to create clients.'}
        >
          <Icon name="plus" size={13} />
          New Client
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Industry</th>
              <th>Manager</th>
              <th>Status</th>
              <th>Last activity</th>
              <th style={{ width: 64 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="row-clickable row-with-actions"
                onClick={() => openClient(c)}
                onDoubleClick={() => openClient(c)}
              >
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      className="avatar"
                      style={{ width: 28, height: 28, fontSize: 11, background: c.tone }}
                    >
                      {c.logo}
                    </div>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{c.industry}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      className="avatar"
                      style={{ width: 22, height: 22, fontSize: 9, background: '#7A4E2D' }}
                    >
                      {initials(c.manager)}
                    </div>
                    {c.manager}
                  </div>
                </td>
                <td>
                  <Status value={c.status} />
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{c.activity}</td>
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <div className="row-actions">
                    {canEdit && (
                      <button
                        className="btn row-action"
                        type="button"
                        title="Edit client"
                        onClick={() => setEditing(c)}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="btn row-action row-delete"
                        type="button"
                        title="Archive client"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDel(c);
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                    <Icon name="arrowRight" size={14} />
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    padding: 28,
                    color: loadError ? 'var(--text-error, #c33)' : 'var(--text-muted)',
                  }}
                >
                  {loadError
                    ? `Couldn't load clients: ${loadError}`
                    : data.clients.length === 0
                      ? 'No clients yet — click "New Client" to add the first.'
                      : `No clients match "${search}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <ClientFormModal
          mode="create"
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            const result = await createClient({
              name: input.name,
              industry: input.industry || undefined,
              status: OS_TO_DB_CLIENT_STATUS[input.status] ?? 'active',
              accountManagerId: input.managerId ?? undefined,
              gstin: input.gstin || undefined,
              pan: input.pan || undefined,
              registeredAddress: input.address || undefined,
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setShowNew(false);
            const next = await fetchClientList().catch(() => null);
            if (next) setDbClients(next);
            const created = next?.find((c) => c.id === result.id);
            if (created) openClient(created);
            toast.success(`Client "${input.name}" created.`);
          }}
        />
      )}
      {editing && (
        <ClientFormModal
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            // NOTE: input.gstin/pan/address are not collected in edit mode and
            // must NOT be forwarded here — the canonical edit path for GSTIN/PAN
            // and the registered address is the client window's Edit dialog.
            const result = await updateClient({
              id: editing.id,
              name: input.name,
              industry: input.industry || null,
              status: OS_TO_DB_CLIENT_STATUS[input.status] ?? undefined,
              accountManagerId: input.managerId,
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setEditing(null);
            const next = await fetchClientList().catch(() => null);
            if (next) setDbClients(next);
            toast.success(`Updated ${input.name}.`);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Archive ${confirmDel.name}?`}
          message={`Hides "${confirmDel.name}" from the active directory. Projects, transactions, and invoices that reference this client are kept intact and will display "${confirmDel.name} (ex-client)". A partner can restore the client later.`}
          destructive
          confirmLabel="Archive client"
          onCancel={() => setConfirmDel(null)}
          onConfirm={async () => {
            const target = confirmDel;
            setConfirmDel(null);
            try {
              await archiveClient(target.id);
              const next = await fetchClientList().catch(() => null);
              if (next) setDbClients(next);
              toast.success(`Archived "${target.name}".`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not archive the client.');
            }
          }}
        />
      )}
    </div>
  );
}

type ClientFormValues = {
  name: string;
  industry: string;
  managerId: string | null;
  status: string;
  // Billing details — captured on CREATE only (present only when mode==='create').
  // GSTIN + PAN + a registered address are what India B2B GST invoicing requires
  // before an invoice can be raised, so capturing them up front lets a client be
  // billing-ready from day one. They are intentionally absent in edit mode (the
  // canonical edit path is the client window's Edit dialog).
  gstin?: string;
  pan?: string;
  address?: string;
};

function ClientFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<Client>;
  onClose: () => void;
  onSubmit: (input: ClientFormValues) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [industry, setIndustry] = useState(initial?.industry ?? '');
  const [managerId, setManagerId] = useState<string>(initial?.managerId ?? '');
  const [status, setStatus] = useState(initial?.status ?? CLIENT_STATUSES[0]!);
  // Billing fields are captured on create only (mirrors the vendor form), so
  // they start empty — the OS Client shape doesn't carry them for edit prefill.
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [address, setAddress] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // Real team members for the Account-manager picker. Account manager is a
  // FK to users.id (not employees), so this lists system users.
  const [managers, setManagers] = useState<readonly { id: string; name: string }[]>([]);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    listDbUsers()
      .then((rows) => {
        if (active) setManagers(rows.map((u) => ({ id: u.id, name: u.fullName })));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    if (!n) return setErr('Client name is required.');
    if (!industry.trim()) return setErr('Industry is required.');
    const g = gstin.trim().toUpperCase();
    if (g && !GSTIN_RE.test(g)) {
      return setErr('GSTIN format looks off — expected 15 chars like 27ABCDE1234F1Z5.');
    }
    setErr(null);
    setBusy(true);
    try {
      await onSubmit({
        name: n,
        industry: industry.trim(),
        managerId: managerId || null,
        status,
        // Billing fields are only collected (and only saved) on create.
        ...(mode === 'create'
          ? { gstin: g, pan: pan.trim().toUpperCase(), address: address.trim() }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? 'New Client' : `Edit ${initial?.name ?? 'Client'}`}
      onClose={onClose}
      width={520}
    >
      <form onSubmit={submit} className="os-form">
        <Field label="Client name" full>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Asian Paints"
          />
        </Field>
        <Field label="Industry">
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="FMCG"
          />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {CLIENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Account manager">
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">— Unassigned —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        {/* Billing details — GSTIN/PAN live on the client row, the address in
            entity_addresses. All optional at create; required before an invoice
            can be raised. Shown only on create (mirrors the vendor form); edit
            them later from the client window's Edit dialog so the form never
            shows a field that won't save here. */}
        {mode === 'create' ? (
          <>
            <Field label="GSTIN" hint="Optional. Required before invoicing. 15 chars.">
              <input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="27ABCDE1234F1Z5"
                className="font-mono"
                maxLength={15}
              />
            </Field>
            <Field label="PAN" hint="Optional. Required before invoicing.">
              <input
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                className="font-mono"
                maxLength={10}
              />
            </Field>
            <Field label="Registered address" full hint="Optional. Used on GST invoices.">
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Registered office address"
              />
            </Field>
          </>
        ) : null}
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="check" size={13} />
            {busy ? 'Saving…' : mode === 'create' ? 'Create client' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Client detail                                                              */
/* -------------------------------------------------------------------------- */

type ClientTab = 'Overview' | 'Contacts' | 'Projects' | 'Documents';

type ClientContact = { id: string; name: string; role: string };
type ClientDocAttachment = { id: string; name: string; uploadedAt: string };

const SEED_CONTACTS: readonly ClientContact[] = [
  { id: 'sc-1', name: 'Anjali Sharma', role: 'Head of Marketing' },
  { id: 'sc-2', name: 'Rishi Kapoor', role: 'Brand Manager' },
  { id: 'sc-3', name: 'Tanvi Gokhale', role: 'Procurement Lead' },
  { id: 'sc-4', name: 'Aman Verma', role: 'Finance Controller' },
];
const SEED_DOC_NAMES: readonly string[] = [
  'MSA_v3_signed.pdf',
  'SOW_Diwali_26.pdf',
  'Brand_Guidelines.pdf',
  'Q1_Strategy.pdf',
  'Festive_Brief.pdf',
];

export function ClientDetail({
  client: clientProp,
  canEdit = true,
  canDelete = true,
  onCloseWindow,
}: {
  client: Client;
  canEdit?: boolean;
  canDelete?: boolean;
  onCloseWindow?: () => void;
}) {
  const { data, updateClient, addProject } = useBusinessData();
  // Prefer the live store entry so edits reflect immediately.
  const client = data.clients.find((c) => c.id === clientProp.id) ?? clientProp;
  const [tab, setTab] = useState<ClientTab>('Overview');
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // The "Ledger" tab was removed in Phase 1 with the rest of the fake
  // single-entry transaction surface. It returns in Phase 4 as an embedded
  // `<TransactionList entityFilter={...}>` from `components/entity/` (B).
  const tabs: readonly ClientTab[] = ['Overview', 'Contacts', 'Projects', 'Documents'];
  const firstWord = client.name.split(' ')[0] ?? '';
  // Contacts + documents live in component state — demo-grade.
  const [contacts, setContacts] = useState<ClientContact[]>(() => [...SEED_CONTACTS]);
  const [docs, setDocs] = useState<ClientDocAttachment[]>(() =>
    SEED_DOC_NAMES.map((name, i) => ({
      id: `sd-${i}`,
      name,
      uploadedAt: '12 May 26',
    })),
  );
  const [showAddContact, setShowAddContact] = useState(false);
  const [showUploadDoc, setShowUploadDoc] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const projs = data.projects
    .filter((p) => p.client === client.name || p.client.includes(firstWord))
    .slice(0, 8);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '20px 24px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        <div
          className="avatar"
          style={{ width: 56, height: 56, fontSize: 18, background: client.tone, borderRadius: 12 }}
        >
          {client.logo}
        </div>
        <div style={{ flex: 1 }}>
          <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1 }}>
            {client.name}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            {client.industry} · Managed by {client.manager}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Status value={client.status} />
            <span className="pill">
              <span className="dot" style={{ background: 'var(--text-dim)' }} />
              Client since 2021
            </span>
            <span className="pill">
              <span className="dot" style={{ background: 'var(--apar-red)' }} />
              Tier A
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && (
            <button
              className="btn"
              type="button"
              onClick={() => setEditing(true)}
              title="Edit client"
            >
              <Icon name="edit" size={13} />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              className="btn"
              type="button"
              onClick={() => setConfirmDel(true)}
              title="Archive client"
            >
              <Icon name="trash" size={13} />
              Archive
            </button>
          )}
          {canEdit && tab === 'Contacts' && (
            <button className="btn primary" type="button" onClick={() => setShowAddContact(true)}>
              <Icon name="plus" size={13} />
              Add Contact
            </button>
          )}
          {canEdit && tab === 'Projects' && (
            <button className="btn primary" type="button" onClick={() => setShowNewProject(true)}>
              <Icon name="plus" size={13} />
              New Project
            </button>
          )}
          {canEdit && tab === 'Documents' && (
            <button className="btn primary" type="button" onClick={() => setShowUploadDoc(true)}>
              <Icon name="plus" size={13} />
              Upload Document
            </button>
          )}
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'Overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Kpi label="Lifetime Revenue" value="₹ 8.4Cr" trend="+12% YoY" />
            <Kpi label="Outstanding (AR)" value="₹ 38.4L" trend="2 invoices" />
            <Kpi
              label="Active Projects"
              value={projs.filter((p) => p.col === 'Active').length.toString()}
              trend="of 12 total"
            />
            <div
              style={{
                gridColumn: '1 / -1',
                background: 'var(--content-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Activity</div>
              {[
                { t: 'Invoice #INV-26-118 sent', d: '2h ago' },
                { t: 'Creative review approved by Anjali (client)', d: 'Yesterday' },
                { t: 'New SOW shared for Diwali Campaign', d: '3 days ago' },
                { t: 'Meeting recap — Brand workshop, 14 May', d: '1 week ago' },
              ].map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 0',
                    borderBottom: i < 3 ? '1px solid var(--border)' : '0',
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--apar-red)',
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 13 }}>{a.t}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{a.d}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'Contacts' &&
          (contacts.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No contacts yet. Click <strong>Add Contact</strong> above to add the first POC.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {contacts.map((c) => (
                <div key={c.id} className="emp-card emp-card-actionable">
                  <div
                    className="avatar"
                    style={{ width: 40, height: 40, fontSize: 13, background: '#7A4E2D' }}
                  >
                    {initials(c.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="name">{c.name}</div>
                    <div className="role">{c.role}</div>
                  </div>
                  {canDelete && (
                    <button
                      type="button"
                      className="emp-card-delete"
                      title="Remove contact"
                      onClick={() => setContacts((xs) => xs.filter((x) => x.id !== c.id))}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        {tab === 'Projects' && (
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Project</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
              </tr>
            </thead>
            <tbody>
              {projs.map((p) => (
                <tr key={p.code}>
                  <td className="font-mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {p.code}
                  </td>
                  <td>
                    <EntityRef
                      type="project"
                      id={p.code}
                      label={p.name}
                      hideIcon
                      onNavigate={navigateBesideFocused}
                    />
                  </td>
                  <td>
                    <Status value={p.col} />
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(p.fee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Documents' &&
          (docs.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No documents yet. Click <strong>Upload Document</strong> above to attach the first
              file.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {docs.map((d) => (
                <div
                  key={d.id}
                  style={{
                    background: 'var(--content-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 12,
                    position: 'relative',
                  }}
                >
                  {canDelete && (
                    <button
                      type="button"
                      className="btn"
                      title="Remove"
                      onClick={() => setDocs((xs) => xs.filter((x) => x.id !== d.id))}
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        padding: '2px 5px',
                        minHeight: 0,
                      }}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                  <div className="pdf-thumb" style={{ width: '100%', height: 90, marginBottom: 8 }}>
                    <div className="line" style={{ top: 12 }} />
                    <div className="line" style={{ top: 20 }} />
                    <div className="line" style={{ top: 28, right: 18 }} />
                    <div className="line" style={{ top: 40 }} />
                    <div className="line" style={{ top: 48, right: 14 }} />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {d.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4 }}>
                    Uploaded {d.uploadedAt}
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onAdd={(input) => {
            setContacts((xs) => [{ id: `c-${Date.now().toString(36)}`, ...input }, ...xs]);
            setShowAddContact(false);
          }}
        />
      )}
      {showUploadDoc && (
        <UploadClientDocModal
          onClose={() => setShowUploadDoc(false)}
          onUpload={(filename) => {
            setDocs((xs) => [
              {
                id: `d-${Date.now().toString(36)}`,
                name: filename,
                uploadedAt: new Date().toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: '2-digit',
                }),
              },
              ...xs,
            ]);
            setShowUploadDoc(false);
          }}
        />
      )}
      {showNewProject && (
        <ProjectFormModal
          mode="create"
          defaultCol="Proposed"
          initial={{ client: client.name }}
          onClose={() => setShowNewProject(false)}
          onSubmit={(input) => {
            addProject(input);
            setShowNewProject(false);
          }}
        />
      )}
      {editing && (
        <ClientFormModal
          mode="edit"
          initial={client}
          onClose={() => setEditing(false)}
          onSubmit={(input) => {
            updateClient(client.id, input);
            setEditing(false);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Archive ${client.name}?`}
          message={`Hides "${client.name}" from the active directory and closes this window. Projects, transactions, and invoices that reference this client are kept intact and will display "${client.name} (ex-client)". A partner can restore the client later.`}
          destructive
          confirmLabel="Archive client"
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            setConfirmDel(false);
            try {
              await archiveClient(client.id);
              toast.success(`Archived "${client.name}".`);
              onCloseWindow?.();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not archive the client.');
            }
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vendors                                                                    */
/* -------------------------------------------------------------------------- */

const VENDOR_CATEGORIES: readonly string[] = [
  'Photographer',
  'Printer',
  'Production',
  'Software',
  'Illustration',
  'Logistics',
  'Talent',
  'Animation',
  'Localisation',
  'Other',
];

export function VendorsApp({
  store,
  openVendor,
  canEdit = true,
  canDelete = true,
}: {
  store: VendorStore;
  openVendor: (v: Vendor) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [confirmDel, setConfirmDel] = useState<Vendor | null>(null);

  // Real DB-backed list (mirrors ClientsApp swap). Clicking a row passes
  // a UUID into openWindow → routes to VendorWindow.
  const [dbVendors, setDbVendors] = useState<readonly Vendor[] | null>(null);
  void store; // localStorage VendorStore retained for the legacy CRUD UI but unused for reads
  void dbVendors; // referenced below via the substituted `vendors` constant

  async function fetchVendorList(): Promise<readonly Vendor[]> {
    const rows = await listDbVendors();
    return (
      rows
        // Archived vendors drop out of the active directory. Bills,
        // expenses, and documents that reference them still resolve the
        // name and show an "(ex-vendor)" suffix.
        .filter((r) => !r.isArchived)
        .map(
          (r): Vendor => ({
            id: r.id,
            name: r.name,
            cat: r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Other',
            outstanding: r.outstandingPaise,
            last: r.lastTxnAt
              ? new Date(r.lastTxnAt).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                })
              : '—',
            gstin: r.gstin ?? undefined,
            pan: r.pan ?? undefined,
            notes: r.notes ?? undefined,
          }),
        )
    );
  }

  useEffect(() => {
    let cancelled = false;
    fetchVendorList()
      .then((list) => {
        if (!cancelled) setDbVendors(list);
      })
      .catch(() => {
        /* fall through to legacy store list */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const vendors = dbVendors ?? store.vendors;
  const filtered = vendors.filter((v) => {
    const q = search.toLowerCase();
    return v.name.toLowerCase().includes(q) || v.cat.toLowerCase().includes(q);
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Vendors</h2>
        <span className="sub">{vendors.length} partners</span>
        <div className="grow" />
        <div className="search-input">
          <Icon name="search" size={13} />
          <input
            placeholder="Search vendors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn primary"
          type="button"
          disabled={!canEdit}
          onClick={() => setShowNew(true)}
          title={canEdit ? undefined : 'You need edit permission to create vendors.'}
        >
          <Icon name="plus" size={13} />
          New Vendor
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Category</th>
              <th>GSTIN</th>
              <th>Last billed</th>
              <th style={{ textAlign: 'right' }}>Outstanding</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr
                key={v.id}
                className="row-clickable row-with-actions"
                onClick={() => openVendor(v)}
                onDoubleClick={() => openVendor(v)}
              >
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      className="avatar"
                      style={{ width: 28, height: 28, fontSize: 10, background: '#5B6677' }}
                    >
                      {initials(v.name)}
                    </div>
                    <span style={{ fontWeight: 600 }}>{v.name}</span>
                  </div>
                </td>
                <td>
                  <span className="pill slate">
                    <span className="dot" />
                    {v.cat}
                  </span>
                </td>
                <td className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {v.gstin ?? '—'}
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{v.last}</td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: v.outstanding ? 'var(--apar-red)' : 'var(--text-muted)',
                    fontWeight: v.outstanding ? 600 : 400,
                  }}
                >
                  {v.outstanding ? formatINR(v.outstanding) : '—'}
                </td>
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <div className="row-actions">
                    {canEdit && (
                      <button
                        className="btn row-action"
                        type="button"
                        title="Edit vendor"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(v);
                        }}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="btn row-action row-delete"
                        type="button"
                        title="Archive vendor"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDel(v);
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                    <Icon name="arrowRight" size={14} />
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}
                >
                  No vendors match &ldquo;{search}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <VendorFormModal
          mode="create"
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            const result = await createVendor({
              name: input.name,
              category: input.cat,
              gstin: input.gstin,
              pan: input.pan,
              primaryEmail: input.email,
              primaryPhone: input.phone,
              registeredAddress: input.address,
              paymentTermsDays: input.paymentTermsDays,
              notes: input.notes,
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setShowNew(false);
            const next = await fetchVendorList().catch(() => null);
            if (next) setDbVendors(next);
            const created = next?.find((v) => v.id === result.id);
            if (created) openVendor(created);
            toast.success(`Vendor "${input.name}" created.`);
          }}
        />
      )}
      {editing && (
        <VendorFormModal
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            const target = editing;
            const result = await updateVendor({
              id: target.id,
              name: input.name,
              category: input.cat || null,
              gstin: input.gstin || null,
              pan: input.pan || null,
              notes: input.notes || null,
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setEditing(null);
            const next = await fetchVendorList().catch(() => null);
            if (next) setDbVendors(next);
            toast.success(`Updated "${input.name}".`);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Archive ${confirmDel.name}?`}
          message={`Hides "${confirmDel.name}" from the active vendor directory. Bills, expenses, and documents that reference this vendor are kept intact and will display "${confirmDel.name} (ex-vendor)". A partner can restore the vendor later.`}
          destructive
          confirmLabel="Archive vendor"
          onCancel={() => setConfirmDel(null)}
          onConfirm={async () => {
            const target = confirmDel;
            setConfirmDel(null);
            try {
              await archiveVendor(target.id);
              const next = await fetchVendorList().catch(() => null);
              if (next) setDbVendors(next);
              toast.success(`Archived "${target.name}".`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not archive the vendor.');
            }
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vendor detail                                                              */
/* -------------------------------------------------------------------------- */

type VendorTab = 'Overview' | 'Invoices' | 'Documents' | 'Ledger';

export function VendorDetail({
  vendor: vendorProp,
  store,
  canEdit = true,
  canDelete = true,
  onCloseWindow,
}: {
  vendor: Vendor;
  store: VendorStore;
  canEdit?: boolean;
  canDelete?: boolean;
  onCloseWindow?: () => void;
}) {
  // Prefer the live store entry so newly-added vendors reflect any edits.
  const vendor = store.getVendor(vendorProp.id) ?? vendorProp;
  const [tab, setTab] = useState<VendorTab>('Overview');
  const [showInvoice, setShowInvoice] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  const [editVendor, setEditVendor] = useState(false);
  const [editInvoice, setEditInvoice] = useState<VendorInvoice | null>(null);
  const [editDoc, setEditDoc] = useState<VendorDocument | null>(null);
  const [confirmDelVendor, setConfirmDelVendor] = useState(false);
  const [confirmDelInvoice, setConfirmDelInvoice] = useState<VendorInvoice | null>(null);
  const [confirmDelDoc, setConfirmDelDoc] = useState<VendorDocument | null>(null);

  const invoices = store.invoicesFor(vendor.id);
  const documents = store.documentsFor(vendor.id);

  const totalBilled = invoices.reduce((sum, i) => sum + i.total, 0n);
  const outstanding = invoices
    .filter((i) => i.status !== 'Paid')
    .reduce((sum, i) => sum + i.total, 0n);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '20px 24px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        <div
          className="avatar"
          style={{ width: 56, height: 56, fontSize: 18, background: '#5B6677', borderRadius: 12 }}
        >
          {initials(vendor.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1 }}>
            {vendor.name}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            {vendor.cat}
            {vendor.email ? ` · ${vendor.email}` : ''}
            {vendor.phone ? ` · ${vendor.phone}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {vendor.gstin && (
              <span className="pill">
                <span className="dot" style={{ background: 'var(--apar-red)' }} />
                GSTIN{' '}
                <span className="font-mono" style={{ marginLeft: 4 }}>
                  {vendor.gstin}
                </span>
              </span>
            )}
            {vendor.pan && (
              <span className="pill">
                <span className="dot" style={{ background: 'var(--text-dim)' }} />
                PAN{' '}
                <span className="font-mono" style={{ marginLeft: 4 }}>
                  {vendor.pan}
                </span>
              </span>
            )}
            {vendor.paymentTermsDays != null && (
              <span className="pill slate">
                <span className="dot" />
                Net {vendor.paymentTermsDays}d
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canEdit && (
            <button
              className="btn"
              type="button"
              onClick={() => setEditVendor(true)}
              title="Edit vendor"
            >
              <Icon name="edit" size={13} />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              className="btn"
              type="button"
              onClick={() => setConfirmDelVendor(true)}
              title="Archive vendor"
            >
              <Icon name="trash" size={13} />
              Archive
            </button>
          )}
          {/* Tab-aware primary action. */}
          {canEdit && tab === 'Invoices' && (
            <button className="btn primary" type="button" onClick={() => setShowInvoice(true)}>
              <Icon name="plus" size={13} />
              New Invoice
            </button>
          )}
          {canEdit && tab === 'Documents' && (
            <button className="btn primary" type="button" onClick={() => setShowDoc(true)}>
              <Icon name="plus" size={13} />
              Upload Document
            </button>
          )}
          {canEdit && tab === 'Overview' && (
            <button className="btn primary" type="button" onClick={() => setShowInvoice(true)}>
              <Icon name="plus" size={13} />
              New Invoice
            </button>
          )}
          {tab === 'Ledger' && invoices.length > 0 && (
            <button
              className="btn"
              type="button"
              title="Jump to the Invoices tab to add a new entry"
              onClick={() => setTab('Invoices')}
            >
              <Icon name="arrowRight" size={13} />
              Invoices
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {(['Overview', 'Invoices', 'Documents', 'Ledger'] as VendorTab[]).map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Invoices' && invoices.length > 0 ? ` · ${invoices.length}` : ''}
            {t === 'Documents' && documents.length > 0 ? ` · ${documents.length}` : ''}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'Overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Kpi label="Outstanding" value={outstanding ? formatINR(outstanding) : '—'} />
            <Kpi
              label="Total Billed"
              value={totalBilled ? formatINR(totalBilled) : '—'}
              trend={`${invoices.length} invoices`}
            />
            <Kpi label="Documents" value={documents.length.toString()} trend="agreements & KYC" />
            <div
              style={{
                gridColumn: '1 / -1',
                background: 'var(--content-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Contact</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr',
                  rowGap: 8,
                  fontSize: 13,
                }}
              >
                <div style={{ color: 'var(--text-muted)' }}>Email</div>
                <div>{vendor.email ?? '—'}</div>
                <div style={{ color: 'var(--text-muted)' }}>Phone</div>
                <div>{vendor.phone ?? '—'}</div>
                <div style={{ color: 'var(--text-muted)' }}>Address</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{vendor.address ?? '—'}</div>
                <div style={{ color: 'var(--text-muted)' }}>Notes</div>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>
                  {vendor.notes ?? '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'Invoices' &&
          (invoices.length === 0 ? (
            <EmptyState
              icon="filetext"
              title="No invoices yet"
              subtitle="Capture amounts directly from the vendor's bill — Apar never computes tax."
              actionLabel="New Invoice"
              onAction={canEdit ? () => setShowInvoice(true) : undefined}
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ textAlign: 'right' }}>GST</th>
                  <th style={{ textAlign: 'right' }}>TDS</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono" style={{ fontSize: 12 }}>
                      {inv.number}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{inv.date}</td>
                    <td>
                      <Status value={inv.status} />
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(inv.subtotal)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {inv.gst ? formatINR(inv.gst) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {inv.tds ? formatINR(inv.tds) : '—'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                      }}
                    >
                      {formatINR(inv.total)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row-actions" style={{ opacity: 1 }}>
                        {canEdit && (
                          <button
                            className="btn row-action"
                            type="button"
                            onClick={() => setEditInvoice(inv)}
                            title="Edit invoice"
                          >
                            <Icon name="edit" size={12} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="btn row-action row-delete"
                            type="button"
                            onClick={() => setConfirmDelInvoice(inv)}
                            title="Delete invoice"
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'Documents' &&
          (documents.length === 0 ? (
            <EmptyState
              icon="filetext"
              title="No documents on file"
              subtitle="Upload the agreement, MSA, GST certificate, bank details — anything you'd otherwise email around."
              actionLabel="Upload Document"
              onAction={canEdit ? () => setShowDoc(true) : undefined}
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="doc-card"
                  style={{
                    background: 'var(--content-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 12,
                    position: 'relative',
                  }}
                >
                  <div
                    className="doc-card-actions"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      display: 'flex',
                      gap: 4,
                    }}
                  >
                    {canEdit && (
                      <button
                        className="btn row-action"
                        type="button"
                        title="Edit document"
                        onClick={() => setEditDoc(d)}
                      >
                        <Icon name="edit" size={11} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="btn row-action row-delete"
                        type="button"
                        title="Delete document"
                        onClick={() => setConfirmDelDoc(d)}
                      >
                        <Icon name="trash" size={11} />
                      </button>
                    )}
                  </div>
                  <div className="pdf-thumb" style={{ width: '100%', height: 90, marginBottom: 8 }}>
                    <div className="line" style={{ top: 12 }} />
                    <div className="line" style={{ top: 20 }} />
                    <div className="line" style={{ top: 28, right: 18 }} />
                    <div className="line" style={{ top: 40 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--apar-red)', fontWeight: 600 }}>
                    {d.kind.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{d.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {d.fileName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                    Uploaded{' '}
                    {new Date(d.uploadedAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                    })}
                    {d.expiresOn ? ` · expires ${d.expiresOn}` : ''}
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'Ledger' && (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{inv.date}</td>
                  <td className="font-mono" style={{ fontSize: 11.5 }}>
                    {inv.number}
                  </td>
                  <td>
                    <Status value={inv.status} />
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 500,
                    }}
                  >
                    − {formatINR(inv.total)}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}
                  >
                    Ledger entries appear here once invoices are added.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showInvoice && (
        <InvoiceFormModal
          mode="create"
          vendor={vendor}
          onClose={() => setShowInvoice(false)}
          onSubmit={(input) => {
            store.addInvoice(input);
            setShowInvoice(false);
            setTab('Invoices');
          }}
        />
      )}
      {editInvoice && (
        <InvoiceFormModal
          mode="edit"
          vendor={vendor}
          initial={editInvoice}
          onClose={() => setEditInvoice(null)}
          onSubmit={(input) => {
            store.updateInvoice(editInvoice.id, input);
            setEditInvoice(null);
          }}
        />
      )}
      {showDoc && (
        <DocumentFormModal
          mode="create"
          vendor={vendor}
          onClose={() => setShowDoc(false)}
          onSubmit={(input) => {
            store.addDocument(input);
            setShowDoc(false);
            setTab('Documents');
          }}
        />
      )}
      {editDoc && (
        <DocumentFormModal
          mode="edit"
          vendor={vendor}
          initial={editDoc}
          onClose={() => setEditDoc(null)}
          onSubmit={(input) => {
            store.updateDocument(editDoc.id, input);
            setEditDoc(null);
          }}
        />
      )}
      {editVendor && (
        <VendorFormModal
          mode="edit"
          initial={vendor}
          onClose={() => setEditVendor(false)}
          onSubmit={async (input) => {
            const result = await updateVendor({
              id: vendor.id,
              name: input.name,
              category: input.cat || null,
              gstin: input.gstin || null,
              pan: input.pan || null,
              notes: input.notes || null,
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            // Keep the localStorage `VendorStore` in sync so the rest
            // of this window (Overview tags, etc) reflects the edit
            // until the next page load reads from the DB.
            store.updateVendor(vendor.id, input);
            setEditVendor(false);
            toast.success(`Updated "${input.name}".`);
          }}
        />
      )}
      {confirmDelVendor && (
        <ConfirmDialog
          title={`Archive ${vendor.name}?`}
          message={`Hides "${vendor.name}" from the active vendor directory and closes this window. Bills, expenses, and documents referencing this vendor are kept intact and will render as "${vendor.name} (ex-vendor)". A partner can restore later.`}
          destructive
          confirmLabel="Archive vendor"
          onCancel={() => setConfirmDelVendor(false)}
          onConfirm={async () => {
            setConfirmDelVendor(false);
            try {
              await archiveVendor(vendor.id);
              toast.success(`Archived "${vendor.name}".`);
              onCloseWindow?.();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not archive the vendor.');
            }
          }}
        />
      )}
      {confirmDelInvoice && (
        <ConfirmDialog
          title={`Delete invoice ${confirmDelInvoice.number}?`}
          message="This can't be undone."
          destructive
          confirmLabel="Delete invoice"
          onCancel={() => setConfirmDelInvoice(null)}
          onConfirm={() => {
            store.removeInvoice(confirmDelInvoice.id);
            setConfirmDelInvoice(null);
          }}
        />
      )}
      {confirmDelDoc && (
        <ConfirmDialog
          title={`Delete document "${confirmDelDoc.title}"?`}
          message="The attached file reference will be removed. This can't be undone."
          destructive
          confirmLabel="Delete document"
          onCancel={() => setConfirmDelDoc(null)}
          onConfirm={() => {
            store.removeDocument(confirmDelDoc.id);
            setConfirmDelDoc(null);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vendor modals + small bits                                                 */
/* -------------------------------------------------------------------------- */

function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'var(--content-2)',
          border: '1px solid var(--border)',
          display: 'grid',
          placeItems: 'center',
          marginBottom: 14,
          color: 'var(--text-dim)',
        }}
      >
        <Icon name={icon} size={22} />
      </div>
      <div className="font-display" style={{ fontSize: 20, color: 'var(--text)' }}>
        {title}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, maxWidth: 320 }}>{subtitle}</div>
      {actionLabel && onAction && (
        <button className="btn primary" type="button" onClick={onAction} style={{ marginTop: 16 }}>
          <Icon name="plus" size={13} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="os-modal-overlay" onMouseDown={onClose}>
      <div className="os-modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            {title}
          </div>
          <button className="btn" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="os-modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Demo-grade confirmation dialog. Used in place of window.confirm so the OS
 *  keeps a cohesive look. `destructive` styles the confirm button red. */
function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <div className="os-form">
        <div
          style={{
            padding: '4px 2px 12px',
            color: 'var(--text-muted)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn primary"
            style={
              destructive
                ? { background: 'var(--apar-red-deep)', borderColor: 'transparent' }
                : undefined
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
  hint,
  full,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className="os-field" style={full ? { gridColumn: '1 / -1' } : undefined}>
      <span className="os-field-label">{label}</span>
      {children}
      {hint && <span className="os-field-hint">{hint}</span>}
    </label>
  );
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

type VendorFormValues = {
  name: string;
  cat: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTermsDays?: number;
  notes?: string;
};

function VendorFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<Vendor>;
  onClose: () => void;
  onSubmit: (input: VendorFormValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [cat, setCat] = useState<string>(initial?.cat ?? VENDOR_CATEGORIES[0] ?? 'Other');
  const [gstin, setGstin] = useState(initial?.gstin ?? '');
  const [pan, setPan] = useState(initial?.pan ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [terms, setTerms] = useState(
    initial?.paymentTermsDays != null ? String(initial.paymentTermsDays) : '30',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErr('Vendor name is required.');
      return;
    }
    const g = gstin.trim().toUpperCase();
    if (g && !GSTIN_RE.test(g)) {
      setErr('GSTIN format looks off — expected 15 chars like 27ABCDE1234F1Z5.');
      return;
    }
    const p = pan.trim().toUpperCase();
    if (p && !PAN_RE.test(p)) {
      setErr('PAN format looks off — expected 10 chars like ABCDE1234F.');
      return;
    }
    const t = Number.parseInt(terms, 10);
    onSubmit({
      name: trimmedName,
      cat,
      gstin: g || undefined,
      pan: p || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      paymentTermsDays: Number.isFinite(t) ? t : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal title={mode === 'edit' ? 'Edit Vendor' : 'New Vendor'} onClose={onClose} width={560}>
      <form onSubmit={submit} className="os-form">
        <Field label="Vendor name" full>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bandra Studios"
          />
        </Field>
        <Field label="Category">
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {/* Payment terms persist on create (party-billing profile) but the
            quick-edit only patches the vendors row, so it's create-only to
            avoid a field that silently doesn't save. Edit it from billing. */}
        {mode === 'create' ? (
          <Field label="Payment terms (days)">
            <input
              type="number"
              min={0}
              max={180}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="30"
            />
          </Field>
        ) : null}
        <Field label="GSTIN" hint="Captured, never computed. 15 chars.">
          <input
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            placeholder="27ABCDE1234F1Z5"
            className="font-mono"
            maxLength={15}
          />
        </Field>
        <Field label="PAN">
          <input
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            className="font-mono"
            maxLength={10}
          />
        </Field>
        {/* Contact + address live in child tables (entity_contacts /
            entity_addresses). They're captured on create; edit them from the
            vendor window's Contacts tab. Hidden on edit so the form never
            shows a field that won't save. */}
        {mode === 'create' ? (
          <>
            <Field label="Email" full>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="billing@vendor.com"
              />
            </Field>
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98xxxxxxxx"
              />
            </Field>
            <Field label="Address" full>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Registered office address"
              />
            </Field>
          </>
        ) : null}
        <Field label="Notes" full>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything we should remember — payment quirks, preferred POC, etc."
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <Icon name="check" size={13} />
            Save Vendor
          </button>
        </div>
      </form>
    </Modal>
  );
}

const INVOICE_STATUSES: readonly VendorInvoiceStatus[] = ['Draft', 'Pending', 'Approved', 'Paid'];

function todayIndian(): string {
  const d = new Date();
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function InvoiceFormModal({
  mode,
  vendor,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  vendor: Vendor;
  initial?: Partial<VendorInvoice>;
  onClose: () => void;
  onSubmit: (input: Omit<VendorInvoice, 'id' | 'createdAt'>) => void;
}) {
  const [number, setNumber] = useState(initial?.number ?? '');
  const [date, setDate] = useState(initial?.date ?? todayIndian());
  const [subtotal, setSubtotal] = useState(
    initial?.subtotal != null ? paiseToDecimalRupees(initial.subtotal) : '',
  );
  const [gst, setGst] = useState(initial?.gst != null ? paiseToDecimalRupees(initial.gst) : '');
  const [tds, setTds] = useState(initial?.tds != null ? paiseToDecimalRupees(initial.tds) : '');
  const [total, setTotal] = useState(
    initial?.total != null ? paiseToDecimalRupees(initial.total) : '',
  );
  const [status, setStatus] = useState<VendorInvoiceStatus>(initial?.status ?? 'Pending');
  const [fileName, setFileName] = useState<string | undefined>(initial?.fileName);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const numberRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    numberRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!number.trim()) return setErr('Invoice number is required.');
    const subPaise = parseRupeesToPaise(subtotal);
    const totPaise = parseRupeesToPaise(total);
    const gPaise = gst.trim() === '' ? 0n : parseRupeesToPaise(gst);
    const tPaise = tds.trim() === '' ? 0n : parseRupeesToPaise(tds);
    if (subPaise === null || subPaise < 0n) return setErr('Subtotal must be a positive number.');
    if (totPaise === null || totPaise < 0n) return setErr('Total must be a positive number.');
    onSubmit({
      vendorId: vendor.id,
      number: number.trim(),
      date: date.trim() || todayIndian(),
      subtotal: subPaise,
      gst: gPaise ?? 0n,
      tds: tPaise ?? 0n,
      total: totPaise,
      status,
      fileName,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal
      title={
        mode === 'edit'
          ? `Edit Invoice ${initial?.number ?? ''}`.trim()
          : `New Invoice — ${vendor.name}`
      }
      onClose={onClose}
      width={560}
    >
      <form onSubmit={submit} className="os-form">
        <Field label="Invoice number">
          <input
            ref={numberRef}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="INV-2026-118"
            className="font-mono"
          />
        </Field>
        <Field label="Date">
          <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="22 May 26" />
        </Field>
        <Field label="Subtotal (₹)" hint="From the invoice — never computed.">
          <input
            type="number"
            step="0.01"
            min={0}
            value={subtotal}
            onChange={(e) => setSubtotal(e.target.value)}
            placeholder="100000"
          />
        </Field>
        <Field label="GST captured (₹)">
          <input
            type="number"
            step="0.01"
            min={0}
            value={gst}
            onChange={(e) => setGst(e.target.value)}
            placeholder="18000"
          />
        </Field>
        <Field label="TDS captured (₹)">
          <input
            type="number"
            step="0.01"
            min={0}
            value={tds}
            onChange={(e) => setTds(e.target.value)}
            placeholder="2000"
          />
        </Field>
        <Field label="Total (₹)" hint="The number printed on the invoice.">
          <input
            type="number"
            step="0.01"
            min={0}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="116000"
          />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as VendorInvoiceStatus)}>
            {INVOICE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label={mode === 'edit' ? 'Replace PDF (optional)' : 'Attach PDF (optional)'}>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? fileName)}
          />
          {fileName && <span className="os-field-hint">Attached: {fileName}</span>}
        </Field>
        <Field label="Notes" full>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal context for the approver."
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <Icon name="check" size={13} />
            {mode === 'edit' ? 'Save changes' : 'Save Invoice'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const DOC_KINDS: readonly VendorDocumentKind[] = [
  'Agreement',
  'MSA',
  'NDA',
  'PO',
  'KYC',
  'GST Certificate',
  'Bank Details',
  'Other',
];

function DocumentFormModal({
  mode,
  vendor,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  vendor: Vendor;
  initial?: Partial<VendorDocument>;
  onClose: () => void;
  onSubmit: (input: Omit<VendorDocument, 'id' | 'uploadedAt'>) => void;
}) {
  const [kind, setKind] = useState<VendorDocumentKind>(initial?.kind ?? 'Agreement');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [fileName, setFileName] = useState(initial?.fileName ?? '');
  const [expiresOn, setExpiresOn] = useState(initial?.expiresOn ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Document title is required.');
    if (!fileName.trim())
      return setErr(mode === 'edit' ? 'File name is required.' : 'Pick a file to upload.');
    onSubmit({
      vendorId: vendor.id,
      kind,
      title: title.trim(),
      fileName: fileName.trim(),
      expiresOn: expiresOn.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal
      title={
        mode === 'edit'
          ? `Edit Document — ${initial?.title ?? ''}`.trim()
          : `Upload Document — ${vendor.name}`
      }
      onClose={onClose}
      width={520}
    >
      <form onSubmit={submit} className="os-form">
        <Field label="Document type">
          <select value={kind} onChange={(e) => setKind(e.target.value as VendorDocumentKind)}>
            {DOC_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Expires on (optional)" hint="For dated agreements.">
          <input
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            placeholder="31 Mar 27"
          />
        </Field>
        <Field label="Title" full>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="MSA — FY26"
          />
        </Field>
        <Field label={mode === 'edit' ? 'File name' : 'File'} full>
          {mode === 'edit' ? (
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="font-mono"
              placeholder="MSA_FY26_signed.pdf"
            />
          ) : (
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
            />
          )}
          {mode === 'create' && fileName && (
            <span className="os-field-hint">Selected: {fileName}</span>
          )}
        </Field>
        <Field label="Notes" full>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Signed by both parties, scanned copy."
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <Icon name="check" size={13} />
            {mode === 'edit' ? 'Save changes' : 'Upload'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Projects (Kanban)                                                          */
/* -------------------------------------------------------------------------- */

const PROJECT_COLS: readonly ('Proposed' | 'Active' | 'Review' | 'Completed')[] = [
  'Proposed',
  'Active',
  'Review',
  'Completed',
];

export function ProjectsApp({
  canEdit = true,
  canDelete = true,
}: {
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newCol, setNewCol] = useState<(typeof PROJECT_COLS)[number]>('Proposed');
  const [editing, setEditing] = useState<Project | null>(null);
  const [confirmDel, setConfirmDel] = useState<Project | null>(null);

  // Real DB-backed projects list. Replaces useBusinessData. Each row carries
  // the real {id, clientId, leadEmployeeId} so the form / archive call hit
  // the DB rather than localStorage.
  const [dbProjects, setDbProjects] = useState<readonly Project[] | null>(null);

  function mapRow(r: ProjectListRow): Project {
    return {
      id: r.id,
      clientId: r.clientId,
      leadEmployeeId: r.leadEmployeeId,
      code: r.code ?? r.id.slice(0, 8),
      name: r.name,
      client: r.clientName,
      clientArchived: r.clientArchived,
      lead: r.leadName ? initials(r.leadName) : '—',
      col: dbStatusToCol(r.status),
      fee: r.feePaise,
    };
  }

  async function reload() {
    try {
      const rows = await listAllProjects();
      setDbProjects(rows.filter((r) => !r.isArchived).map(mapRow));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load projects');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAllProjects()
      .then((rows) => {
        if (cancelled) return;
        setDbProjects(rows.filter((r) => !r.isArchived).map(mapRow));
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Load failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = { projects: dbProjects ?? [] };

  // Local action wrappers (replace the prior useBusinessData ones).
  async function addProject(input: {
    name: string;
    client: string;
    clientId?: string;
    lead: string;
    leadEmployeeId?: string | null;
    col: (typeof PROJECT_COLS)[number];
    fee: bigint;
  }) {
    if (!input.clientId) {
      toast.error('Pick a client.');
      return;
    }
    try {
      await createProject({
        clientId: input.clientId,
        leadEmployeeId: input.leadEmployeeId ?? null,
        name: input.name,
        status: colToDbStatus(input.col),
        feePaise: input.fee,
      });
      toast.success('Project created.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  }

  async function updateProjectAction(
    projectId: string,
    patch: {
      name?: string;
      clientId?: string;
      leadEmployeeId?: string | null;
      col?: (typeof PROJECT_COLS)[number];
      fee?: bigint;
    },
  ) {
    try {
      await updateProject(projectId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
        ...(patch.leadEmployeeId !== undefined ? { leadEmployeeId: patch.leadEmployeeId } : {}),
        ...(patch.col !== undefined ? { status: colToDbStatus(patch.col) } : {}),
        ...(patch.fee !== undefined ? { feePaise: patch.fee } : {}),
      });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  }

  async function removeProjectAction(projectId: string) {
    try {
      await archiveProject(projectId);
      toast.success('Project archived.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Archive failed');
    }
  }

  const q = search.toLowerCase();
  const visible = data.projects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.client.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q),
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Projects</h2>
        <span className="sub">
          {data.projects.length} {data.projects.length === 1 ? 'project' : 'projects'} · FY26
        </span>
        <div className="grow" />
        <div className="search-input">
          <Icon name="search" size={13} />
          <input
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn primary"
          type="button"
          disabled={!canEdit}
          onClick={() => {
            setNewCol('Proposed');
            setShowNew(true);
          }}
          title={canEdit ? undefined : 'You need edit permission to create projects.'}
        >
          <Icon name="plus" size={13} />
          New Project
        </button>
      </div>
      <div className="kanban">
        {PROJECT_COLS.map((col) => {
          const items = visible.filter((p) => p.col === col);
          return (
            <div key={col} className="kanban-col">
              <div className="kanban-col-head">
                <span className="name">{col}</span>
                <span className="count">{items.length}</span>
                <div style={{ flex: 1 }} />
                {canEdit && (
                  <button
                    type="button"
                    className="kanban-col-add"
                    aria-label={`Add project to ${col}`}
                    onClick={() => {
                      setNewCol(col);
                      setShowNew(true);
                    }}
                  >
                    <Icon name="plus" size={12} />
                  </button>
                )}
              </div>
              {items.map((p) => (
                <div key={p.code} className="proj-card">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <div className="code">{p.code}</div>
                    {(canEdit || canDelete) && (
                      <div className="proj-card-actions">
                        {canEdit && (
                          <button
                            type="button"
                            className="proj-card-btn"
                            title="Edit project"
                            onClick={() => setEditing(p)}
                          >
                            <Icon name="edit" size={11} />
                          </button>
                        )}
                        {canEdit && col !== 'Completed' && (
                          <button
                            type="button"
                            className="proj-card-btn"
                            title="Move to next stage"
                            onClick={() => {
                              const next =
                                PROJECT_COLS[
                                  Math.min(PROJECT_COLS.indexOf(p.col) + 1, PROJECT_COLS.length - 1)
                                ];
                              if (next && p.id) void updateProjectAction(p.id, { col: next });
                            }}
                          >
                            <Icon name="arrowRight" size={11} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="proj-card-btn proj-card-delete"
                            title="Delete project"
                            onClick={() => setConfirmDel(p)}
                          >
                            <Icon name="trash" size={11} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    <div
                      className="avatar"
                      style={{ width: 18, height: 18, fontSize: 8, background: '#7A4E2D' }}
                    >
                      {p.lead}
                    </div>
                    <span>
                      {p.client.split(' ').slice(0, 2).join(' ')}
                      {p.clientArchived ? (
                        <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>(ex-client)</span>
                      ) : null}
                    </span>
                    <div className="grow" />
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                      {formatINR(p.fee)}
                    </span>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-dim)',
                    textAlign: 'center',
                    padding: '8px 4px 4px',
                  }}
                >
                  Nothing here yet
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showNew && (
        <ProjectFormModal
          mode="create"
          defaultCol={newCol}
          onClose={() => setShowNew(false)}
          onSubmit={(input) => {
            void addProject(input);
            setShowNew(false);
          }}
        />
      )}
      {editing && (
        <ProjectFormModal
          mode="edit"
          initial={editing}
          defaultCol={editing.col}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            if (editing.id) {
              void updateProjectAction(editing.id, {
                name: input.name,
                clientId: input.clientId,
                leadEmployeeId: input.leadEmployeeId ?? null,
                // Only send status when the column actually changed — the
                // col↔status map is lossy (won→Proposed→pitch,
                // cancelled→Completed→completed), so an unchanged column
                // would silently corrupt the real DB status.
                ...(input.col !== editing.col ? { col: input.col } : {}),
                // Only send fee when it actually changed — a blank/0 fee on
                // edit would otherwise wipe the captured fee.
                ...(input.fee !== editing.fee ? { fee: input.fee } : {}),
              });
            }
            setEditing(null);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Archive ${confirmDel.code}?`}
          message={`This archives ${confirmDel.name}. Transactions and history stay; restore via partner action.`}
          destructive
          confirmLabel="Archive project"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            if (confirmDel.id) void removeProjectAction(confirmDel.id);
            setConfirmDel(null);
          }}
        />
      )}
    </div>
  );
}

function ProjectFormModal({
  mode,
  initial,
  defaultCol,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<Project>;
  defaultCol: (typeof PROJECT_COLS)[number];
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    client: string;
    clientId: string;
    lead: string;
    leadEmployeeId: string | null;
    col: (typeof PROJECT_COLS)[number];
    fee: bigint;
  }) => void;
}) {
  // Real DB clients + employees for the dropdowns. Loaded once on mount.
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [employeeOptions, setEmployeeOptions] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDbClients(), listDbEmployees()])
      .then(([cs, es]) => {
        if (cancelled) return;
        setClientOptions(cs.map((c) => ({ id: c.id, name: c.name })));
        setEmployeeOptions(es.map((e) => ({ id: e.id, name: e.fullName })));
      })
      .catch(() => {
        /* fall through to empty lists */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [name, setName] = useState(initial?.name ?? '');
  const [clientId, setClientId] = useState<string>(initial?.clientId ?? '');
  const [leadEmployeeId, setLeadEmployeeId] = useState<string>(initial?.leadEmployeeId ?? '');
  const [col, setCol] = useState<(typeof PROJECT_COLS)[number]>(initial?.col ?? defaultCol);
  const [fee, setFee] = useState(
    initial?.fee != null && initial.fee > 0n
      ? new Intl.NumberFormat('en-IN').format(initial.fee / 100n)
      : '',
  );
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // When the dropdowns load, default to the first option if nothing was
  // pre-selected — preserves the previous UX where the form opened with
  // a sensible default selection. Deferred via microtask so the lint
  // doesn't see a synchronous setState inside the effect body.
  useEffect(() => {
    if (clientId || clientOptions.length === 0) return;
    const id = clientOptions[0]!.id;
    queueMicrotask(() => setClientId((prev) => prev || id));
  }, [clientOptions, clientId]);
  useEffect(() => {
    if (leadEmployeeId || employeeOptions.length === 0) return;
    const id = employeeOptions[0]!.id;
    queueMicrotask(() => setLeadEmployeeId((prev) => prev || id));
  }, [employeeOptions, leadEmployeeId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr('Project name is required.');
    if (!clientId) return setErr('Pick a client (or add one first via the Clients app).');
    const feePaise = fee.trim() === '' ? 0n : (parseRupeesToPaise(fee) ?? 0n);

    const clientName = clientOptions.find((c) => c.id === clientId)?.name ?? initial?.client ?? '';
    const leadName = leadEmployeeId
      ? (employeeOptions.find((e) => e.id === leadEmployeeId)?.name ?? '')
      : '';
    const leadCode = leadName
      ? leadName
          .split(/\s+/)
          .slice(0, 2)
          .map((s) => s[0] ?? '')
          .join('')
          .toUpperCase()
      : '—';

    onSubmit({
      name: n,
      client: clientName,
      clientId,
      lead: leadCode,
      leadEmployeeId: leadEmployeeId || null,
      col,
      fee: feePaise > 0n ? feePaise : 0n,
    });
  };

  return (
    <Modal
      title={mode === 'edit' ? `Edit ${initial?.code ?? 'Project'}` : 'New Project'}
      onClose={onClose}
      width={520}
    >
      <form onSubmit={submit} className="os-form">
        <Field label="Project name" full>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Diwali Festive Campaign"
          />
        </Field>
        <Field label="Client">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clientOptions.length === 0 ? (
              <option value="">— No clients yet —</option>
            ) : (
              clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        </Field>
        <Field label="Stage">
          <select
            value={col}
            onChange={(e) => setCol(e.target.value as (typeof PROJECT_COLS)[number])}
          >
            {PROJECT_COLS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Lead">
          <select value={leadEmployeeId} onChange={(e) => setLeadEmployeeId(e.target.value)}>
            {employeeOptions.length === 0 ? (
              <option value="">— No team members yet —</option>
            ) : (
              <>
                <option value="">— Unassigned —</option>
                {employeeOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </Field>
        <Field label="Fee (₹)" hint="Captured from the SOW. Apar doesn't compute totals.">
          <input
            type="text"
            inputMode="numeric"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="48,00,000"
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <Icon name="check" size={13} />
            {mode === 'edit' ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Employees                                                                  */
/* -------------------------------------------------------------------------- */

type EmpStatusUi = 'active' | 'notice' | 'separated';

const EMP_STATUS_META: Record<EmpStatusUi, { label: string; fg: string; bg: string }> = {
  active: { label: 'Active', fg: '#2e8f5a', bg: 'rgba(46,143,90,0.12)' },
  notice: { label: 'Notice', fg: '#c46a28', bg: 'rgba(196,106,40,0.14)' },
  separated: { label: 'Separated', fg: 'var(--text-muted)', bg: 'var(--content-2)' },
};

const EMP_TYPE_LABEL: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
  intern: 'Intern',
};

type DirRow = HrEmployee & { tone: string; managerName: string | null };

export function EmployeesApp({
  canEdit = true,
  canDelete = true,
}: {
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [rows, setRows] = useState<readonly DirRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | EmpStatusUi>('all');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'joined' | 'dept'>('name');
  const [showInactive, setShowInactive] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showDepts, setShowDepts] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<DirRow | null>(null);

  // Real DB-backed list. Clicking a card passes a real UUID into the
  // openWindow route → EmployeeWindow renders the §8.4 dashboard. Edits go
  // straight to the DB (create/updateEmployee / archiveEmployee) then refetch.
  async function fetchEmployeeList(): Promise<readonly DirRow[]> {
    const list = await listDbEmployees();
    const nameById = new Map(list.map((r) => [r.id, r.fullName]));
    return list.map((r) => ({
      ...r,
      tone: toneForName(r.fullName),
      managerName: r.reportsTo ? (nameById.get(r.reportsTo) ?? null) : null,
    }));
  }

  async function refreshEmployeeList() {
    const next = await fetchEmployeeList().catch(() => null);
    if (next) setRows(next);
  }

  function exportEmployees() {
    const headers = [
      'Full Name',
      'Work Email',
      'Designation',
      'Department',
      'Employment Type',
      'Status',
      'Joined',
      'Reports To',
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = visible.map((e) =>
      [
        e.fullName,
        e.workEmail ?? '',
        e.designation ?? '',
        departmentLabel(e.department),
        e.employmentType,
        e.status,
        e.joinedAt instanceof Date ? e.joinedAt.toISOString().slice(0, 10) : '',
        e.managerName ?? '',
      ]
        .map(esc)
        .join(','),
    );
    const csv = [headers.join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employees.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let cancelled = false;
    fetchEmployeeList()
      .then((mapped) => {
        if (!cancelled) setRows(mapped);
      })
      .catch(() => {
        /* fall through to empty list */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = rows ?? [];
  const deptOptions = Array.from(
    new Set(all.map((e) => departmentLabel(e.department)).filter((d) => d && d !== '—')),
  ).sort();
  const q = search.trim().toLowerCase();
  const filtered = all
    .filter((e) => (showInactive || filterStatus === 'separated' ? true : e.status !== 'separated'))
    .filter((e) => (filterStatus === 'all' ? true : e.status === filterStatus))
    .filter((e) => (filterType === 'all' ? true : e.employmentType === filterType))
    .filter((e) => (filterDept === 'all' ? true : departmentLabel(e.department) === filterDept))
    .filter((e) =>
      q === ''
        ? true
        : [e.fullName, e.designation, departmentLabel(e.department), e.workEmail].some((v) =>
            (v ?? '').toLowerCase().includes(q),
          ),
    );
  const visible = [...filtered].sort((a, b) => {
    if (sortBy === 'joined') return b.joinedAt.getTime() - a.joinedAt.getTime();
    if (sortBy === 'dept')
      return (
        departmentLabel(a.department).localeCompare(departmentLabel(b.department)) ||
        a.fullName.localeCompare(b.fullName)
      );
    return a.fullName.localeCompare(b.fullName);
  });
  const activeCount = all.filter((e) => e.status === 'active').length;
  const roster = all.map((e) => ({ id: e.id, name: e.fullName }));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Team</h2>
        <span className="sub">
          {all.length} {all.length === 1 ? 'person' : 'people'} · {activeCount} active ·{' '}
          {deptOptions.length} dept{deptOptions.length === 1 ? '' : 's'}
        </span>
        <div className="grow" />
        <button
          className="btn"
          type="button"
          disabled={!canEdit}
          onClick={() => setShowDepts(true)}
          title={
            canEdit
              ? 'Add, rename or remove departments'
              : 'You need edit permission to manage departments.'
          }
        >
          <Icon name="folder" size={13} />
          Departments
        </button>
        <button
          className="btn"
          type="button"
          onClick={exportEmployees}
          disabled={visible.length === 0}
          title="Export the current list to CSV"
        >
          <Icon name="filetext" size={13} />
          Export
        </button>
        {canEdit ? <ImportEmployeesDialog onImported={refreshEmployeeList} /> : null}
        <button
          className="btn primary"
          type="button"
          disabled={!canEdit}
          onClick={() => setShowNew(true)}
          title={canEdit ? undefined : 'You need edit permission to invite teammates.'}
        >
          <Icon name="plus" size={13} />
          Invite
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <input
          className="input"
          style={{ flex: '1 1 200px', minWidth: 160 }}
          placeholder="Search name, role, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search team"
        />
        <select
          className="input"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as 'all' | EmpStatusUi)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="notice">Notice</option>
          <option value="separated">Separated</option>
        </select>
        <select
          className="input"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          aria-label="Filter by employment type"
        >
          <option value="all">All types</option>
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
          <option value="contractor">Contractor</option>
          <option value="intern">Intern</option>
        </select>
        <select
          className="input"
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          aria-label="Filter by department"
        >
          <option value="all">All departments</option>
          {deptOptions.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          className="input"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'name' | 'joined' | 'dept')}
          aria-label="Sort by"
        >
          <option value="name">Sort: Name</option>
          <option value="joined">Sort: Joined</option>
          <option value="dept">Sort: Department</option>
        </select>
        <button
          type="button"
          className={`toggle ${showInactive ? 'on' : ''}`}
          role="switch"
          aria-checked={showInactive}
          aria-label="Show separated teammates"
          title="Show separated / archived teammates"
          onClick={() => setShowInactive((v) => !v)}
        />
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Show inactive</span>
      </div>

      <div
        className="card-grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          flex: 1,
          minHeight: 0,
        }}
      >
        {rows === null ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: 28,
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}
          >
            Loading team…
          </div>
        ) : (
          visible.map((e) => {
            const sm = EMP_STATUS_META[e.status];
            return (
              <div
                key={e.id}
                className="emp-card emp-card-actionable"
                role="button"
                tabIndex={0}
                onClick={() => navigateBesideFocused({ type: 'employee', id: e.id })}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    navigateBesideFocused({ type: 'employee', id: e.id });
                  }
                }}
                style={{
                  cursor: 'pointer',
                  alignItems: 'flex-start',
                  opacity: e.status === 'separated' ? 0.7 : 1,
                }}
                title={`Open ${e.fullName}'s profile`}
              >
                <div
                  className="avatar"
                  style={{
                    width: 44,
                    height: 44,
                    fontSize: 14,
                    background: e.tone,
                    borderRadius: 12,
                  }}
                >
                  {initials(e.fullName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      className="name"
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.fullName}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 7px',
                        borderRadius: 999,
                        color: sm.fg,
                        background: sm.bg,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {sm.label}
                    </span>
                  </div>
                  <div className="role">{e.designation || '—'}</div>
                  <div className="dept">
                    {departmentLabel(e.department)} ·{' '}
                    {EMP_TYPE_LABEL[e.employmentType] ?? e.employmentType}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 3,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    {e.workEmail ? (
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {e.workEmail}
                      </span>
                    ) : null}
                    <span>
                      Joined{' '}
                      {e.joinedAt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      {e.managerName ? ` · ↳ ${e.managerName}` : ''}
                    </span>
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div className="emp-card-actions" onClick={(ev) => ev.stopPropagation()}>
                    {canEdit && (
                      <button
                        type="button"
                        className="emp-card-btn"
                        title="Edit profile"
                        onClick={() => setEditingId(e.id)}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                    {canDelete && e.status !== 'separated' && (
                      <button
                        type="button"
                        className="emp-card-btn emp-card-delete"
                        title="Remove from team"
                        onClick={() => setConfirmDel(e)}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {rows !== null && visible.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: 28,
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}
          >
            {all.length === 0
              ? 'No teammates yet — click "Invite" to add the first.'
              : 'No teammates match these filters.'}
          </div>
        )}
      </div>

      {showDepts && (
        <DepartmentsModal
          canEdit={canEdit}
          onClose={() => setShowDepts(false)}
          onChanged={() => {
            void refreshEmployeeList();
          }}
        />
      )}
      {showNew && (
        <EmployeeProfileEditor
          mode="create"
          roster={roster}
          onClose={() => setShowNew(false)}
          onSaved={async (id, name) => {
            setShowNew(false);
            await refreshEmployeeList();
            if (id) navigateBesideFocused({ type: 'employee', id });
            toast.success(`${name} added to the team.`);
          }}
        />
      )}
      {editingId && (
        <EmployeeProfileEditor
          mode="edit"
          employeeId={editingId}
          roster={roster.filter((r) => r.id !== editingId)}
          onClose={() => setEditingId(null)}
          onSaved={async (_id, name) => {
            setEditingId(null);
            await refreshEmployeeList();
            toast.success(`Updated ${name}.`);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Remove ${confirmDel.fullName} from the team?`}
          message="They'll disappear from the active team directory. Projects and ledger entries that reference them aren't affected, and they can be restored later."
          destructive
          confirmLabel="Remove"
          onCancel={() => setConfirmDel(null)}
          onConfirm={async () => {
            const name = confirmDel.fullName;
            setConfirmDel(null);
            try {
              await archiveEmployee(confirmDel.id);
              await refreshEmployeeList();
              toast.success(`Removed ${name} from the team.`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not remove the teammate.');
            }
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Employee profile editor — full create + edit form (OS)                      */
/* -------------------------------------------------------------------------- */

type EmpType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'consultant';
type EmpStatus = 'prospective' | 'active' | 'on_leave' | 'notice' | 'separated';

const EMP_TYPE_OPTIONS: { value: EmpType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
  { value: 'consultant', label: 'Consultant' },
];
const EMP_STATUS_OPTIONS: { value: EmpStatus; label: string }[] = [
  { value: 'prospective', label: 'Prospective' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'notice', label: 'Notice' },
  { value: 'separated', label: 'Separated' },
];

type EditorForm = {
  fullName: string;
  displayName: string;
  designation: string;
  department: string;
  employmentType: EmpType;
  status: EmpStatus;
  workEmail: string;
  personalEmail: string;
  phone: string;
  reportsToEmployeeId: string;
  joinedOn: string;
  confirmedOn: string;
  separatedOn: string;
  noticePeriodDays: string;
  notes: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_EDITOR_FORM: EditorForm = {
  fullName: '',
  displayName: '',
  designation: '',
  department: '',
  employmentType: 'full_time',
  status: 'active',
  workEmail: '',
  personalEmail: '',
  phone: '',
  reportsToEmployeeId: '',
  joinedOn: '',
  confirmedOn: '',
  separatedOn: '',
  noticePeriodDays: '',
  notes: '',
};

function editableToForm(e: EditableEmployee): EditorForm {
  return {
    fullName: e.fullName,
    displayName: e.displayName ?? '',
    designation: e.designation ?? '',
    department: e.department ? departmentLabel(e.department) : '',
    employmentType: e.employmentType,
    status: e.status,
    workEmail: e.workEmail ?? '',
    personalEmail: e.personalEmail ?? '',
    phone: e.phone ?? '',
    reportsToEmployeeId: e.reportsToEmployeeId ?? '',
    joinedOn: e.joinedOn,
    confirmedOn: e.confirmedOn ?? '',
    separatedOn: e.separatedOn ?? '',
    noticePeriodDays: e.noticePeriodDays ?? '',
    notes: e.notes ?? '',
  };
}

function FieldErr({ msg }: { msg: string }) {
  return <div style={{ fontSize: 11, color: 'var(--apar-red)', marginTop: 3 }}>{msg}</div>;
}

export function EmployeeProfileEditor({
  mode,
  employeeId,
  roster,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  employeeId?: string;
  roster: readonly { id: string; name: string }[];
  onClose: () => void;
  onSaved: (id: string | null, name: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState<EditorForm>(() =>
    mode === 'create' ? { ...EMPTY_EDITOR_FORM, joinedOn: todayIso() } : EMPTY_EDITOR_FORM,
  );
  const [loading, setLoading] = useState(mode === 'edit');
  const [departments, setDepartments] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listDbDepartments()
      .then((d) => {
        if (active) setDepartments(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // `loading` initialises to (mode === 'edit'); the editor is mounted fresh
    // per edit, so we don't reset it synchronously here (that would trip the
    // no-sync-setState-in-effect rule).
    if (mode !== 'edit' || !employeeId) return;
    let active = true;
    getEmployeeEditable(employeeId)
      .then((e) => {
        if (!active) return;
        if (e) setForm(editableToForm(e));
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, employeeId]);

  const set = <K extends keyof EditorForm>(k: K, v: EditorForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!form.fullName.trim()) {
      setErrors({ fullName: 'Full name is required.' });
      return;
    }
    if (!form.joinedOn) {
      setErrors({ joinedOn: 'Joining date is required.' });
      return;
    }
    if ((form.status === 'notice' || form.status === 'separated') && !form.separatedOn) {
      setErrors({ separatedOn: 'Last working day is required for Notice/Separated status.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (mode === 'create') {
        const res = await createEmployee({
          fullName: form.fullName.trim(),
          displayName: form.displayName.trim() || undefined,
          designation: form.designation.trim() || undefined,
          department: form.department.trim() || undefined,
          employmentType: form.employmentType,
          status: form.status,
          workEmail: form.workEmail.trim() || undefined,
          personalEmail: form.personalEmail.trim() || undefined,
          phone: form.phone.trim() || undefined,
          reportsToEmployeeId: form.reportsToEmployeeId || undefined,
          joinedOn: form.joinedOn,
          confirmedOn: form.confirmedOn || undefined,
          separatedOn: form.separatedOn || undefined,
          noticePeriodDays: form.noticePeriodDays.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
        if (!res.ok) {
          setErrors(res.errors);
          toast.error(res.message);
          return;
        }
        await onSaved(res.id, form.fullName.trim());
      } else if (employeeId) {
        const res = await updateEmployee({
          id: employeeId,
          fullName: form.fullName.trim(),
          displayName: form.displayName.trim() || null,
          designation: form.designation.trim() || null,
          department: form.department.trim() || null,
          employmentType: form.employmentType,
          status: form.status,
          workEmail: form.workEmail.trim() || null,
          personalEmail: form.personalEmail.trim() || null,
          phone: form.phone.trim() || null,
          reportsToEmployeeId: form.reportsToEmployeeId || null,
          joinedOn: form.joinedOn,
          confirmedOn: form.confirmedOn || null,
          separatedOn: form.separatedOn || null,
          noticePeriodDays: form.noticePeriodDays.trim() || null,
          notes: form.notes.trim() || null,
        });
        if (!res.ok) {
          setErrors(res.errors);
          toast.error(res.message);
          return;
        }
        await onSaved(null, form.fullName.trim());
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the employee.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'edit' ? 'Edit Employee' : 'Add Employee'} onClose={onClose} width={620}>
      {loading ? (
        <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <form onSubmit={submit} className="os-form">
          <Field label="Full name" full>
            <input
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              placeholder="e.g. Riya Sengupta"
              autoFocus
            />
            {errors.fullName ? <FieldErr msg={errors.fullName} /> : null}
          </Field>
          <Field label="Display name">
            <input
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="Short / nick name"
            />
            {errors.displayName ? <FieldErr msg={errors.displayName} /> : null}
          </Field>
          <Field label="Designation">
            <input
              value={form.designation}
              onChange={(e) => set('designation', e.target.value)}
              placeholder="Senior Visualiser"
            />
            {errors.designation ? <FieldErr msg={errors.designation} /> : null}
          </Field>
          <Field label="Department">
            <input
              list="os-employee-departments"
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              placeholder="Pick or type"
            />
            <datalist id="os-employee-departments">
              {departments.map((d) => (
                <option key={d} value={departmentLabel(d)} />
              ))}
            </datalist>
            {errors.department ? <FieldErr msg={errors.department} /> : null}
          </Field>
          <Field label="Employment type">
            <select
              value={form.employmentType}
              onChange={(e) => set('employmentType', e.target.value as EmpType)}
            >
              {EMP_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as EmpStatus)}
            >
              {EMP_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reports to">
            <select
              value={form.reportsToEmployeeId}
              onChange={(e) => set('reportsToEmployeeId', e.target.value)}
            >
              <option value="">— No manager —</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Work email">
            <input
              type="email"
              value={form.workEmail}
              onChange={(e) => set('workEmail', e.target.value)}
              placeholder="name@apar.com"
            />
            {errors.workEmail ? <FieldErr msg={errors.workEmail} /> : null}
          </Field>
          <Field label="Personal email">
            <input
              type="email"
              value={form.personalEmail}
              onChange={(e) => set('personalEmail', e.target.value)}
            />
            {errors.personalEmail ? <FieldErr msg={errors.personalEmail} /> : null}
          </Field>
          <Field label="Phone">
            <input
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+91…"
            />
            {errors.phone ? <FieldErr msg={errors.phone} /> : null}
          </Field>
          <Field label="Joined on">
            <input
              type="date"
              value={form.joinedOn}
              onChange={(e) => set('joinedOn', e.target.value)}
            />
            {errors.joinedOn ? <FieldErr msg={errors.joinedOn} /> : null}
          </Field>
          <Field label="Confirmed on">
            <input
              type="date"
              value={form.confirmedOn}
              onChange={(e) => set('confirmedOn', e.target.value)}
            />
            {errors.confirmedOn ? <FieldErr msg={errors.confirmedOn} /> : null}
          </Field>
          {mode === 'edit' || form.status === 'notice' || form.status === 'separated' ? (
            <Field label={form.status === 'notice' || form.status === 'separated' ? "Last working day" : "Separated on"}>
              <input
                type="date"
                value={form.separatedOn}
                onChange={(e) => set('separatedOn', e.target.value)}
              />
              {errors.separatedOn ? <FieldErr msg={errors.separatedOn} /> : null}
            </Field>
          ) : null}
          <Field label="Notice period">
            <input
              value={form.noticePeriodDays}
              onChange={(e) => set('noticePeriodDays', e.target.value)}
              placeholder="e.g. 30 days"
            />
            {errors.noticePeriodDays ? <FieldErr msg={errors.noticePeriodDays} /> : null}
          </Field>
          <Field label="Notes" full>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Internal notes"
            />
          </Field>
          <div className="os-form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              <Icon name="check" size={13} />
              {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add to team'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Manage Departments                                                         */
/* -------------------------------------------------------------------------- */

function DepartmentsModal({
  canEdit,
  onClose,
  onChanged,
}: {
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<readonly DepartmentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();

  const load = () => {
    listDepartmentsDetailed()
      .then((r) => setRows(r))
      .catch(() => setLoadError('Could not load departments. You may not have permission.'));
  };
  useEffect(() => {
    let cancelled = false;
    listDepartmentsDetailed()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load departments. You may not have permission.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = () => {
    setAddError(null);
    const name = newName.trim();
    if (!name) {
      setAddError('Enter a department name.');
      return;
    }
    startAdd(async () => {
      const res = await createDepartment(name);
      if (!res.ok) {
        setAddError(res.errors?.name ?? res.message);
        toast.error(res.message);
        return;
      }
      setNewName('');
      toast.success(`Added “${departmentLabel(name)}”.`);
      load();
      onChanged();
    });
  };

  const startEdit = (d: DepartmentRow) => {
    setEditingId(d.id);
    setEditValue(d.label);
  };

  const saveRename = async (d: DepartmentRow) => {
    const next = editValue.trim();
    if (!next) return;
    setBusyId(d.id);
    const res = await renameDepartment(d.id, next);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setEditingId(null);
    toast.success(`Renamed to “${departmentLabel(next)}”.`);
    load();
    onChanged();
  };

  const remove = async (d: DepartmentRow) => {
    setBusyId(d.id);
    const res = await deleteDepartment(d.id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`Removed “${d.label}”.`);
    load();
    onChanged();
  };

  return (
    <Modal title="Manage Departments" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Add, rename, or remove the departments teammates can be assigned to. Renaming updates
          everyone in that department; a department can’t be removed while people are still in it.
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <input
                className="input"
                style={{ width: '100%' }}
                value={newName}
                maxLength={120}
                placeholder="New department (e.g. People Ops)"
                aria-label="New department name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add();
                  }
                }}
              />
              {addError ? (
                <div style={{ fontSize: 11.5, color: 'var(--apar-red)', marginTop: 4 }}>
                  {addError}
                </div>
              ) : null}
            </div>
            <button className="btn primary" type="button" onClick={add} disabled={adding}>
              <Icon name="plus" size={13} />
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}

        {loadError ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
            {loadError}
          </div>
        ) : !rows ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
            Loading departments…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
            No departments yet — add the first one above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((d) => {
              const isEditing = editingId === d.id;
              const busy = busyId === d.id;
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {isEditing ? (
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      value={editValue}
                      maxLength={120}
                      autoFocus
                      aria-label={`Rename ${d.label}`}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void saveRename(d);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{d.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {d.employeeCount} {d.employeeCount === 1 ? 'person' : 'people'}
                      </div>
                    </div>
                  )}

                  {canEdit &&
                    (isEditing ? (
                      <>
                        <button
                          className="btn primary"
                          type="button"
                          disabled={busy}
                          onClick={() => void saveRename(d)}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn"
                          type="button"
                          title="Rename department"
                          disabled={busy}
                          onClick={() => startEdit(d)}
                        >
                          <Icon name="edit" size={13} />
                        </button>
                        <button
                          className="btn"
                          type="button"
                          title={
                            d.employeeCount > 0
                              ? 'Move people out before removing'
                              : 'Remove department'
                          }
                          disabled={busy || d.employeeCount > 0}
                          onClick={() => void remove(d)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

const DOC_KIND_LABELS: Record<string, string> = {
  contract: 'Contract',
  msa: 'MSA',
  sow: 'SOW',
  nda: 'NDA',
  offer_letter: 'Offer letter',
  separation_letter: 'Separation letter',
  kyc_pan: 'PAN (KYC)',
  kyc_aadhaar: 'Aadhaar (KYC)',
  kyc_passport: 'Passport (KYC)',
  kyc_voter_id: 'Voter ID (KYC)',
  kyc_driving_license: 'Driving licence (KYC)',
  cancelled_cheque: 'Cancelled cheque',
  bank_statement: 'Bank statement',
  invoice: 'Invoice',
  receipt: 'Receipt',
  payslip: 'Payslip',
  salary_sheet: 'Salary sheet',
  reimbursement_receipt: 'Reimbursement receipt',
  expense_receipt: 'Expense receipt',
  photo: 'Photo',
  other: 'Other',
};

function docKindLabel(kind: string): string {
  return DOC_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

function formatDocDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

// Real document feed. Every file filed through a creation wizard or a
// profile's Documents tab surfaces here — no demo fixtures. Clicking a row
// opens the owning entity's window (where the doc lives in its Documents tab).
export function InboxApp() {
  const [docs, setDocs] = useState<readonly RecentDocumentRow[] | null>(null);
  const [filterKind, setFilterKind] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    listRecentDocuments(100)
      .then((rows) => {
        if (!cancelled) setDocs(rows);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = docs ?? [];
  const kinds = Array.from(new Set(all.map((d) => d.kind)));
  const visible = filterKind === 'all' ? all : all.filter((d) => d.kind === filterKind);

  const open = (d: RecentDocumentRow) =>
    navigateBesideFocused({
      type: d.entityType as 'client' | 'vendor' | 'employee' | 'project',
      id: d.entityId,
    });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Inbox</h2>
        <span className="sub">
          {all.length} recent document{all.length === 1 ? '' : 's'}
        </span>
        <div className="grow" />
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className="header-select"
          aria-label="Filter by document type"
        >
          <option value="all">All types</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {docKindLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {docs === null ? (
          <div
            style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
          >
            Loading documents…
          </div>
        ) : (
          visible.map((d) => (
            <div
              key={d.id}
              className="inbox-row"
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              title={`Open ${d.entityName ?? d.entityType}`}
              onClick={() => open(d)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  open(d);
                }
              }}
            >
              <div className="pdf-thumb">
                <div className="line" style={{ top: 8 }} />
                <div className="line" style={{ top: 14, right: 16 }} />
                <div className="line" style={{ top: 22 }} />
                <div className="line" style={{ top: 28, right: 12 }} />
                <div className="line" style={{ top: 36 }} />
                <div className="line" style={{ top: 42, right: 18 }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{d.filename}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                  <span className="pill slate" style={{ marginRight: 8 }}>
                    <span className="dot" />
                    {docKindLabel(d.kind)}
                  </span>
                  {d.entityName ?? d.entityType}
                  {d.uploadedBy ? ` · by ${d.uploadedBy}` : ''} · {formatDocDate(d.createdAt)}
                </div>
              </div>
              <Icon name="arrowRight" size={14} />
            </div>
          ))
        )}
        {docs !== null && visible.length === 0 && (
          <div
            style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
          >
            {all.length === 0
              ? 'No documents filed yet. Upload one from a client, vendor, or employee profile.'
              : `No ${docKindLabel(filterKind)} documents.`}
          </div>
        )}
      </div>
    </div>
  );
}

// `LedgerApp` placeholder removed in Phase 4. The dispatcher now routes
// `app: 'ledger'` to `<LedgerWindow>` in
// `src/components/os/apps/ledger-window.tsx`, which embeds B's
// `<TransactionList>` (LEDGER-SPEC §0.1 + §5).

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

// Real, DB-backed reports catalog. Each tile opens the corresponding
// dashboard report route (trial balance, P&L, AR/AP aging, etc.) which runs
// against the live ledger — no fabricated KPI numbers. Grouped to match the
// dashboard /reports catalog.
const OS_REPORT_GROUPS: ReadonlyArray<{
  heading: string;
  reports: ReadonlyArray<{ slug: string; label: string; desc: string }>;
}> = [
  {
    heading: 'Financial statements',
    reports: [
      {
        slug: 'trial-balance',
        label: 'Trial Balance',
        desc: 'Debit & credit balances per account.',
      },
      { slug: 'balance-sheet', label: 'Balance Sheet', desc: 'Assets, liabilities & equity.' },
      { slug: 'pnl', label: 'Profit & Loss', desc: 'Income and expenses over a period.' },
      { slug: 'cash-flow', label: 'Cash Flow', desc: 'Cash inflows and outflows.' },
    ],
  },
  {
    heading: 'Receivables & payables',
    reports: [
      { slug: 'ar-aging', label: 'AR Aging', desc: 'Outstanding receivables by age.' },
      { slug: 'ap-aging', label: 'AP Aging', desc: 'Outstanding payables by age.' },
    ],
  },
  {
    heading: 'Ledgers & statements',
    reports: [
      { slug: 'bank-book', label: 'Bank Book', desc: 'Bank movements + running balance.' },
      { slug: 'statement', label: 'Statement of Account', desc: 'Per-party ledger statement.' },
      { slug: 'per-client-pnl', label: 'Per-Client P&L', desc: 'Profitability by client.' },
    ],
  },
];

export function ReportsApp({
  onOpenReport,
}: {
  /** Open a report inside the OS. Falls back to a new browser tab if absent. */
  onOpenReport?: (slug: string, label: string) => void;
} = {}) {
  const openReport = (slug: string, label: string) => {
    if (onOpenReport) {
      onOpenReport(slug, label);
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(`/reports/${slug}`, '_blank', 'noopener,noreferrer');
    }
  };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Reports</h2>
        <span className="sub">Live accounting & management reports</span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {OS_REPORT_GROUPS.map((group) => (
          <div key={group.heading} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
              }}
            >
              {group.heading}
            </div>
            <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {group.reports.map((r) => (
                <div
                  key={r.slug}
                  className="report-tile"
                  role="button"
                  tabIndex={0}
                  onClick={() => openReport(r.slug, r.label)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openReport(r.slug, r.label);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                  title={`Open ${r.label}`}
                >
                  <div className="label">{r.label}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {r.desc}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--accent, #E63A1F)', marginTop: 10 }}>
                    Open report →
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Client-detail tab modals (Add Contact, Upload Doc, Record Tx)              */
/* -------------------------------------------------------------------------- */

function AddContactModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: { name: string; role: string }) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Contact name is required.');
    if (!role.trim()) return setErr('Role is required.');
    onAdd({ name: name.trim(), role: role.trim() });
  };

  return (
    <Modal title="Add Contact" onClose={onClose} width={480}>
      <form onSubmit={submit} className="os-form">
        <Field label="Full name" full>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Anjali Sharma"
          />
        </Field>
        <Field label="Role" full>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Head of Marketing"
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Add contact
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UploadClientDocModal({
  onClose,
  onUpload,
}: {
  onClose: () => void;
  onUpload: (filename: string) => void;
}) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr('Filename is required.');
    onUpload(n.toLowerCase().endsWith('.pdf') ? n : `${n}.pdf`);
  };

  return (
    <Modal title="Upload Document" onClose={onClose} width={480}>
      <form onSubmit={submit} className="os-form">
        <Field
          label="Document name"
          hint="Demo only — no real file upload. Production uses Supabase Storage."
          full
        >
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="MSA_v3_signed.pdf"
            className="font-mono"
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Upload
          </button>
        </div>
      </form>
    </Modal>
  );
}

// `RecordTxModal` + ledger enums removed in Phase 1 — the OS no longer
// accepts free-form single-entry transactions. Real posting flows through
// extraction → review → confirm once that pipeline ships.

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

type SettingsSection = {
  name:
    | 'General'
    | 'Company documents'
    | 'Billing'
    | 'Invoice format'
    | 'Vault'
    | 'Appearance'
    | 'Account'
    | 'Team'
    | 'Notifications'
    | 'Security';
  icon: IconName;
};

export function SettingsApp({
  settings,
  onSettingsChange,
  onResetSettings,
  currentUserRole,
  onSignOut,
  onDisplayNameChange,
}: {
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
  onResetSettings?: () => void;
  currentUserRole?: 'super_admin' | 'admin' | 'user';
  onSignOut?: () => void;
  onDisplayNameChange?: (fullName: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection['name']>('General');
  // Apps a user can pick as their landing app (admin-only apps excluded).
  const landingApps = APPS.filter((a) => a.id !== 'admin_console');
  const sections: readonly SettingsSection[] = [
    { name: 'General', icon: 'settings' },
    { name: 'Company documents', icon: 'building' },
    { name: 'Billing', icon: 'book' },
    { name: 'Invoice format', icon: 'filetext' },
    { name: 'Vault', icon: 'shield' },
    { name: 'Appearance', icon: 'palette' },
    { name: 'Account', icon: 'user' },
    { name: 'Team', icon: 'users' },
    { name: 'Notifications', icon: 'bell' },
    { name: 'Security', icon: 'shield' },
  ];
  return (
    <>
      <div className="sidebar">
        <h4>Preferences</h4>
        {sections.map((s) => (
          <div
            key={s.name}
            className={`side-item ${section === s.name ? 'active' : ''}`}
            onClick={() => setSection(s.name)}
          >
            <Icon name={s.icon} size={14} /> {s.name}
          </div>
        ))}
      </div>
      <div className="main">
        <div className="main-header">
          <h2>{section}</h2>
        </div>
        {section === 'General' ? (
          <div>
            <div className="settings-row">
              <div>
                <div className="label">Default landing app</div>
                <div className="desc">
                  Automatically opened when you sign in. Saved to your profile and synced across
                  devices.
                </div>
              </div>
              <select
                className="input"
                style={{ maxWidth: 220 }}
                value={settings.defaultLandingApp}
                aria-label="Default landing app"
                onChange={(e) => onSettingsChange({ defaultLandingApp: e.target.value })}
              >
                <option value="">None — empty desktop</option>
                {landingApps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Reset preferences</div>
                <div className="desc">
                  Clear all saved settings on your profile and restore the defaults.
                </div>
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => onResetSettings?.()}
                disabled={!onResetSettings}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        ) : section === 'Appearance' ? (
          <div>
            <div className="settings-row">
              <div>
                <div className="label">Dark Mode</div>
                <div className="desc">
                  Switch the OS to a darker palette for evening sessions. Saved to your profile.
                </div>
              </div>
              <div
                className={`toggle ${settings.theme === 'dark' ? 'on' : ''}`}
                onClick={() =>
                  onSettingsChange({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
                }
                role="switch"
                aria-checked={settings.theme === 'dark'}
              />
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Accent</div>
                <div className="desc">Used for selected items, focus states and links.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {ACCENTS.map((c) => {
                  const selected = settings.accent === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Accent ${c}`}
                      aria-pressed={selected}
                      title={c}
                      onClick={() => onSettingsChange({ accent: c })}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: c,
                        border: selected ? '2px solid var(--text)' : '2px solid transparent',
                        boxShadow: selected ? '0 0 0 2px var(--content)' : undefined,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Desktop Wallpaper</div>
                <div className="desc">Apar Charcoal Gradient · Default</div>
              </div>
              <button className="btn" type="button" disabled title="More wallpapers — coming soon.">
                Change…
              </button>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Dock Icon Size</div>
                <div className="desc">
                  How big each icon in the dock should be.{' '}
                  <span className="font-mono">{settings.dockItemSize}px</span>
                </div>
              </div>
              <input
                type="range"
                value={settings.dockItemSize}
                min={DOCK_SIZE_MIN}
                max={DOCK_SIZE_MAX}
                onChange={(e) => onSettingsChange({ dockItemSize: Number(e.target.value) })}
                aria-label="Dock icon size"
              />
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Dock Spacing</div>
                <div className="desc">
                  Gap between dock icons. <span className="font-mono">{settings.dockGap}px</span>
                </div>
              </div>
              <input
                type="range"
                value={settings.dockGap}
                min={DOCK_GAP_MIN}
                max={DOCK_GAP_MAX}
                onChange={(e) => onSettingsChange({ dockGap: Number(e.target.value) })}
                aria-label="Dock spacing"
              />
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Reduce Motion</div>
                <div className="desc">Soften window opening/closing transitions.</div>
              </div>
              <button
                type="button"
                className={`toggle ${settings.reducedMotion ? 'on' : ''}`}
                role="switch"
                aria-checked={settings.reducedMotion}
                aria-label="Reduce motion"
                onClick={() => onSettingsChange({ reducedMotion: !settings.reducedMotion })}
              />
            </div>
          </div>
        ) : section === 'Company documents' ? (
          <CompanySettingsPane />
        ) : section === 'Billing' ? (
          <BillingSettingsPane />
        ) : section === 'Invoice format' ? (
          <div style={{ padding: 20 }}>
            <InvoiceFormatEditor />
          </div>
        ) : section === 'Vault' ? (
          <VaultPane />
        ) : section === 'Account' ? (
          <AccountPanel onSignOut={onSignOut} onDisplayNameChange={onDisplayNameChange} />
        ) : section === 'Team' ? (
          <TeamPanel currentUserRole={currentUserRole} />
        ) : section === 'Notifications' ? (
          <NotificationsPanel
            notifications={settings.notifications}
            onSettingsChange={onSettingsChange}
            currentUserRole={currentUserRole}
          />
        ) : (
          <SecurityPanel onSignOut={onSignOut} />
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings · Account                                                         */
/* -------------------------------------------------------------------------- */

const ROLE_LABELS: Record<string, string> = {
  partner: 'Partner',
  admin: 'Admin',
  manager: 'Manager',
  accountant: 'Accountant',
  employee: 'Employee',
  viewer: 'Viewer',
};

function AccountPanel({
  onSignOut,
  onDisplayNameChange,
}: {
  onSignOut?: () => void;
  onDisplayNameChange?: (fullName: string) => void;
}) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getMyProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setFullName(p.fullName);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your profile.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = profile != null && fullName.trim() !== profile.fullName;

  const save = () => {
    setNameError(null);
    startSave(async () => {
      const res = await updateMyProfile({ fullName });
      if (!res.ok) {
        setNameError(res.errors.fullName ?? null);
        toast.error(res.message);
        return;
      }
      const next = fullName.trim();
      setProfile((p) => (p ? { ...p, fullName: next } : p));
      setFullName(next);
      onDisplayNameChange?.(next);
      toast.success('Profile updated.');
    });
  };

  if (loadError) {
    return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>{loadError}</div>;
  }
  if (!profile) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading profile…</div>
    );
  }

  return (
    <div>
      <div className="settings-row">
        <div>
          <div className="label">Full name</div>
          <div className="desc">Shown across the workspace and on the menu bar.</div>
          {nameError ? (
            <div className="desc" style={{ color: 'var(--apar-red)' }}>
              {nameError}
            </div>
          ) : null}
        </div>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          value={fullName}
          maxLength={200}
          onChange={(e) => setFullName(e.target.value)}
          aria-label="Full name"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="label">Email</div>
          <div className="desc">Managed by your sign-in — change it from the login provider.</div>
        </div>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          value={profile.email}
          readOnly
          disabled
          aria-label="Email (read-only)"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="label">Role</div>
          <div className="desc">Your access level. Roles are managed under Team.</div>
        </div>
        <span className="badge">{ROLE_LABELS[profile.role] ?? profile.role}</span>
      </div>
      <div className="settings-row">
        <div>
          <div className="label">Save changes</div>
          <div className="desc">Your name is saved to your profile and synced everywhere.</div>
        </div>
        <button className="btn primary" type="button" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {onSignOut ? (
        <div className="settings-row">
          <div>
            <div className="label">Sign out</div>
            <div className="desc">End your session on this device.</div>
          </div>
          <button className="btn" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings · Team                                                            */
/* -------------------------------------------------------------------------- */

const SENTINEL_USER_ID = '00000000-0000-0000-0000-000000000000';
const TEAM_ROLES = ['admin', 'manager', 'accountant', 'employee', 'viewer'] as const;

function TeamPanel({ currentUserRole }: { currentUserRole?: 'super_admin' | 'admin' | 'user' }) {
  const [members, setMembers] = useState<readonly TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canManage = currentUserRole === 'super_admin' || currentUserRole === 'admin';

  const reload = () => {
    listTeamMembers()
      .then(setMembers)
      .catch(() => setLoadError('Could not load the team. You may not have permission.'));
  };
  useEffect(() => {
    let cancelled = false;
    listTeamMembers()
      .then((m) => {
        if (!cancelled) setMembers(m);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the team. You may not have permission.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeRole = async (m: TeamMember, role: string) => {
    setBusyId(m.id);
    const res = await setUserRole(m.id, role);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`${m.fullName} is now ${ROLE_LABELS[role] ?? role}.`);
    reload();
  };

  const toggleActive = async (m: TeamMember) => {
    setBusyId(m.id);
    const res = await setUserActive(m.id, !m.active);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`${m.fullName} ${m.active ? 'deactivated' : 'reactivated'}.`);
    reload();
  };

  if (loadError) {
    return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>{loadError}</div>;
  }
  if (!members) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading team…</div>
    );
  }

  return (
    <div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="label">Team members</div>
          <div className="desc">
            {canManage
              ? 'Set each member’s role or deactivate access. Inviting new members arrives with the sign-in system.'
              : 'You can view the team. Ask an admin to change roles or access.'}
          </div>
        </div>
      </div>
      <div style={{ padding: '4px 18px 18px' }}>
        {members.map((m) => {
          const protectedRow = m.role === 'partner' || m.id === SENTINEL_USER_ID;
          const disabled = !canManage || protectedRow || busyId === m.id;
          return (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid var(--border)',
                opacity: m.active ? 1 : 0.55,
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: 'var(--apar-red-soft)',
                  color: 'var(--apar-red)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {initials(m.fullName)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {m.fullName}
                  {!m.active ? (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · inactive</span>
                  ) : null}
                </div>
                <div className="desc" style={{ marginTop: 0 }}>
                  {m.email}
                </div>
              </div>
              {m.role === 'partner' ? (
                <span className="badge">Partner</span>
              ) : (
                <select
                  className="input"
                  style={{ maxWidth: 150 }}
                  value={m.role}
                  disabled={disabled}
                  aria-label={`Role for ${m.fullName}`}
                  onChange={(e) => void changeRole(m, e.target.value)}
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn"
                type="button"
                disabled={disabled}
                onClick={() => void toggleActive(m)}
                title={protectedRow ? 'Protected account' : undefined}
              >
                {m.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings · Notifications                                                   */
/* -------------------------------------------------------------------------- */

const NOTIFICATION_TOGGLES: { key: keyof NotificationSettings; label: string; desc: string }[] = [
  {
    key: 'invoicePaymentReminders',
    label: 'Invoice payment reminders',
    desc: 'Reminders for upcoming and due invoice payments.',
  },
  {
    key: 'overdueAlerts',
    label: 'Overdue invoice alerts',
    desc: 'Alerts when an invoice passes its due date.',
  },
  {
    key: 'weeklySummary',
    label: 'Weekly summary',
    desc: 'A digest of receivables, payables and activity.',
  },
  {
    key: 'inAppToasts',
    label: 'In-app notifications',
    desc: 'Show toast pop-ups for actions inside the workspace.',
  },
];

function NotificationsPanel({
  notifications,
  onSettingsChange,
  currentUserRole,
}: {
  notifications: NotificationSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
  currentUserRole?: 'super_admin' | 'admin' | 'user';
}) {
  const canManageSchedule = currentUserRole === 'super_admin' || currentUserRole === 'admin';

  const toggle = (key: keyof NotificationSettings) => {
    // Send the FULL object — the server-side jsonb merge is shallow.
    onSettingsChange({ notifications: { ...notifications, [key]: !notifications[key] } });
  };

  return (
    <div>
      {NOTIFICATION_TOGGLES.map((t) => (
        <div className="settings-row" key={t.key}>
          <div>
            <div className="label">{t.label}</div>
            <div className="desc">{t.desc}</div>
          </div>
          <button
            type="button"
            className={`toggle ${notifications[t.key] ? 'on' : ''}`}
            role="switch"
            aria-checked={notifications[t.key]}
            aria-label={t.label}
            onClick={() => toggle(t.key)}
          />
        </div>
      ))}
      <div className="settings-row" style={{ borderBottom: 'none' }}>
        <div>
          <div className="desc">
            Preferences are saved to your profile and synced across your devices. Email and SMS
            delivery is configured by your administrator.
          </div>
        </div>
      </div>
      {canManageSchedule ? <ActivityDigestEditor /> : null}
      {canManageSchedule ? <ReminderScheduleEditor /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings · Notifications — daily activity digest (admin)                    */
/* -------------------------------------------------------------------------- */

function ActivityDigestEditor() {
  const [cfg, setCfg] = useState<ActivityDigestConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getActivityDigestConfig()
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
        setEnabled(c.enabled);
        setRecipient(c.recipient);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the digest settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = () => {
    setRecipientError(null);
    startSave(async () => {
      const res = await saveActivityDigestConfig({ enabled, recipient });
      if (!res.ok) {
        setRecipientError(res.errors.recipient ?? null);
        toast.error(res.message);
        return;
      }
      toast.success('Digest settings saved.');
    });
  };

  const sendTest = () => {
    startSend(async () => {
      const res = await sendActivityDigestNow();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Digest sent (${res.count} event${res.count === 1 ? '' : 's'}).`);
    });
  };

  if (loadError) {
    return (
      <div style={{ padding: '8px 18px 18px', color: 'var(--text-muted)', fontSize: 13 }}>
        {loadError}
      </div>
    );
  }
  if (!cfg) {
    return (
      <div style={{ padding: '8px 18px 18px', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading digest settings…
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 18px 18px', borderTop: '1px solid var(--border)' }}>
      <div className="label" style={{ marginBottom: 2 }}>
        Daily activity digest
      </div>
      <div className="desc" style={{ marginBottom: 10 }}>
        Email a summary of the last 24 hours of activity to a recipient once a day (driven by the
        scheduled job).
      </div>
      {!cfg.emailReady ? (
        <div
          className="desc"
          style={{
            color: 'var(--apar-red)',
            background: 'var(--apar-red-soft)',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 10,
          }}
        >
          {cfg.emailError ?? 'Email provider is not configured.'} Add it to .env.local to enable
          sending.
        </div>
      ) : null}
      <div className="settings-row" style={{ padding: '10px 0' }}>
        <div>
          <div className="label">Enable daily digest</div>
          <div className="desc">Turn the scheduled email on or off.</div>
        </div>
        <button
          type="button"
          className={`toggle ${enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={enabled}
          aria-label="Enable daily digest"
          onClick={() => setEnabled((v) => !v)}
        />
      </div>
      <div className="settings-row" style={{ padding: '10px 0' }}>
        <div>
          <div className="label">Recipient</div>
          <div className="desc">Where the digest is sent.</div>
          {recipientError ? (
            <div className="desc" style={{ color: 'var(--apar-red)' }}>
              {recipientError}
            </div>
          ) : null}
        </div>
        <input
          className="input"
          type="email"
          style={{ maxWidth: 240 }}
          value={recipient}
          maxLength={200}
          placeholder="company@example.com"
          aria-label="Digest recipient"
          onChange={(e) => setRecipient(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn primary" type="button" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn"
          type="button"
          onClick={sendTest}
          disabled={sending || !cfg.emailReady}
          title={
            cfg.emailReady ? 'Send the digest now to the saved recipient' : (cfg.emailError ?? '')
          }
        >
          {sending ? 'Sending…' : 'Send test now'}
        </button>
      </div>
    </div>
  );
}

type ReminderRuleDraft = { offset_days: number; template: string; channel: 'email' | 'sms' };

function ReminderScheduleEditor() {
  const [schedule, setSchedule] = useState<GlobalReminderSchedule | null>(null);
  const [rules, setRules] = useState<ReminderRuleDraft[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getGlobalReminderSchedule()
      .then((s) => {
        if (cancelled) return;
        setSchedule(s);
        setRules(s.rules.map((r) => ({ ...r })));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the reminder schedule.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRule = (i: number, patch: Partial<ReminderRuleDraft>) => {
    setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRule = () =>
    setRules((prev) => [
      ...prev,
      { offset_days: 0, template: 'Payment reminder', channel: 'email' },
    ]);
  const removeRule = (i: number) => setRules((prev) => prev.filter((_, idx) => idx !== i));

  const save = () => {
    const clean = rules
      .map((r) => ({ ...r, template: r.template.trim() }))
      .filter((r) => r.template.length > 0);
    if (clean.length === 0) {
      toast.error('Add at least one reminder rule with a message.');
      return;
    }
    startSave(async () => {
      try {
        await saveGlobalReminderSchedule({ rules: clean });
        toast.success('Reminder schedule saved.');
        setRules(clean.map((r) => ({ ...r })));
      } catch {
        toast.error('Could not save the reminder schedule.');
      }
    });
  };

  if (loadError) {
    return (
      <div style={{ padding: '8px 18px 18px', color: 'var(--text-muted)', fontSize: 13 }}>
        {loadError}
      </div>
    );
  }
  if (!schedule) {
    return (
      <div style={{ padding: '8px 18px 18px', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading schedule…
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 18px 18px', borderTop: '1px solid var(--border)' }}>
      <div className="label" style={{ marginBottom: 2 }}>
        Invoice reminder schedule
      </div>
      <div className="desc" style={{ marginBottom: 12 }}>
        Org-wide default dunning rules. Offset is days from the due date (negative = before, 0 = on
        the due date). These drive the automated reminder job.
      </div>
      {rules.length === 0 ? (
        <div className="desc" style={{ marginBottom: 10 }}>
          No rules yet — add one below.
        </div>
      ) : null}
      {rules.map((r, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <input
            className="input"
            type="number"
            style={{ width: 76 }}
            value={r.offset_days}
            min={-365}
            max={365}
            aria-label="Offset days"
            onChange={(e) => updateRule(i, { offset_days: Number(e.target.value) })}
          />
          <span className="desc" style={{ margin: 0 }}>
            days
          </span>
          <input
            className="input"
            style={{ flex: 1, minWidth: 160 }}
            value={r.template}
            maxLength={120}
            placeholder="Message / template name"
            aria-label="Template"
            onChange={(e) => updateRule(i, { template: e.target.value })}
          />
          <select
            className="input"
            style={{ width: 96 }}
            value={r.channel}
            aria-label="Channel"
            onChange={(e) => updateRule(i, { channel: e.target.value as 'email' | 'sms' })}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
          <button
            className="btn"
            type="button"
            onClick={() => removeRule(i)}
            aria-label="Remove rule"
          >
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn" type="button" onClick={addRule}>
          Add rule
        </button>
        <button className="btn primary" type="button" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings · Security                                                        */
/* -------------------------------------------------------------------------- */

function SecurityPanel({ onSignOut }: { onSignOut?: () => void }) {
  const [security, setSecurity] = useState<MySecurity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMySecurity()
      .then((s) => {
        if (!cancelled) setSecurity(s);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your security details.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>{loadError}</div>;
  }
  if (!security) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading security…</div>
    );
  }

  return (
    <div>
      <div className="settings-row">
        <div>
          <div className="label">Role</div>
          <div className="desc">Your access level in the workspace.</div>
        </div>
        <span className="badge">{ROLE_LABELS[security.role] ?? security.role}</span>
      </div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="label">What you can do</div>
          <div className="desc">Permissions granted by your role.</div>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            maxWidth: 360,
            justifyContent: 'flex-end',
          }}
        >
          {security.capabilities.length === 0 ? (
            <span className="desc" style={{ margin: 0 }}>
              No special permissions.
            </span>
          ) : (
            security.capabilities.map((c) => (
              <span key={c.key} className="badge" style={{ fontWeight: 400 }}>
                {c.label}
              </span>
            ))
          )}
        </div>
      </div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="label">Recent account activity</div>
          <div className="desc">Your last actions across the workspace.</div>
          <div style={{ marginTop: 8 }}>
            {security.recentActivity.length === 0 ? (
              <div className="desc" style={{ margin: 0 }}>
                No recent activity recorded.
              </div>
            ) : (
              security.recentActivity.slice(0, 10).map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    fontSize: 12,
                    padding: '4px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{ color: 'var(--text)' }}>
                    {a.action} · {a.entityType}
                  </span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="label">Password &amp; two-factor</div>
          <div className="desc">
            Managed by your sign-in provider — available once SSO login is enabled.
          </div>
        </div>
        <button className="btn" type="button" disabled title="Available with the sign-in system.">
          Manage
        </button>
      </div>
      {onSignOut ? (
        <div className="settings-row">
          <div>
            <div className="label">Sign out</div>
            <div className="desc">End your session on this device.</div>
          </div>
          <button className="btn" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
