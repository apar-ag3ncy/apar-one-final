import type { Metadata } from 'next';
import { LayoutDashboardIcon } from 'lucide-react';
import { count, eq, isNull, and } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { clients, employees, projects, vendors } from '@/lib/db/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Dashboard · Apar Dashboard',
};

async function getKpis() {
  const [clientCount, vendorCount, employeeCount, projectCount] = await Promise.all([
    db
      .select({ n: count() })
      .from(clients)
      .where(and(isNull(clients.deletedAt), eq(clients.isArchived, false)))
      .then((rs) => rs[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(vendors)
      .where(and(isNull(vendors.deletedAt), eq(vendors.isArchived, false)))
      .then((rs) => rs[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(employees)
      .where(and(isNull(employees.deletedAt), eq(employees.isArchived, false)))
      .then((rs) => rs[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(projects)
      .where(and(isNull(projects.deletedAt), eq(projects.isArchived, false)))
      .then((rs) => rs[0]?.n ?? 0),
  ]);
  return { clientCount, vendorCount, employeeCount, projectCount };
}

export default async function DashboardPage() {
  const kpis = await getKpis();
  const total = kpis.clientCount + kpis.vendorCount + kpis.employeeCount + kpis.projectCount;

  const tiles = [
    { label: 'Active clients', value: String(kpis.clientCount) },
    { label: 'Active vendors', value: String(kpis.vendorCount) },
    { label: 'Active employees', value: String(kpis.employeeCount) },
    { label: 'Active projects', value: String(kpis.projectCount) },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live counts from the database. Activity feed and per-client P&L land once Phase 6 wiring is complete across all surfaces."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {total === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={LayoutDashboardIcon}
            title="No entities yet"
            description="Run the seed script (npm run db:seed) or add a client to start exercising the dashboard."
          />
        </div>
      ) : null}
    </>
  );
}
