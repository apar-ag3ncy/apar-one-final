import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { CurrentUserContext } from '@/lib/rbac';
import type { SafeEmployee } from '@/lib/server/employee-auth';

// getActorContext resolves the actor via maybeCurrentUser() then, when there is
// no admin session, denies employee-session requests before the dev-admin
// fallback. Mock those two boundaries + the db (ensureDevAdmin's execute).
vi.mock('@/lib/auth', () => ({ maybeCurrentUser: vi.fn() }));
vi.mock('@/lib/server/employee-auth', () => ({ currentEmployee: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: { execute: vi.fn().mockResolvedValue(undefined) } }));

import { getActorContext } from '@/lib/server/actor';
import { maybeCurrentUser } from '@/lib/auth';
import { currentEmployee } from '@/lib/server/employee-auth';
import { CAPABILITY_SET } from '@/lib/rbac';
import { AppError } from '@/lib/errors';

const mockMaybeUser = vi.mocked(maybeCurrentUser);
const mockEmployee = vi.mocked(currentEmployee);

const EMPLOYEE: SafeEmployee = {
  id: '11111111-1111-4111-8111-111111111111',
  employeeCode: 'APAR-001',
  fullName: 'Test Employee',
  displayName: null,
  workEmail: 'test@apar.example',
  designation: null,
  department: null,
  status: 'active',
  joinedOn: '2024-01-01',
};

describe('getActorContext — employee/admin boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_DEV_ADMIN;
  });

  it('denies an employee-session request with a 403 forbidden instead of granting dev-admin', async () => {
    mockMaybeUser.mockResolvedValue(null);
    mockEmployee.mockResolvedValue(EMPLOYEE);

    // The critical guarantee: an employee session must NOT receive an admin
    // actor (which would let it reach every finance/KYC/ledger action).
    await expect(getActorContext()).rejects.toBeInstanceOf(AppError);
    await expect(getActorContext()).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('falls back to full-capability dev-admin for a request with no employee session', async () => {
    mockMaybeUser.mockResolvedValue(null);
    mockEmployee.mockResolvedValue(null);

    const ctx = await getActorContext();
    expect(ctx.role).toBe('admin');
    expect(ctx.capabilities).toBe(CAPABILITY_SET);
  });

  it('returns the real authenticated user and never checks the employee session', async () => {
    const real: CurrentUserContext = {
      userId: '22222222-2222-4222-8222-222222222222',
      role: 'admin',
      capabilities: CAPABILITY_SET,
    };
    mockMaybeUser.mockResolvedValue(real);

    const ctx = await getActorContext();
    expect(ctx).toBe(real);
    expect(mockEmployee).not.toHaveBeenCalled();
  });
});
