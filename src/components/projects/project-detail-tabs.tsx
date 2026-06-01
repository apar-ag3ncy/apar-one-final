'use client';

import { FlagIcon, ListChecksIcon, UsersRoundIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { formatINR } from '@/components/shared/format-inr';
import { UrlTabs, type UrlTab } from '@/components/shared/url-tabs';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { DocumentList } from '@/components/entity/document-list';
import { EntityRef } from '@/components/entity/entity-ref';
import { TransactionList } from '@/components/entity/transaction-list';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import type { BillingModel, Project } from './types';

const BILLING_LABELS: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed_fee: 'Fixed fee',
  time_and_materials: 'Time & materials',
  milestone: 'Milestone',
};

export function ProjectDetailTabs({ project }: { project: Project }) {
  const tabs: UrlTab[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'team', label: 'Team' },
    {
      value: 'deliverables',
      label: 'Deliverables',
      count: `${project.deliverablesDone}/${project.deliverablesTotal}`,
    },
    {
      value: 'milestones',
      label: 'Milestones',
      count: `${project.milestonesDone}/${project.milestonesTotal}`,
    },
    { value: 'invoices', label: 'Invoices' },
    { value: 'documents', label: 'Documents', count: project.documentsCount },
    { value: 'activity', label: 'Activity' },
  ];
  return (
    <UrlTabs tabs={tabs} defaultTab="overview">
      {{
        overview: <OverviewTab project={project} />,
        team: <TeamTab project={project} />,
        deliverables: <DeliverablesTab project={project} />,
        milestones: <MilestonesTab project={project} />,
        invoices: <InvoicesTab project={project} />,
        documents: <DocumentsTab project={project} />,
        activity: <ActivityTab />,
      }}
    </UrlTabs>
  );
}

function OverviewTab({ project }: { project: Project }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Code" value={<span className="font-mono">{project.code}</span>} />
            <Detail label="Client" value={<ProjectClientRef project={project} />} />
            <Detail label="Lead" value={project.leadName} />
            <Detail label="Billing" value={BILLING_LABELS[project.billingModel]} />
            <Detail
              label="Started"
              value={project.startedAt.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            />
            <Detail
              label="Ends"
              value={
                project.endsAt ? (
                  project.endsAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                ) : (
                  <span className="text-muted-foreground">Ongoing</span>
                )
              }
            />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fee</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">{formatINR(project.feePaise)}</div>
          <p className="text-muted-foreground mt-1 text-xs">
            Captured from the signed SOW — not computed.
          </p>
          {project.notes ? (
            <p className="text-muted-foreground mt-4 text-sm whitespace-pre-wrap">
              {project.notes}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function TeamTab({ project }: { project: Project }) {
  return (
    <EmptyState
      icon={UsersRoundIcon}
      title="Team list not wired yet"
      description={`Project team (lead: ${project.leadName}) renders here once Backend ships the project_team join table.`}
    />
  );
}

function DeliverablesTab({ project }: { project: Project }) {
  return (
    <EmptyState
      icon={ListChecksIcon}
      title={`${project.deliverablesDone} of ${project.deliverablesTotal} deliverables done`}
      description="Kanban + list toggle lands in Phase 2 (P2.03). Drag-between-status updates the row."
    />
  );
}

function MilestonesTab({ project }: { project: Project }) {
  return (
    <EmptyState
      icon={FlagIcon}
      title={`${project.milestonesDone} of ${project.milestonesTotal} milestones complete`}
      description="Milestone timeline lands in Phase 2 (P2.03)."
    />
  );
}

function InvoicesTab({ project }: { project: Project }) {
  const onNavigate = useEntityNavigate();
  return <TransactionList transactions={[]} entityName={project.code} onNavigate={onNavigate} />;
}

function DocumentsTab({ project }: { project: Project }) {
  return <DocumentList documents={[]} entityName={project.code} />;
}

function ActivityTab() {
  const onNavigate = useEntityNavigate();
  return <ActivityFeed events={[]} onNavigate={onNavigate} showHeader={false} />;
}

function ProjectClientRef({ project }: { project: Project }) {
  const onNavigate = useEntityNavigate();
  return (
    <EntityRef
      type="client"
      id={project.clientId}
      label={project.clientName}
      onNavigate={onNavigate}
    />
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
