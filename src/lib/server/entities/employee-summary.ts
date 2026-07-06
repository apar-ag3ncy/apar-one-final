'use server';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  employees,
  entityActivityLog,
  entityDocuments,
  leaves,
  projects,
  reimbursements,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';

/**
 * Aggregated read for the OS employee profile / personal-dashboard window.
 * SPEC-AMENDMENT-001 §8.4 — KPI cards + achievements + projects led + signed
 * docs, all read-only from any logged-in user. Employee-side edits happen
 * in the (portal)/me/* Dashboard routes.
 */

export type EmployeeProjectRow = {
  id: string;
  code: string | null;
  name: string;
  status: 'pitch' | 'won' | 'active' | 'on_hold' | 'completed' | 'cancelled';
};

export type EmployeeAchievementRow = {
  id: string;
  kind: string;
  summary: string;
  at: string;
};

export type EmployeeDocumentRow = {
  id: string;
  documentKind: string;
  uploadedAt: string;
};

export type EmployeeSummary = {
  employee: {
    id: string;
    fullName: string;
    displayName: string | null;
    designation: string | null;
    department: string | null;
    employmentType: string;
    status: string;
    isArchived: boolean;
    joinedOn: string;
    dateOfBirth: string | null;
    confirmedOn: string | null;
    separatedOn: string | null;
    noticePeriodDays: string | null;
    reportsToEmployeeId: string | null;
    contractStatus: string;
    workEmail: string | null;
    personalEmail: string | null;
    phone: string | null;
    maskedPan: string | null;
    maskedAadhaar: string | null;
  };
  kpis: {
    projectsLed: number;
    leavesApplied: number;
    leavesApproved: number;
    reimbursementsPending: number;
    documentsCount: number;
  };
  projectsLed: readonly EmployeeProjectRow[];
  achievements: readonly EmployeeAchievementRow[];
  documents: readonly EmployeeDocumentRow[];
};

export async function getEmployeeSummary(employeeId: string): Promise<EmployeeSummary> {
  await getActorContext();

  const empRows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  const emp = empRows[0];
  if (!emp) {
    throw new AppError('not_found', `Employee ${employeeId} not found`);
  }

  const [projsLed, leavesAll, reimbsPending, docsRows, achRows] = await Promise.all([
    // Projects led (active + non-archived only) — full list, capped at 50.
    db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        status: projects.status,
      })
      .from(projects)
      .where(
        and(
          eq(projects.leadEmployeeId, employeeId),
          eq(projects.isArchived, false),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(desc(projects.updatedAt))
      .limit(50),

    // Leaves grouped by status — applied + approved.
    db
      .select({
        status: leaves.status,
        n: sql<number>`count(*)::int`,
      })
      .from(leaves)
      .where(and(eq(leaves.employeeId, employeeId), isNull(leaves.deletedAt)))
      .groupBy(leaves.status),

    // Reimbursements pending (submitted or approved-but-unpaid).
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(reimbursements)
      .where(
        and(
          eq(reimbursements.employeeId, employeeId),
          sql`${reimbursements.status} IN ('submitted', 'approved')`,
          isNull(reimbursements.deletedAt),
        ),
      ),

    // Signed documents attached to this employee.
    db
      .select({
        id: entityDocuments.id,
        documentKind: entityDocuments.kind,
        uploadedAt: entityDocuments.createdAt,
      })
      .from(entityDocuments)
      .where(
        and(
          eq(entityDocuments.entityType, 'employee'),
          eq(entityDocuments.entityId, employeeId),
          isNull(entityDocuments.deletedAt),
        ),
      )
      .orderBy(desc(entityDocuments.createdAt))
      .limit(20),

    // Achievements (curated subset of activity events).
    db
      .select({
        id: entityActivityLog.id,
        kind: entityActivityLog.kind,
        summary: entityActivityLog.summary,
        createdAt: entityActivityLog.createdAt,
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
      .limit(20),
  ]);

  const leavesApplied = leavesAll.find((r) => r.status === 'applied')?.n ?? 0;
  const leavesApproved = leavesAll.find((r) => r.status === 'approved')?.n ?? 0;

  return {
    employee: {
      id: emp.id,
      fullName: emp.fullName,
      displayName: emp.displayName,
      designation: emp.designation,
      department: emp.department,
      employmentType: emp.employmentType,
      status: emp.status,
      isArchived: emp.isArchived,
      joinedOn: emp.joinedOn,
      dateOfBirth: emp.dateOfBirth,
      confirmedOn: emp.confirmedOn,
      separatedOn: emp.separatedOn,
      noticePeriodDays: emp.noticePeriodDays,
      reportsToEmployeeId: emp.reportsToEmployeeId,
      contractStatus: emp.contractStatus,
      workEmail: emp.workEmail,
      personalEmail: emp.personalEmail,
      phone: emp.phone,
      maskedPan: emp.maskedPan,
      maskedAadhaar: emp.maskedAadhaar,
    },
    kpis: {
      projectsLed: projsLed.length,
      leavesApplied,
      leavesApproved,
      reimbursementsPending: reimbsPending[0]?.n ?? 0,
      documentsCount: docsRows.length,
    },
    projectsLed: projsLed.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
    })),
    achievements: achRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      at: a.createdAt.toISOString(),
    })),
    documents: docsRows.map((d) => ({
      id: d.id,
      documentKind: d.documentKind,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
  };
}
