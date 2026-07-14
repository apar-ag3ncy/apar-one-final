// TODO(backend): replace with Zod-schema-derived types from `@/types/employee` once Backend
// ships them (P1.14). Frontend stand-ins until then.

export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern';
export type EmployeeStatus = 'active' | 'on_leave' | 'notice' | 'separated' | 'prospective';

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
  exitedAt: Date | null;
  reportsTo: string | null;
  panMasked: string | null; // e.g. XXXXX1234X
  aadhaarMasked: string | null; // last 4 only
  documentsCount: number;
  noticePeriodDays?: string | null;
  notes: string | null;
};
