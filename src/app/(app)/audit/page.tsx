import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileHeader } from '@/components/entity/profile-header';
import { AuditDiffRow } from '@/components/audit/audit-diff-row';
import { listActivityLog, listAuditLog } from '@/lib/server/audit/queries';
import { AuditFilters } from './_filters';

export const metadata: Metadata = { title: 'Audit · Apār Dashboard' };

type SearchParams = {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  fromDate?: string;
  toDate?: string;
  stream?: 'audit' | 'activity';
};

function fmtTs(d: Date): string {
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filter = {
    entityType: params.entityType && params.entityType !== 'all' ? params.entityType : undefined,
    entityId: params.entityId || undefined,
    actorId: params.actorId || undefined,
    fromDate: params.fromDate || undefined,
    toDate: params.toDate || undefined,
    limit: 100,
  };

  const stream = params.stream ?? 'audit';
  const [auditRows, activityRows] =
    stream === 'audit'
      ? [await listAuditLog(filter), [] as Awaited<ReturnType<typeof listActivityLog>>]
      : [[] as Awaited<ReturnType<typeof listAuditLog>>, await listActivityLog(filter)];

  return (
    <>
      <ProfileHeader
        title="Audit log"
        subtitle={
          stream === 'audit'
            ? 'Diff trail — one row per insert/update/delete on watched tables. Append-only.'
            : 'Activity feed — typed events ("Aakash created the client", "Vendor bill recorded").'
        }
        back={{ href: '/', label: 'Back to dashboard' }}
      />

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditFilters />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">
            {stream === 'audit' ? 'Diff entries' : 'Activity events'}
          </CardTitle>
          <span className="text-muted-foreground text-xs">
            {stream === 'audit' ? auditRows.length : activityRows.length} row(s)
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          {stream === 'audit' ? (
            auditRows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No audit rows match the filter.</p>
            ) : (
              auditRows.map((row) => (
                <div key={row.id} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="bg-muted rounded px-1.5 py-0.5 font-mono uppercase">
                      {row.action}
                    </span>
                    <span className="bg-muted rounded px-1.5 py-0.5 font-mono">
                      {row.entityType}
                    </span>
                    <span className="text-muted-foreground font-mono">{row.entityId}</span>
                    <span className="text-muted-foreground ml-auto">
                      {fmtTs(row.createdAt)} · {row.actorName ?? row.actorId ?? 'system'}
                    </span>
                  </div>
                  <AuditDiffRow
                    changes={row.changes as Parameters<typeof AuditDiffRow>[0]['changes']}
                  />
                </div>
              ))
            )
          ) : activityRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity rows match the filter.</p>
          ) : (
            activityRows.map((row) => (
              <div key={row.id} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="bg-muted rounded px-1.5 py-0.5 font-mono">{row.kind}</span>
                  <span className="bg-muted rounded px-1.5 py-0.5 font-mono">{row.entityType}</span>
                  <span className="text-muted-foreground font-mono">{row.entityId}</span>
                  <span className="text-muted-foreground ml-auto">
                    {fmtTs(row.createdAt)} · {row.actorName ?? row.actorId ?? 'system'}
                  </span>
                </div>
                <p className="text-foreground">{row.summary ?? '(no summary)'}</p>
                {row.payload ? (
                  <pre className="text-muted-foreground bg-muted mt-2 max-h-32 overflow-auto rounded p-2 text-[10px] leading-tight">
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
