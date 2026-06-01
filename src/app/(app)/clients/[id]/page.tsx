import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClientDetailTabs } from '@/components/clients/client-detail-tabs';
import { getClient } from '@/lib/server-stub/entity-actions';
import { listContacts } from '@/lib/server/entities/contacts';
import { getActorContext } from '@/lib/server/actor';
import type { ClientStatus } from '@/types/api';
import { ProfileHeader } from '@/components/entity/profile-header';
import { Button } from '@/components/ui/button';
import type { StatusTone } from '@/components/shared/status-badge';

const STATUS_TONES: Record<ClientStatus, StatusTone> = {
  active: 'success',
  onboarding: 'info',
  inactive: 'neutral',
  archived: 'neutral',
};

const STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Active',
  onboarding: 'Onboarding',
  inactive: 'Inactive',
  archived: 'Archived',
};

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return {
    title: client ? `${client.name} · Apār Dashboard` : 'Client · Apār Dashboard',
  };
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;
  const [client, contacts, actor] = await Promise.all([
    getClient(id),
    listContacts({ entityType: 'client', entityId: id }),
    getActorContext(),
  ]);
  if (!client) notFound();

  const canHardDelete = actor.role === 'partner';

  return (
    <>
      <ProfileHeader
        title={client.name}
        subtitle={
          <>
            {client.industry} · {client.city} · AM {client.accountManager}
          </>
        }
        status={{
          tone: STATUS_TONES[client.status],
          label: STATUS_LABELS[client.status],
        }}
        back={{ href: '/clients', label: 'All clients' }}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Server action pending (Backend agent)."
            >
              Edit
            </Button>
            <Button size="sm" disabled title="Server action pending (Backend agent).">
              Log activity
            </Button>
          </>
        }
      />
      <ClientDetailTabs client={client} contacts={contacts} canHardDeleteContacts={canHardDelete} />
    </>
  );
}
