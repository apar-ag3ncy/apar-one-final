'use client';

// Employee profile window — SPEC-AMENDMENT-001 §8.4.
//
// Read-only personal dashboard surfaced inside an OS window. Tabbed layout
// for parity with ClientWindow / VendorWindow (Rule 47). The employee
// themselves edits via the (portal)/me/* Dashboard routes; the OS surface
// is for managers / HR / admin.

import { useEffect, useState } from 'react';

// Tabs are OS-styled (.tabs / .tab) instead of the Radix ProfileTabs so the
// OS theme is preserved on the chrome. Tab content still uses the shared
// Section components — Rule 47 — but the surrounding nav matches the
// legacy ClientDetail / VendorDetail look in apps.tsx.
import { ContactsSection } from '@/components/entity/contacts-section';
import { AddressesSection } from '@/components/entity/addresses-section';
import { AttendanceSection } from '@/components/entity/attendance-section';
import { BankAccountsSection } from '@/components/entity/bank-accounts-section';
import { CompensationSection } from '@/components/entity/compensation-section';
import { TaxIdentifiersSection } from '@/components/entity/tax-identifiers-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { EntityRef } from '@/components/entity/entity-ref';
import { CustomValuesSection } from '@/components/entity/custom-values-section';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listContacts, type ContactRow } from '@/lib/server/entities/contacts';
import { getEmployeeSummary, type EmployeeSummary } from '@/lib/server/entities/employee-summary';
import { Icon } from '../icons';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';

function openDocumentBeside(documentId: string) {
  osActions.openWindow({
    app: 'documents',
    entityId: documentId,
    position: 'beside-focused',
  });
}

export type EmployeeWindowProps = {
  employeeId: string;
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summary: EmployeeSummary; contacts: readonly ContactRow[] };

export function EmployeeWindow({ employeeId }: EmployeeWindowProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<string>('overview');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getEmployeeSummary(employeeId),
      listContacts({ entityType: 'employee', entityId: employeeId }),
    ])
      .then(([summary, contacts]) => {
        if (!cancelled) setState({ kind: 'ready', summary, contacts });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load employee',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, reloadKey]);

  if (state.kind === 'loading') {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading employee…</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-error, #c33)' }}>{state.message}</p>
      </div>
    );
  }

  const { summary, contacts } = state;
  const { employee, kpis, projectsLed, achievements } = summary;
  const isArchived = employee.status === 'separated';

  const tabDefs: ReadonlyArray<{ value: string; label: string; count?: number }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'contacts', label: 'Contacts', count: contacts.length },
    { value: 'addresses', label: 'Addresses' },
    { value: 'bank-tax', label: 'Bank & Tax' },
    { value: 'compensation', label: 'Compensation' },
    { value: 'documents', label: 'Documents' },
    { value: 'projects', label: 'Projects led', count: projectsLed.length },
    { value: 'attendance', label: 'Attendance & leaves' },
    { value: 'achievements', label: 'Achievements', count: achievements.length },
    { value: 'custom', label: 'Custom' },
    { value: 'activity', label: 'Activity' },
    { value: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header employee={employee} />
      <div className="tabs">
        {tabDefs.map((t) => (
          <div
            key={t.value}
            className={`tab ${tab === t.value ? 'active' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}
              >
                {t.count}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? <OverviewBody employee={employee} kpis={kpis} /> : null}
        {tab === 'contacts' ? (
          <ContactsSection
            entityType="employee"
            entityId={employee.id}
            entityName={employee.fullName}
            initial={contacts}
          />
        ) : null}
        {tab === 'addresses' ? (
          <AddressesSection
            entityType="employee"
            entityId={employee.id}
            entityName={employee.fullName}
          />
        ) : null}
        {tab === 'bank-tax' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <BankAccountsSection
              entityType="employee"
              entityId={employee.id}
              entityName={employee.fullName}
            />
            <TaxIdentifiersSection
              entityType="employee"
              entityId={employee.id}
              entityName={employee.fullName}
            />
          </div>
        ) : null}
        {tab === 'compensation' ? (
          <CompensationSection employeeId={employee.id} employeeName={employee.fullName} />
        ) : null}
        {tab === 'documents' ? (
          <DocumentsSection
            entityType="employee"
            entityId={employee.id}
            entityName={employee.fullName}
            onOpenDocument={openDocumentBeside}
            onUploaded={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'projects' ? <ProjectsLedBody projects={projectsLed} /> : null}
        {tab === 'attendance' ? (
          <AttendanceSection employeeId={employee.id} employeeName={employee.fullName} />
        ) : null}
        {tab === 'achievements' ? <AchievementsBody achievements={achievements} /> : null}
        {tab === 'custom' ? (
          <CustomValuesSection entityType="employee" entityId={employee.id} />
        ) : null}
        {tab === 'activity' ? <ActivityBody employeeId={employee.id} /> : null}
        {tab === 'settings' ? (
          <EntitySettingsSection
            kind="employee"
            entityId={employee.id}
            entityName={employee.fullName}
            isArchived={isArchived}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

function Header({ employee }: { employee: EmployeeSummary['employee'] }) {
  return (
    <header
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        paddingBottom: 10,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="avatar" style={{ width: 44, height: 44, fontSize: 16, borderRadius: 12 }}>
        {initials(employee.fullName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 17, lineHeight: 1.2 }}>
          {employee.fullName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {employee.designation ?? '—'}
          {employee.department ? ` · ${employee.department}` : ''}
          {' · joined '}
          {new Date(employee.joinedOn).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 999,
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {employee.status}
      </span>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewBody({
  employee,
  kpis,
}: {
  employee: EmployeeSummary['employee'];
  kpis: EmployeeSummary['kpis'];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Kpi label="Projects led" value={kpis.projectsLed} />
        <Kpi
          label="Leaves"
          value={`${kpis.leavesApproved} / ${kpis.leavesApplied}`}
          trend="approved / applied"
        />
        <Kpi label="Reimbursements pending" value={kpis.reimbursementsPending} />
        <Kpi label="Documents" value={kpis.documentsCount} />
      </div>
      <Card title="Profile">
        <DetailGrid
          items={[
            ['Designation', employee.designation ?? '—'],
            ['Department', employee.department ?? '—'],
            ['Employment type', employee.employmentType.replace('_', ' ')],
            ['Work email', employee.workEmail ?? '—'],
            ['Phone', employee.phone ?? '—'],
            ['PAN', employee.maskedPan ?? '—'],
            ['Aadhaar', employee.maskedAadhaar ?? '—'],
          ]}
        />
      </Card>
    </div>
  );
}

function ProjectsLedBody({ projects }: { projects: EmployeeSummary['projectsLed'] }) {
  if (projects.length === 0) {
    return <Muted>No active projects led by this employee.</Muted>;
  }
  return (
    <ul
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        listStyle: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      {projects.map((p) => (
        <li
          key={p.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            fontSize: 13,
          }}
        >
          {p.code ? (
            <span
              style={{
                fontFamily: 'var(--os-font)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.02em',
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              {p.code}
            </span>
          ) : null}
          <div style={{ flex: 1 }}>
            <EntityRef
              type="project"
              id={p.id}
              label={p.name}
              hideIcon
              onNavigate={navigateBesideFocused}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textTransform: 'capitalize',
            }}
          >
            {p.status.replace('_', ' ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AchievementsBody({ achievements }: { achievements: EmployeeSummary['achievements'] }) {
  if (achievements.length === 0) {
    return (
      <Muted>
        No achievements recorded. Partners / HR can mark events on the Activity feed as achievements
        via the <code>mark_achievement</code> capability.
      </Muted>
    );
  }
  return (
    <ul
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        listStyle: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      {achievements.map((a) => (
        <li key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
          <Icon name="star" size={14} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div>{a.summary}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {new Date(a.at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityBody({ employeeId }: { employeeId: string }) {
  const { events, isLive } = useRealtimeActivity({
    entityType: 'employee',
    entityId: employeeId,
    fetchEvents: getEntityActivity,
  });
  return (
    <ActivityFeed events={events} isLive={isLive} onNavigate={navigateBesideFocused} showHeader />
  );
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

function Kpi({ label, value, trend }: { label: string; value: number | string; trend?: string }) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 12,
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
      <div className="font-display" style={{ fontSize: 22, marginTop: 2 }}>
        {value}
      </div>
      {trend ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{trend}</div>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          margin: 0,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function DetailGrid({ items }: { items: ReadonlyArray<[string, string]> }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px 16px',
        margin: 0,
        fontSize: 13,
      }}
    >
      {items.map(([label, value]) => (
        <div key={label}>
          <dt
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {label}
          </dt>
          <dd style={{ margin: 0 }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{children}</p>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}
