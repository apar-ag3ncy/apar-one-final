import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { employees, osUsers } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { readOsSessionUserId } from '@/lib/server/os-session';

/**
 * "Who am I" for the employee portal.
 *
 * THE central security primitive of the portal: every portal read and write
 * derives its employee id from here and NEVER from client input. Almost all of
 * the existing entity reads (`listEmployeeLeaves`, `listEmployeeBonuses`,
 * `getEmployeeStatement`, `listBankAccounts`, …) take a caller-supplied
 * `employeeId` with no ownership check, so passing one through from the browser
 * would be textbook IDOR.
 *
 * Unlike `getActorContext()`, this NEVER falls back to a dev admin. No valid
 * session ⇒ throw. There is no configuration that turns that off.
 *
 * A session is only a portal session when the signed cookie resolves to a LIVE
 * `os_users` row whose `employee_id` points at a LIVE, non-archived employee.
 * Staff/OS accounts (employee_id IS NULL) are deliberately not portal
 * identities — they use /os.
 */

export type PortalSession = {
  /** os_users.id (TEXT — never write this to a uuid actor column). */
  osUserId: string;
  /** employees.id (uuid) — the actor id for portal writes. */
  employeeId: string;
  fullName: string;
  displayName: string | null;
  designation: string | null;
  department: string | null;
  /** 'member' | 'manager'. Managers get the reporting-subtree leave queue. */
  portalRole: string;
  isManager: boolean;
  /**
   * True when the underlying OS account is an admin/super-admin that also has
   * an employee link. Admins keep their full OS rights (see resolveOsActor) and
   * additionally pick up the leave of anyone with NO manager appointed — the
   * "unassigned people fall to admin" rule.
   */
  isAdmin: boolean;
};

/**
 * Resolve the portal session, or null when there isn't a valid one.
 * Use in the portal layout to redirect to the login page.
 */
export async function maybePortalEmployee(): Promise<PortalSession | null> {
  const osUserId = await readOsSessionUserId();
  if (!osUserId) return null;

  const [row] = await db
    .select({
      osUserId: osUsers.id,
      osRole: osUsers.role,
      employeeId: employees.id,
      fullName: employees.fullName,
      displayName: employees.displayName,
      designation: employees.designation,
      department: employees.department,
      portalRole: employees.portalRole,
      status: employees.status,
      isArchived: employees.isArchived,
    })
    .from(osUsers)
    .innerJoin(employees, eq(employees.id, osUsers.employeeId))
    .where(and(eq(osUsers.id, osUserId), isNull(osUsers.deletedAt), isNull(employees.deletedAt)))
    .limit(1);

  // No row ⇒ either the cookie is stale, the account was soft-deleted, or it
  // is a staff/OS account with no employee link. None of those is a portal
  // identity.
  if (!row) return null;

  // A separated or archived employee keeps their row (7-year retention) but
  // must lose portal access immediately.
  if (row.isArchived || row.status === 'separated') return null;

  return {
    osUserId: row.osUserId,
    employeeId: row.employeeId,
    fullName: row.fullName,
    displayName: row.displayName,
    designation: row.designation,
    department: row.department,
    portalRole: row.portalRole,
    // An admin reviews leave too, so treat them as a manager for the queue.
    isManager: row.portalRole === 'manager' || isAdminRole(row.osRole),
    isAdmin: isAdminRole(row.osRole),
  };
}

function isAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'admin';
}

/**
 * Resolve the portal session or throw. Every portal server function starts
 * here — including ones the UI already gates, because Server Actions are plain
 * HTTP POSTs and the UI is not a security boundary.
 */
export async function requirePortalEmployee(): Promise<PortalSession> {
  const session = await maybePortalEmployee();
  if (!session) {
    throw new AppError('unauthenticated', 'Sign in to the employee portal to continue.');
  }
  return session;
}

/**
 * Resolve a MANAGER portal session or throw. Used by the pending-leave queue
 * and the approve/reject actions.
 */
export async function requirePortalManager(): Promise<PortalSession> {
  const session = await requirePortalEmployee();
  if (!session.isManager) {
    throw new AppError('forbidden', 'Only managers can review leave requests.');
  }
  return session;
}
