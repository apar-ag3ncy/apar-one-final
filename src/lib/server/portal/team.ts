import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  employees,
  entityActivityLog,
  entityAddresses,
  entityContacts,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

import { requirePortalEmployee } from './session';

/**
 * The peer-visible team directory.
 *
 * THIS FILE IS THE PRIVACY BOUNDARY. Everyone can see everyone's basic info,
 * contacts, addresses and achievements; nobody can see anyone else's money.
 *
 * It is a purpose-built projection rather than a call into `listEmployees` /
 * `getEmployeeSummary`, because those return fields that must never be
 * peer-visible:
 *
 *   - `payrollGrade` — a SALARY BAND, not a job title. Compensation data.
 *   - `notes`        — HR free text (performance, exit reasons, salary context).
 *   - `maskedPan` / `maskedAadhaar` — KYC. Masked is still not shareable.
 *   - `personalEmail` — private, as distinct from the work email.
 *
 * And nothing here touches `salary_structures`, `salary_payments`,
 * `bonuses_and_perks`, `reimbursements`, `entity_bank_accounts` or
 * `getEmployeeStatement`. Note `listBankAccounts` returns FULLY REVEALED
 * account numbers by design — it must never be reachable from this surface.
 *
 * The redaction is by CONSTRUCTION (the columns are never selected), not by
 * hiding fields in the UI, so a leak cannot be introduced by a template edit.
 */

export type TeamMemberCard = {
  employeeId: string;
  fullName: string;
  displayName: string | null;
  designation: string | null;
  department: string | null;
  /** Shared so teammates can wish each other — the user asked for this. */
  dateOfBirth: string | null;
  joinedOn: string;
  workEmail: string | null;
  phone: string | null;
  status: string;
  isMe: boolean;
};

export type TeamContact = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type TeamAddress = {
  id: string;
  kind: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string | null;
  isPrimary: boolean;
};

export type TeamAchievement = {
  id: string;
  summary: string;
  /** Log timestamp. The event's own date lives in the jsonb payload. */
  at: string;
};

export type TeamMemberProfile = TeamMemberCard & {
  contacts: TeamContact[];
  addresses: TeamAddress[];
  achievements: TeamAchievement[];
};

/** Everyone currently working here. Requires only a valid portal session. */
export async function listTeam(): Promise<TeamMemberCard[]> {
  const me = await requirePortalEmployee();

  const rows = await db
    .select({
      employeeId: employees.id,
      fullName: employees.fullName,
      displayName: employees.displayName,
      designation: employees.designation,
      department: employees.department,
      dateOfBirth: employees.dateOfBirth,
      joinedOn: employees.joinedOn,
      workEmail: employees.workEmail,
      phone: employees.phone,
      status: employees.status,
    })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        eq(employees.isArchived, false),
        // Separated people keep their row for the 7-year retention window but
        // should not appear in a live directory.
        sql`${employees.status} <> 'separated'`,
      ),
    )
    .orderBy(asc(employees.fullName));

  return rows.map((r) => ({ ...r, isMe: r.employeeId === me.employeeId }));
}

/**
 * One teammate's shareable profile.
 *
 * Takes an employeeId — this is the ONE portal read that legitimately does,
 * because the directory is peer-visible by design. It is still bounded: the id
 * must resolve to a live, non-separated employee, and the projection carries no
 * compensation, KYC or HR-notes field at all.
 */
export async function getTeamMemberProfile(employeeId: string): Promise<TeamMemberProfile> {
  const me = await requirePortalEmployee();

  const [person] = await db
    .select({
      employeeId: employees.id,
      fullName: employees.fullName,
      displayName: employees.displayName,
      designation: employees.designation,
      department: employees.department,
      dateOfBirth: employees.dateOfBirth,
      joinedOn: employees.joinedOn,
      workEmail: employees.workEmail,
      phone: employees.phone,
      status: employees.status,
    })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        isNull(employees.deletedAt),
        eq(employees.isArchived, false),
        sql`${employees.status} <> 'separated'`,
      ),
    )
    .limit(1);

  if (!person) throw new AppError('not_found', 'That teammate is not in the directory.');

  const [contacts, addresses, achievements] = await Promise.all([
    db
      .select({
        id: entityContacts.id,
        name: entityContacts.name,
        role: entityContacts.role,
        email: entityContacts.email,
        phone: entityContacts.phone,
        isPrimary: entityContacts.isPrimary,
        // `notes` deliberately not selected — freeform and unvetted.
      })
      .from(entityContacts)
      .where(
        and(
          eq(entityContacts.entityType, 'employee'),
          eq(entityContacts.entityId, employeeId),
          isNull(entityContacts.deletedAt),
        ),
      )
      .orderBy(desc(entityContacts.isPrimary), asc(entityContacts.name)),

    db
      .select({
        id: entityAddresses.id,
        kind: entityAddresses.kind,
        line1: entityAddresses.line1,
        line2: entityAddresses.line2,
        city: entityAddresses.city,
        stateCode: entityAddresses.stateCode,
        postalCode: entityAddresses.postalCode,
        isPrimary: entityAddresses.isPrimary,
        // `gstin` and `notes` deliberately not selected.
      })
      .from(entityAddresses)
      .where(
        and(
          eq(entityAddresses.entityType, 'employee'),
          eq(entityAddresses.entityId, employeeId),
          isNull(entityAddresses.deletedAt),
        ),
      )
      .orderBy(desc(entityAddresses.isPrimary)),

    // Achievements are entity_activity_log rows, not their own table.
    db
      .select({
        id: entityActivityLog.id,
        summary: entityActivityLog.summary,
        at: entityActivityLog.createdAt,
      })
      .from(entityActivityLog)
      .where(
        and(
          eq(entityActivityLog.entityType, 'employee'),
          eq(entityActivityLog.entityId, employeeId),
          eq(entityActivityLog.isAchievement, true),
        ),
      )
      .orderBy(desc(entityActivityLog.createdAt))
      .limit(50),
  ]);

  return {
    ...person,
    isMe: person.employeeId === me.employeeId,
    contacts,
    addresses,
    achievements: achievements.map((a) => ({ ...a, at: a.at.toISOString() })),
  };
}
