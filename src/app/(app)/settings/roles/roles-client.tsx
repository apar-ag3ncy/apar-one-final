'use client';

import { useState } from 'react';
import { CapabilityMatrix, type CapabilityGrants } from '@/components/entity/capability-matrix';
import { DEFAULT_GRANTS, type Capability, type Role } from '@/components/entity/capability-types';

/**
 * Client wrapper for the capability matrix. Local optimistic state until
 * Backend ships `getRoleCapabilities` + `setRoleCapability` server actions.
 *
 * TODO(backend): replace useState with React Query against A's actions.
 * The matrix UI itself is already wired so this swap is one-file.
 */
export function RolesClient() {
  const [grants, setGrants] = useState<CapabilityGrants>(() => cloneDefaults());

  function handleToggle(role: Role, capability: Capability, next: boolean) {
    setGrants((current) => {
      const updated = new Set(current[role]);
      if (next) updated.add(capability);
      else updated.delete(capability);
      return { ...current, [role]: updated };
    });
    // TODO(backend): call A.setRoleCapability(role, capability, next).
  }

  return (
    <CapabilityMatrix
      grants={grants}
      onToggle={handleToggle}
      // TODO(backend): set readOnly when current user lacks `manage_capabilities`.
    />
  );
}

function cloneDefaults(): CapabilityGrants {
  return {
    partner: new Set(DEFAULT_GRANTS.partner),
    admin: new Set(DEFAULT_GRANTS.admin),
    manager: new Set(DEFAULT_GRANTS.manager),
    accountant: new Set(DEFAULT_GRANTS.accountant),
    employee: new Set(DEFAULT_GRANTS.employee),
    viewer: new Set(DEFAULT_GRANTS.viewer),
  };
}
