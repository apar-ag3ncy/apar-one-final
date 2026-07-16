import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClientDetailTabs } from '@/components/clients/client-detail-tabs';
import {
  getClient,
  listEmployees,
  listProjectsByClient,
  listUsers,
} from '@/lib/server-stub/entity-actions';
import { listContacts } from '@/lib/server/entities/contacts';
import { getActorContext } from '@/lib/server/actor';
import { hasCapability } from '@/lib/rbac';
import { isAssignableEmployee } from '@/lib/employee-badges';
import type { ClientStatus } from '@/types/api';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ClientEditButton } from '@/components/clients/client-edit-button';
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
    title: client ? `${client.name} · Apar Dashboard` : 'Client · Apar Dashboard',
  };
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;
  const [client, contacts, projects, employees, users, actor] = await Promise.all([
    getClient(id),
    listContacts({ entityType: 'client', entityId: id }),
    listProjectsByClient(id),
    listEmployees(),
    listUsers(),
    getActorContext(),
  ]);
  if (!client) notFound();

  const canHardDelete = actor.role === 'partner';
  const canEdit = hasCapability(actor, 'update_client');

  const employeeOptions = employees
    .filter((e) => isAssignableEmployee(e.status))
    .map((e) => ({ id: e.id, name: e.fullName }));
  const userOptions = users.map((u) => ({ id: u.id, name: u.fullName }));

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
            {canEdit ? (
              <ClientEditButton client={client} />
            ) : (
              <Button size="sm" variant="outline" disabled title="Your role can't edit clients.">
                Edit
              </Button>
            )}
          </>
        }
      />
      <ClientDetailTabs
        client={client}
        contacts={contacts}
        projects={projects}
        employees={employeeOptions}
        users={userOptions}
        canHardDeleteContacts={canHardDelete}
      />
    </>
  );
}
