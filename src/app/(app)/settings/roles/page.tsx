import type { Metadata } from 'next';
import { LockIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ProfileHeader } from '@/components/entity/profile-header';
import { hasCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { loadRoleCapabilityGrants } from '@/lib/server/settings/role-capabilities-data';
import { RolesClient } from './roles-client';

export const metadata: Metadata = {
  title: 'Roles & capabilities · Apār Dashboard',
};

export default async function RolesPage() {
  const actor = await getActorContext();
  const canManage = hasCapability(actor, 'manage_role_capabilities');

  return (
    <>
      <ProfileHeader
        title="Roles & capabilities"
        subtitle={<>Partners only. Every grant or revoke writes to the audit log.</>}
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      {canManage ? (
        <RolesClient initialGrants={await loadRoleCapabilityGrants()} />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <LockIcon className="size-4" aria-hidden />
            You don&apos;t have permission to manage roles. Ask a partner to grant{' '}
            <span className="font-mono text-xs">manage_role_capabilities</span>.
          </CardContent>
        </Card>
      )}
    </>
  );
}
