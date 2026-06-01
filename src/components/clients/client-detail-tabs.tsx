'use client';

import {
  ActivityIcon,
  ArchiveIcon,
  BanknoteIcon,
  BookOpenIcon,
  FolderKanbanIcon,
  HandshakeIcon,
  LayoutGridIcon,
  LinkIcon,
  MapPinIcon,
  ReceiptIcon,
  ScrollTextIcon,
  SettingsIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { UrlTabs, type UrlTab } from '@/components/shared/url-tabs';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { AddressList } from '@/components/entity/address-list';
import { BankAccountList } from '@/components/entity/bank-account-list';
import { ClientExpensesOnBehalfSection } from '@/components/entity/vendor-bills-section';
import { ClientTransactionsSection } from '@/components/entity/client-transactions-section';
import { ContactsSection } from '@/components/entity/contacts-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { LazyTab } from '@/components/entity/lazy-tab';
import { TaxIdentifierList, type TaxIdentifier } from '@/components/entity/tax-identifier-list';
import {
  NewProjectDialog,
  type EmployeeOption,
  type UserOption,
} from '@/components/projects/new-project-dialog';
import type { Project, ProjectStatus } from '@/components/projects/types';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listAddresses, type AddressRow } from '@/lib/server/entities/addresses';
import { listBankAccounts, type BankAccountRow } from '@/lib/server/entities/bank-accounts';
import { listTaxIdentifiers, type TaxIdentifierRow } from '@/lib/server/entities/tax-identifiers';
import type { ContactRow } from '@/lib/server/entities/contacts';
import type { Client } from './types';

export type ClientDetailTabsProps = {
  client: Client;
  contacts: readonly ContactRow[];
  projects: readonly Project[];
  employees: readonly EmployeeOption[];
  users: readonly UserOption[];
  canHardDeleteContacts?: boolean;
};

/**
 * Entity profile shell per SPEC-AMENDMENT-001 §4 + AUDIT-GAPS §4.1.
 *
 * 13 tabs, each lazy-mounted by Radix Tabs (TabsContent does not mount
 * inactive content). New tabs added in this commit (P4-F) — Addresses,
 * Bank&Tax, Transactions, Expenses-on-behalf, Ledger, Custom, Related,
 * Settings — show a Skeleton while their server action loads.
 *
 * Five tabs (Transactions, Expenses-on-behalf, Ledger, Custom, Related)
 * still render an informative empty state because their backing server
 * actions are not yet implemented (per BACKEND-STATE.md).
 */
export function ClientDetailTabs({
  client,
  contacts,
  projects,
  employees,
  users,
  canHardDeleteContacts = false,
}: ClientDetailTabsProps) {
  const tabs: UrlTab[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'contacts', label: 'Contacts', count: contacts.length },
    { value: 'addresses', label: 'Addresses' },
    { value: 'bank-tax', label: 'Bank & Tax' },
    { value: 'documents', label: 'Documents', count: client.documentsCount },
    { value: 'projects', label: 'Projects', count: projects.length },
    { value: 'transactions', label: 'Transactions' },
    { value: 'expenses-on-behalf', label: 'Expenses on behalf' },
    { value: 'ledger', label: 'Ledger' },
    { value: 'custom', label: 'Custom' },
    { value: 'activity', label: 'Activity' },
    { value: 'related', label: 'Related' },
    { value: 'settings', label: 'Settings' },
  ];

  return (
    <UrlTabs tabs={tabs} defaultTab="overview">
      {{
        overview: <OverviewTab client={client} />,
        contacts: (
          <ContactsSection
            entityType="client"
            entityId={client.id}
            entityName={client.name}
            initial={contacts}
            canHardDelete={canHardDeleteContacts}
          />
        ),
        addresses: <AddressesTab entityId={client.id} entityName={client.name} />,
        'bank-tax': <BankTaxTab entityId={client.id} entityName={client.name} />,
        documents: (
          <DocumentsSection entityType="client" entityId={client.id} entityName={client.name} />
        ),
        projects: (
          <ProjectsTab client={client} projects={projects} employees={employees} users={users} />
        ),
        transactions: <ClientTransactionsSection clientId={client.id} clientName={client.name} />,
        'expenses-on-behalf': (
          <ClientExpensesOnBehalfSection clientId={client.id} clientName={client.name} />
        ),
        ledger: <LedgerTab entityName={client.name} />,
        custom: <CustomTab entityName={client.name} />,
        activity: <ActivityTab entityId={client.id} />,
        related: <RelatedTab entityName={client.name} />,
        settings: <SettingsTab client={client} />,
      }}
    </UrlTabs>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewTab({ client }: { client: Client }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Industry" value={client.industry} />
            <Detail label="Account manager" value={client.accountManager} />
            <Detail label="City" value={client.city} />
            <Detail
              label="GSTIN"
              value={client.gstin ?? <span className="text-muted-foreground">—</span>}
              mono
            />
            <Detail
              label="PAN"
              value={client.pan ?? <span className="text-muted-foreground">—</span>}
              mono
            />
            <Detail
              label="Onboarded"
              value={client.onboardedAt.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            />
            <Detail
              label="Tags"
              value={
                client.tags.length === 0 ? (
                  <span className="text-muted-foreground">No tags</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {client.tags.map((tag) => (
                      <StatusBadge key={tag} tone="neutral" label={tag} dot={false} />
                    ))}
                  </div>
                )
              }
            />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {client.notes ? (
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">{client.notes}</p>
          ) : (
            <p className="text-muted-foreground text-sm italic">No notes yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

function AddressesTab({ entityId, entityName }: { entityId: string; entityName: string }) {
  return (
    <LazyTab load={() => listAddresses({ entityType: 'client', entityId })}>
      {(rows: readonly AddressRow[]) => (
        <AddressList
          entityName={entityName}
          addresses={rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            line1: r.line1,
            line2: r.line2,
            city: r.city,
            state: r.stateCode,
            postalCode: r.postalCode ?? '',
            country: r.country,
            gstin: r.gstin,
            isPrimary: r.isPrimary,
          }))}
        />
      )}
    </LazyTab>
  );
}

/* -------------------------------------------------------------------------- */
/* Bank & Tax                                                                  */
/* -------------------------------------------------------------------------- */

function BankTaxTab({ entityId, entityName }: { entityId: string; entityName: string }) {
  return (
    <LazyTab
      load={async () => {
        const [banks, taxIds] = await Promise.all([
          listBankAccounts({ entityType: 'client', entityId }),
          listTaxIdentifiers({ entityType: 'client', entityId }),
        ]);
        return { banks, taxIds };
      }}
    >
      {({
        banks,
        taxIds,
      }: {
        banks: readonly BankAccountRow[];
        taxIds: readonly TaxIdentifierRow[];
      }) => (
        <div className="flex flex-col gap-4">
          <BankAccountList
            entityName={entityName}
            accounts={banks.map((b) => ({
              id: b.id,
              bankName: b.bankName,
              maskedNumber: `XXXX XXXX ${b.accountLast4}`,
              ifsc: b.ifsc,
              holderName: b.holderName,
              accountType: b.accountType,
              isPrimary: b.isPrimary,
              branch: b.branch,
            }))}
          />
          <TaxIdentifierList
            entityName={entityName}
            identifiers={taxIds.map(
              (t): TaxIdentifier => ({
                id: t.id,
                kind: t.kind === 'msme_udyam' ? 'msme' : t.kind === 'lut' ? 'other' : t.kind,
                maskedValue: t.maskedValue,
                revealable: t.vaultObjectKey !== null,
              }),
            )}
          />
        </div>
      )}
    </LazyTab>
  );
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

const PROJECT_STATUS_TONES: Record<ProjectStatus, StatusTone> = {
  pitching: 'info',
  active: 'success',
  on_hold: 'warning',
  delivered: 'accent',
  closed: 'neutral',
};

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  pitching: 'Pitching',
  active: 'Active',
  on_hold: 'On hold',
  delivered: 'Delivered',
  closed: 'Closed',
};

function ProjectsTab({
  client,
  projects,
  employees,
  users,
}: {
  client: Client;
  projects: readonly Project[];
  employees: readonly EmployeeOption[];
  users: readonly UserOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base">
            Projects
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {projects.length}
            </span>
          </CardTitle>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            New Project
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={FolderKanbanIcon}
                title="No projects yet"
                description={`Create the first project for ${client.name}. Pitches, active engagements, and closed work all live here.`}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Project</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4">Lead</TableHead>
                  <TableHead className="px-4">POC (manager)</TableHead>
                  <TableHead className="px-4 text-right">Fee</TableHead>
                  <TableHead className="px-4">Started</TableHead>
                  <TableHead className="px-4">Target end</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="px-4">
                      <a href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </a>
                      {p.code ? (
                        <div className="text-muted-foreground font-mono text-xs">{p.code}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-4">
                      <StatusBadge
                        tone={PROJECT_STATUS_TONES[p.status]}
                        label={PROJECT_STATUS_LABELS[p.status]}
                      />
                    </TableCell>
                    <TableCell className="px-4 text-sm">{p.leadName}</TableCell>
                    <TableCell className="px-4 text-sm">{p.accountManagerName}</TableCell>
                    <TableCell className="px-4 text-right font-mono text-sm tabular-nums">
                      {formatINR(p.feePaise)}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4 text-xs whitespace-nowrap">
                      {formatProjectDate(p.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4 text-xs whitespace-nowrap">
                      {p.endsAt ? formatProjectDate(p.endsAt) : 'Ongoing'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientId={client.id}
        clientName={client.name}
        employees={employees}
        users={users}
      />
    </>
  );
}

function formatProjectDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/* -------------------------------------------------------------------------- */
/* Ledger (placeholder)                                                        */
/* -------------------------------------------------------------------------- */

function LedgerTab({ entityName }: { entityName: string }) {
  return (
    <EmptyState
      icon={ScrollTextIcon}
      title="Statement of account pending"
      description={`Running balance and AR aging snapshot for ${entityName} once getStatementOfAccount(entityType, entityId, from, to) is wired in lib/server/ledger/reports.ts.`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Custom (placeholder)                                                        */
/* -------------------------------------------------------------------------- */

function CustomTab({ entityName }: { entityName: string }) {
  return (
    <EmptyState
      icon={LayoutGridIcon}
      title="Custom fields not wired yet"
      description={`Fields from the active client form template (form_fields where is_table_column=false) render here once the Form Builder server actions ship for ${entityName}.`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

function ActivityTab({ entityId }: { entityId: string }) {
  const onNavigate = useEntityNavigate();
  const { events, isLive } = useRealtimeActivity({
    entityType: 'client',
    entityId,
    fetchEvents: getEntityActivity,
  });
  return <ActivityFeed events={events} onNavigate={onNavigate} isLive={isLive} showHeader />;
}

/* -------------------------------------------------------------------------- */
/* Related (placeholder)                                                       */
/* -------------------------------------------------------------------------- */

function RelatedTab({ entityName }: { entityName: string }) {
  return (
    <EmptyState
      icon={LinkIcon}
      title="Related entities view pending"
      description={`Vendors paid for ${entityName}, employees who incurred expense for them, projects under them — computed view, cached per tab focus. Per SPEC-AMENDMENT-001 §7.3.`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

function SettingsTab({ client }: { client: Client }) {
  const contractTone =
    client.status === 'archived' ? 'warning' : client.status === 'onboarding' ? 'info' : 'success';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="size-4" aria-hidden />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Account manager" value={client.accountManager} />
            <Detail
              label="Status"
              value={
                <StatusBadge
                  tone={contractTone}
                  label={client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                  dot
                />
              }
            />
            <Detail
              label="Priority"
              value={client.priority.charAt(0).toUpperCase() + client.priority.slice(1)}
            />
            <Detail
              label="Onboarded"
              value={client.onboardedAt.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArchiveIcon className="size-4" aria-hidden />
            Archive
          </CardTitle>
        </CardHeader>
        <CardContent>
          {client.status === 'archived' ? (
            <p className="text-muted-foreground text-sm">
              This client is archived and hidden from default lists. Restore via the partner-only
              Restore action (capability: <code>restore_client</code>).
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Archiving keeps the client queryable but hides them from default lists. Use the bulk
              Archive action from the clients list. Hard delete is partner-only and refuses if any
              transactions reference this client.
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ActivityIcon className="size-4" aria-hidden />
            Audit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Every edit to this client (POC changes, bank-account reveals, contract uploads) is
            recorded to <code>audit_log</code> and mirrored as a typed event on the Activity tab.
          </p>
          <p className="text-muted-foreground mt-2 inline-flex items-center gap-1 text-xs">
            <BookOpenIcon className="size-3" aria-hidden />
            See: AUDIT-GAPS §6 + SPEC-AMENDMENT-001 §4
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  );
}

/* Silence the unused-icon import — kept for empty-state visuals consistency. */
void BanknoteIcon;
void MapPinIcon;
