'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CapabilityMatrix, type CapabilityGrants } from '@/components/entity/capability-matrix';
import { ROLES, type Capability, type Role } from '@/lib/capabilities';
import { setRoleCapability } from '@/lib/server/settings/role-capabilities';

/**
 * Client wrapper for the capability matrix. The server page loads the
 * initial grants (and gates the whole page on `manage_role_capabilities`);
 * each toggle applies optimistically, calls `setRoleCapability`, and
 * reverts with a toast if the server rejects it.
 */
export function RolesClient({ initialGrants }: { initialGrants: Record<Role, Capability[]> }) {
  const [grants, setGrants] = useState<CapabilityGrants>(() => toSets(initialGrants));
  const [, startTransition] = useTransition();

  function applyToggle(role: Role, capability: Capability, next: boolean) {
    setGrants((current) => {
      const updated = new Set(current[role]);
      if (next) updated.add(capability);
      else updated.delete(capability);
      return { ...current, [role]: updated };
    });
  }

  function handleToggle(role: Role, capability: Capability, next: boolean) {
    applyToggle(role, capability, next);
    startTransition(async () => {
      const result = await setRoleCapability(role, capability, next);
      if (!result.ok) {
        applyToggle(role, capability, !next);
        toast.error(result.message);
      }
    });
  }

  return <CapabilityMatrix grants={grants} onToggle={handleToggle} />;
}

function toSets(grants: Record<Role, Capability[]>): CapabilityGrants {
  const sets = {} as Record<Role, ReadonlySet<Capability>>;
  for (const role of ROLES) {
    sets[role] = new Set(grants[role] ?? []);
  }
  return sets;
}
