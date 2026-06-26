import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ClientsList } from '@/components/clients/clients-list';
import { listClients } from '@/lib/server-stub/entity-actions';
import { getActorContext } from '@/lib/server/actor';
import { hasCapability } from '@/lib/rbac';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Clients · Apar Dashboard',
};

export default async function ClientsPage() {
  const [data, actor] = await Promise.all([listClients(), getActorContext()]);
  const canArchive = hasCapability(actor, 'archive_client');
  const canHardDelete = actor.role === 'partner';
  return (
    <>
      <PageHeader
        title="Clients"
        description={`${data.length} client${data.length === 1 ? '' : 's'} on the books. Filter, sort, save a view, or export to CSV / Excel.`}
        actions={
          <Button asChild size="sm">
            <Link href="/clients/new">New client</Link>
          </Button>
        }
      />
      <ClientsList data={data} canArchive={canArchive} canHardDelete={canHardDelete} />
    </>
  );
}
