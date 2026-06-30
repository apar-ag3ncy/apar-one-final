'use client';

import { UsersRoundIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { formatINR } from '@/components/shared/format-inr';
import { UrlTabs, type UrlTab } from '@/components/shared/url-tabs';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { DocumentList } from '@/components/entity/document-list';
import { EntityRef } from '@/components/entity/entity-ref';
import { TransactionList, type Transaction } from '@/components/entity/transaction-list';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import type { BillingModel, Project } from './types';

const BILLING_LABELS: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed_fee: 'Fixed fee',
  time_and_materials: 'Time & materials',
  milestone: 'Milestone',
};

export type ProjectTransactionFeedProp = {
  transactions: readonly Transaction[];
  incomePaise: bigint;
  spendPaise: bigint;
};

export function ProjectDetailTabs({
  project,
  feed,
}: {
  project: Project;
  feed: ProjectTransactionFeedProp;
}) {
  const tabs: UrlTab[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'team', label: 'Team' },
    { value: 'transactions', label: 'Transactions', count: feed.transactions.length },
    { value: 'documents', label: 'Documents', count: project.documentsCount },
    { value: 'activity', label: 'Activity' },
  ];
  return (
    <UrlTabs tabs={tabs} defaultTab="overview">
      {{
        overview: <OverviewTab project={project} />,
        team: <TeamTab project={project} />,
        transactions: <TransactionsTab project={project} feed={feed} />,
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

function TransactionsTab({
  project,
  feed,
}: {
  project: Project;
  feed: ProjectTransactionFeedProp;
}) {
  const onNavigate = useEntityNavigate();
  const net = feed.incomePaise - feed.spendPaise;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat label="Income" valuePaise={feed.incomePaise} tone="success" />
        <SummaryStat label="Spend" valuePaise={feed.spendPaise} tone="muted" />
        <SummaryStat label="Net" valuePaise={net} tone={net >= 0n ? 'success' : 'danger'} />
      </div>
      <TransactionList
        transactions={feed.transactions}
        entityName={project.code || project.name}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function SummaryStat({
  label,
  valuePaise,
  tone,
}: {
  label: string;
  valuePaise: bigint;
  tone: 'success' | 'muted' | 'danger';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'danger'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-xs tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
          {formatINR(valuePaise)}
        </div>
      </CardContent>
    </Card>
  );
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
