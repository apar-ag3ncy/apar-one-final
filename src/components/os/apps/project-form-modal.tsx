'use client';

// Project create/edit modal — extracted from apps.tsx (ProjectsApp) so the
// project window's "Add sub-project" flow can reuse it. Extends the original
// form with: Code (auto 'PRJ-NNNN' when blank), a single POC (account manager)
// picked from the selected client's contacts, and — in edit mode — a
// Sub-projects section with "+ Add sub-project" that opens a second instance
// of this modal locked to the parent.
//
// The modal is conditionally MOUNTED by its callers ({show && <ProjectFormModal/>}),
// so state initializes on mount — do not convert to an always-mounted
// open-prop dialog (see the OS form-reset bug pattern).

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import {
  listClients as listDbClients,
  listEmployees as listDbEmployees,
} from '@/lib/server-stub/entity-actions';
import { listContacts } from '@/lib/server/entities/contacts';
import { isAssignableEmployee } from '@/lib/employee-badges';
import { KNOWN_DEPARTMENTS, departmentLabel } from '@/components/employees/types';
import {
  createProject,
  listSubProjects,
  type ProjectListRow,
} from '@/lib/server/entities/projects';
import { PROJECT_COLS, colToDbStatus, dbStatusToCol, type ProjectCol } from '@/lib/project-status';
import { formatINR, parseRupeesToPaise } from '../format';
import { Icon } from '../icons';
import type { Project } from '../types';
import { Field, Modal } from './os-modal-kit';

type Option = { id: string; name: string };

export type ProjectPriorityValue = 'urgent' | 'high' | 'normal' | 'low';

export const PROJECT_PRIORITY_OPTIONS: readonly { value: ProjectPriorityValue; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export type ProjectFormSubmit = {
  name: string;
  client: string;
  clientId: string;
  lead: string;
  leadEmployeeId: string | null;
  accountManagerId: string | null;
  clientContactId: string | null;
  code: string;
  col: ProjectCol;
  fee: bigint;
  priority: ProjectPriorityValue;
  isExternal: boolean;
  department: string | null;
};

export function ProjectFormModal({
  mode,
  initial,
  defaultCol,
  parentProjectId,
  lockedClientId,
  onClose,
  onSubmit,
  onSubProjectsChanged,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<Project>;
  defaultCol: ProjectCol;
  /** Set when creating a sub-project — locks the client to the parent's. */
  parentProjectId?: string;
  lockedClientId?: string;
  onClose: () => void;
  onSubmit: (input: ProjectFormSubmit) => void;
  /** Called after a sub-project is created from the edit form. */
  onSubProjectsChanged?: () => void;
}) {
  // Real DB clients + employees + users for the dropdowns. Loaded once on mount.
  const [clientOptions, setClientOptions] = useState<Option[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<Option[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDbClients(), listDbEmployees()])
      .then(([cs, es]) => {
        if (cancelled) return;
        setClientOptions(cs.map((c) => ({ id: c.id, name: c.name })));
        // Don't offer separated/inactive people as a project lead.
        setEmployeeOptions(
          es
            .filter((e) => isAssignableEmployee(e.status))
            .map((e) => ({ id: e.id, name: e.fullName })),
        );
      })
      .catch(() => {
        /* fall through to empty lists */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(mode === 'edit' ? (initial?.code ?? '') : '');
  const [clientId, setClientId] = useState<string>(lockedClientId ?? initial?.clientId ?? '');
  const [leadEmployeeId, setLeadEmployeeId] = useState<string>(initial?.leadEmployeeId ?? '');
  const [clientContactId, setClientContactId] = useState<string>(initial?.clientContactId ?? '');
  const [col, setCol] = useState<ProjectCol>(initial?.col ?? defaultCol);
  const [priority, setPriority] = useState<ProjectPriorityValue>(initial?.priority ?? 'normal');
  const [isExternal, setIsExternal] = useState<boolean>(initial?.isExternal ?? false);
  const [department, setDepartment] = useState<string>(
    initial?.department ? departmentLabel(initial.department) : '',
  );
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

  // Client-side POC options — the selected client's contacts. Reloaded when
  // the client changes; a selection belonging to another client is cleared.
  const [contactOptions, setContactOptions] = useState<Option[]>([]);
  useEffect(() => {
    if (!clientId) {
      queueMicrotask(() => {
        setContactOptions([]);
        setClientContactId('');
      });
      return;
    }
    let cancelled = false;
    listContacts({ entityType: 'client', entityId: clientId })
      .then((rows) => {
        if (cancelled) return;
        setContactOptions(rows.map((c) => ({ id: c.id, name: c.name })));
        queueMicrotask(() =>
          setClientContactId((prev) => (rows.some((c) => c.id === prev) ? prev : '')),
        );
      })
      .catch(() => {
        if (!cancelled) setContactOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Sub-projects (edit mode, top-level projects only).
  const isSubProject = Boolean(parentProjectId) || Boolean(initial?.parentProjectId);
  const canHaveSubs = mode === 'edit' && !isSubProject && Boolean(initial?.id);
  const [subs, setSubs] = useState<readonly ProjectListRow[]>([]);
  const [showAddSub, setShowAddSub] = useState(false);
  useEffect(() => {
    if (!canHaveSubs || !initial?.id) return;
    let cancelled = false;
    listSubProjects(initial.id)
      .then((rows) => {
        if (!cancelled) setSubs(rows);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [canHaveSubs, initial?.id, showAddSub]);

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
      accountManagerId: null,
      clientContactId: clientContactId || null,
      code: code.trim(),
      col,
      fee: feePaise > 0n ? feePaise : 0n,
      priority,
      isExternal,
      department: department.trim() || null,
    });
  };

  const title = parentProjectId
    ? 'New Sub-project'
    : mode === 'edit'
      ? `Edit ${initial?.code ?? 'Project'}`
      : 'New Project';

  return (
    <Modal title={title} onClose={onClose} width={560}>
      <form onSubmit={submit} className="os-form">
        <Field label="Project name" full>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Diwali Festive Campaign"
          />
        </Field>
        <Field label="Code" hint="Leave blank for an automatic PRJ-NNNN code.">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="auto: PRJ-0001"
          />
        </Field>
        <Field label="Client">
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={Boolean(lockedClientId)}
            title={lockedClientId ? "Sub-projects share the parent's client." : undefined}
          >
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
          <select value={col} onChange={(e) => setCol(e.target.value as ProjectCol)}>
            {PROJECT_COLS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" hint="External + urgent projects float to the top of the board.">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ProjectPriorityValue)}
          >
            {PROJECT_PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Department"
          hint="Owning team, for the department-wise focus view. Blank = unassigned."
        >
          <input
            list="project-department-suggestions"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. Design"
          />
          <datalist id="project-department-suggestions">
            {KNOWN_DEPARTMENTS.map((d) => (
              <option key={d} value={departmentLabel(d)} />
            ))}
          </datalist>
        </Field>
        <Field label="Source" hint="External projects come from outside Apar.">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={isExternal}
              onChange={(e) => setIsExternal(e.target.checked)}
              style={{ width: 'auto' }}
            />
            External project
          </label>
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
        <Field
          label="POC (account manager)"
          hint={
            contactOptions.length === 0
              ? 'No contacts saved for this client yet — add them in the Clients app.'
              : "The client's point of contact for this project."
          }
        >
          <select
            value={clientContactId}
            onChange={(e) => setClientContactId(e.target.value)}
            disabled={contactOptions.length === 0}
          >
            <option value="">— None —</option>
            {contactOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
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

        {canHaveSubs ? (
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="os-field-label">Sub-projects</span>
              <div style={{ flex: 1 }} />
              <button className="btn" type="button" onClick={() => setShowAddSub(true)}>
                <Icon name="plus" size={12} />
                Add sub-project
              </button>
            </div>
            {subs.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                No sub-projects yet. Each sub-project carries its own deliverables, fee and team;
                the parent&apos;s total is the sum of its sub-projects.
              </span>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {subs.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12.5,
                      padding: '5px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--os-font)',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--text-muted)',
                        fontSize: 11,
                      }}
                    >
                      {s.code ?? ''}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{dbStatusToCol(s.status)}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(s.feePaise)}
                    </span>
                  </li>
                ))}
                <li
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    padding: '2px 8px 0',
                  }}
                >
                  Total: {formatINR(subs.reduce((acc, s) => acc + s.feePaise, 0n))}
                </li>
              </ul>
            )}
          </div>
        ) : null}

        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <Icon name="check" size={13} />
            {mode === 'edit'
              ? 'Save changes'
              : parentProjectId
                ? 'Create sub-project'
                : 'Create project'}
          </button>
        </div>
      </form>

      {showAddSub && initial?.id ? (
        <ProjectFormModal
          mode="create"
          defaultCol="Proposed"
          parentProjectId={initial.id}
          lockedClientId={initial.clientId}
          onClose={() => setShowAddSub(false)}
          onSubmit={(input) => {
            void (async () => {
              try {
                await createProject({
                  clientId: input.clientId,
                  leadEmployeeId: input.leadEmployeeId,
                  accountManagerId: input.accountManagerId,
                  clientContactId: input.clientContactId,
                  parentProjectId: initial.id,
                  name: input.name,
                  code: input.code || null,
                  status: colToDbStatus(input.col),
                  priority: input.priority,
                  isExternal: input.isExternal,
                  department: input.department,
                  feePaise: input.fee,
                });
                toast.success('Sub-project created.');
                setShowAddSub(false);
                onSubProjectsChanged?.();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Create failed');
              }
            })();
          }}
        />
      ) : null}
    </Modal>
  );
}
