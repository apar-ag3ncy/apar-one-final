// TODO(backend): replace with Zod-schema-derived types from `@/types/employee` once Backend
// ships them (P1.14). Frontend stand-ins until then.

export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern';
export type EmployeeStatus = 'active' | 'on_leave' | 'notice' | 'separated' | 'prospective';

/**
 * Payroll grade levels (§1.1). The employee *type* is derivable from the
 * grade's first letter — Intern (I), Probation (P…), Employee (E…) — so a
 * single nullable column carries both.
 */
export type PayrollGrade = 'I' | 'PA' | 'PB' | 'PC' | 'PA+' | 'EA' | 'EB' | 'EC' | 'EA+';

export const PAYROLL_GRADES: readonly PayrollGrade[] = [
  'I',
  'PA',
  'PB',
  'PC',
  'PA+',
  'EA',
  'EB',
  'EC',
  'EA+',
];

/** Grades grouped by employee type, for grouped pickers / filters. */
export const PAYROLL_GRADE_GROUPS: ReadonlyArray<{
  label: string;
  grades: readonly PayrollGrade[];
}> = [
  { label: 'Intern', grades: ['I'] },
  { label: 'Probation', grades: ['PA', 'PB', 'PC', 'PA+'] },
  { label: 'Employee', grades: ['EA', 'EB', 'EC', 'EA+'] },
];

/** Employee type implied by a grade's first letter ('EA+' → 'Employee'). */
export function payrollGradeKind(grade: string): string {
  if (grade.startsWith('I')) return 'Intern';
  if (grade.startsWith('P')) return 'Probation';
  return 'Employee';
}

/**
 * The grade group an employee's category entitles them to (the founder's rule):
 * Intern employment type → the Intern grade (I); anyone on probation → the
 * Probation grades (PA–PA+); everyone else (fixed/full-time etc.) → the
 * Employee grades (EA–EA+). `employmentType` accepts both the DB enum
 * ('contract'/'consultant') and the UI value ('contractor') — only 'intern'
 * is special-cased, the rest fall through to the probation/employee split.
 */
export function expectedGradeKindFor(
  employmentType: string,
  onProbation: boolean,
): 'Intern' | 'Probation' | 'Employee' {
  if (employmentType === 'intern') return 'Intern';
  return onProbation ? 'Probation' : 'Employee';
}

/** The grades selectable for a category — see {@link expectedGradeKindFor}. */
export function allowedGradesFor(
  employmentType: string,
  onProbation: boolean,
): readonly PayrollGrade[] {
  const kind = expectedGradeKindFor(employmentType, onProbation);
  return PAYROLL_GRADE_GROUPS.find((g) => g.label === kind)?.grades ?? PAYROLL_GRADES;
}

/**
 * Departments are free-form / dynamic — HR can add new ones at create/edit
 * time. The values below seed the suggestion list; any string is accepted
 * and persisted. Stored lowercase (server normalizes); rendered title-cased
 * via {@link departmentLabel}.
 */
export type Department = string;

export const KNOWN_DEPARTMENTS: readonly string[] = [
  'creative',
  'strategy',
  'growth',
  'operations',
  'finance',
  'engineering',
  'leadership',
];

/** Title-case a department for display ('people ops' → 'People Ops'). */
export function departmentLabel(d: string | null | undefined): string {
  const v = (d ?? '').trim();
  if (!v) return '—';
  return v
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export type Employee = {
  id: string;
  /** Human-readable display id 'APAR-001'. */
  employeeCode: string;
  fullName: string;
  displayName: string | null;
  designation: string;
  department: Department;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  /** Salary grade level ('EA+', 'I', …). Optional — null for ungraded rows. */
  payrollGrade?: PayrollGrade | null;
  workEmail: string;
  personalEmail?: string;
  phone: string;
  city: string;
  joinedAt: Date;
  dateOfBirth: string | null;
  /**
   * Probation-confirmation date (YYYY-MM-DD) or null while still on
   * probation. Optional so demo/sample constructors stay valid.
   */
  confirmedOn?: string | null;
  /**
   * Custom probation end date (YYYY-MM-DD) or null (0081). When set, the
   * probation badge derives from this instead of the default 6-month window.
   */
  probationEndsOn?: string | null;
  exitedAt: Date | null;
  reportsTo: string | null;
  panMasked: string | null; // e.g. XXXXX1234X
  aadhaarMasked: string | null; // last 4 only
  documentsCount: number;
  noticePeriodDays?: string | null;
  notes: string | null;
};
