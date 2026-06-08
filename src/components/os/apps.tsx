'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { REPORTS } from './data';
import { useBusinessData } from './data-store';
import { navigateBesideFocused } from './apps/navigate';
import { EntityRef } from '@/components/entity/entity-ref';
import {
  listClients as listDbClients,
  listEmployees as listDbEmployees,
  listVendors as listDbVendors,
  listUsers as listDbUsers,
  listDepartments as listDbDepartments,
} from '@/lib/server-stub/entity-actions';
import { departmentLabel } from '@/components/employees/types';
import type { Employee as OsEmployee } from './types';
import {
  DOCK_GAP_MAX,
  DOCK_GAP_MIN,
  DOCK_SIZE_MAX,
  DOCK_SIZE_MIN,
  type UserSettings,
} from './auth/session-store';
import { formatINR, initials, paiseToDecimalRupees, parseRupeesToPaise } from './format';
import { Icon, type IconName } from './icons';
import type {
  Client,
  Project,
  Report,
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
import { archiveEmployee, createEmployee, updateEmployee } from '@/lib/server/entities/employees';
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
    setErr(null);
    setBusy(true);
    try {
      await onSubmit({
        name: n,
        industry: industry.trim(),
        managerId: managerId || null,
        status,
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
              subtitle="Capture amounts directly from the vendor's bill — Apār never computes tax."
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
        {children}
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
        <Field label="Fee (₹)" hint="Captured from the SOW. Apār doesn't compute totals.">
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

export function EmployeesApp({
  canEdit = true,
  canDelete = true,
}: {
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [filterDept, setFilterDept] = useState<string>('all');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<OsEmployee | null>(null);
  const [confirmDel, setConfirmDel] = useState<OsEmployee | null>(null);

  // Real DB-backed list. Mirrors the ClientsApp / VendorsApp swap so
  // clicking an employee card passes a real UUID into the openWindow
  // route → EmployeeWindow renders with the §8.4 personal dashboard.
  // Edit / delete go straight to the DB (updateEmployee / archiveEmployee)
  // and then refetch this list — there is no local-store copy to drift.
  const [dbEmployees, setDbEmployees] = useState<readonly OsEmployee[] | null>(null);

  async function fetchEmployeeList(): Promise<readonly OsEmployee[]> {
    const rows = await listDbEmployees();
    // The Team directory shows current team only — archived / separated
    // teammates drop off (they stay queryable from the dashboard list).
    return rows
      .filter((r) => r.status !== 'separated')
      .map(
        (r): OsEmployee => ({
          id: r.id,
          name: r.fullName,
          role: r.designation || '—',
          dept: departmentLabel(r.department),
          tone: toneForName(r.fullName),
        }),
      );
  }

  async function refreshEmployeeList() {
    const next = await fetchEmployeeList().catch(() => null);
    if (next) setDbEmployees(next);
  }

  useEffect(() => {
    let cancelled = false;
    fetchEmployeeList()
      .then((mapped) => {
        if (!cancelled) setDbEmployees(mapped);
      })
      .catch(() => {
        /* fall through to empty list */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = { employees: dbEmployees ?? [] };
  const visible =
    filterDept === 'all' ? data.employees : data.employees.filter((e) => e.dept === filterDept);
  const depts = new Set(data.employees.map((e) => e.dept));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Team</h2>
        <span className="sub">
          {data.employees.length} people · {depts.size} department{depts.size === 1 ? '' : 's'}
        </span>
        <div className="grow" />
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="header-select"
          aria-label="Filter by department"
        >
          <option value="all">All departments</option>
          {[...depts].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
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
        className="card-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
      >
        {visible.map((e) => (
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
            style={{ cursor: 'pointer' }}
            title={`Open ${e.name}'s profile`}
          >
            <div
              className="avatar"
              style={{ width: 44, height: 44, fontSize: 14, background: e.tone, borderRadius: 12 }}
            >
              {initials(e.name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{e.name}</div>
              <div className="role">{e.role}</div>
              <div className="dept">{e.dept}</div>
            </div>
            {(canEdit || canDelete) && (
              <div className="emp-card-actions" onClick={(ev) => ev.stopPropagation()}>
                {canEdit && (
                  <button
                    type="button"
                    className="emp-card-btn"
                    title="Edit teammate"
                    onClick={() => setEditing(e)}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                )}
                {canDelete && (
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
        ))}
        {visible.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: 28,
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}
          >
            {data.employees.length === 0
              ? 'No teammates yet — click "Invite" to add the first.'
              : `No one in ${filterDept}.`}
          </div>
        )}
      </div>

      {showNew && (
        <EmployeeFormModal
          mode="create"
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            // Quick invite — sensible defaults; HR fills KYC / salary /
            // contract in the full wizard (/employees/new) or the window.
            const result = await createEmployee({
              fullName: input.name,
              designation: input.role || undefined,
              department: input.dept || undefined,
              employmentType: 'full_time',
              joinedOn: new Date().toISOString().slice(0, 10),
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setShowNew(false);
            await refreshEmployeeList();
            navigateBesideFocused({ type: 'employee', id: result.id });
            toast.success(`${input.name} added to the team.`);
          }}
        />
      )}
      {editing && (
        <EmployeeFormModal
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            // Persist to the DB, then refetch so the card reflects the edit.
            const result = await updateEmployee({
              id: editing.id,
              fullName: input.name,
              designation: input.role || null,
              department: input.dept || null,
            });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setEditing(null);
            await refreshEmployeeList();
            toast.success(`Updated ${input.name}.`);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Remove ${confirmDel.name} from the team?`}
          message="They'll disappear from the team directory. Projects and ledger entries that reference them aren't affected, and a partner can restore them later."
          destructive
          confirmLabel="Remove"
          onCancel={() => setConfirmDel(null)}
          onConfirm={async () => {
            const name = confirmDel.name;
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

function EmployeeFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: { name?: string; role?: string; dept?: string };
  onClose: () => void;
  onSubmit: (input: { name: string; role: string; dept: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [dept, setDept] = useState(initial?.dept ?? '');
  const [departments, setDepartments] = useState<readonly string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Dynamic department suggestions — pick an existing one or type a new one.
  useEffect(() => {
    let active = true;
    listDbDepartments()
      .then((rows) => {
        if (active) setDepartments(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setErr('Name is required.');
    if (!role.trim()) return setErr('Role is required.');
    setErr(null);
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), role: role.trim(), dept });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'edit' ? `Edit ${initial?.name ?? 'Teammate'}` : 'Invite Teammate'}
      onClose={onClose}
      width={480}
    >
      <form onSubmit={submit} className="os-form">
        <Field label="Full name" full>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Riya Sengupta"
          />
        </Field>
        <Field label="Role">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Senior Visualiser"
          />
        </Field>
        <Field label="Department">
          <input
            list="os-employee-departments"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            placeholder="Pick or type a department"
          />
          <datalist id="os-employee-departments">
            {departments.map((d) => (
              <option key={d} value={departmentLabel(d)} />
            ))}
          </datalist>
        </Field>
        {err && <div className="os-form-error">{err}</div>}
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
/* Reports + Report detail                                                    */
/* -------------------------------------------------------------------------- */

export function ReportsApp({ openReportDetail }: { openReportDetail: (r: Report) => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Reports</h2>
        <span className="sub">May 2026 · finance & ops</span>
        <div className="grow" />
        <button className="btn" type="button" disabled title="Period filter — coming soon.">
          <Icon name="filter" size={13} />
          FY26
        </button>
        <button className="btn" type="button" disabled title="Report export — coming soon.">
          <Icon name="filetext" size={13} />
          Export
        </button>
      </div>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {REPORTS.map((r) => (
          <div key={r.id} className="report-tile" onClick={() => openReportDetail(r)}>
            <div className="label">{r.label}</div>
            <div className="value">{r.value}</div>
            <div className="trend">{r.trend}</div>
            <Sparkline data={r.spark} color={r.color} />
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

const MONTHS = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];

export function ReportDetail({ report }: { report: Report }) {
  const data = report.spark.map((v, i) => ({ month: MONTHS[i] ?? `m${i}`, value: v }));
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 16 }}>
      <div>
        <div className="font-display" style={{ fontSize: 26 }}>
          {report.label}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {report.value} · {report.trend}
        </div>
      </div>
      <div
        style={{
          background: 'var(--content-2)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          height: 280,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`g-${report.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={report.color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={report.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={11} />
            <YAxis stroke="var(--text-muted)" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: 'var(--content)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text)',
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={report.color}
              strokeWidth={2}
              fill={`url(#g-${report.id})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Value</th>
            <th>Δ vs prev</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => {
            const prev = i > 0 ? data[i - 1]!.value : null;
            const delta = prev != null ? d.value - prev : null;
            return (
              <tr key={i}>
                <td>{d.month} 2025-26</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{d.value}</td>
                <td
                  style={{
                    color: delta != null && delta > 0 ? 'var(--green)' : 'var(--text-muted)',
                  }}
                >
                  {delta == null ? '—' : (delta > 0 ? '+' : '') + delta}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

type SettingsSection = {
  name: 'General' | 'Appearance' | 'Account' | 'Team' | 'Notifications' | 'Security';
  icon: IconName;
};

export function SettingsApp({
  settings,
  onSettingsChange,
}: {
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
}) {
  const [section, setSection] = useState<SettingsSection['name']>('Appearance');
  const sections: readonly SettingsSection[] = [
    { name: 'General', icon: 'settings' },
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
        {section === 'Appearance' ? (
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
                <div className="desc">Used for selected items, focus states and the wordmark.</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['#E63A1F', '#7A4E2D', '#5B6677', '#2E8F5A'].map((c) => (
                  <div
                    key={c}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: c,
                      border: c === '#E63A1F' ? '2px solid var(--text)' : '2px solid transparent',
                      cursor: 'default',
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="label">Desktop Wallpaper</div>
                <div className="desc">Apār Charcoal Gradient · Default</div>
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
        ) : (
          <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            <div
              style={{
                background: 'var(--content-2)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 32,
                textAlign: 'center',
              }}
            >
              <div className="font-display" style={{ fontSize: 24, color: 'var(--text)' }}>
                {section}
              </div>
              <div style={{ marginTop: 6 }}>
                {section} settings are coming soon. Appearance preferences are available now under
                the Appearance tab.
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
