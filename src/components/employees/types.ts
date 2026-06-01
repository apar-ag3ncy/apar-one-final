// TODO(backend): replace with Zod-schema-derived types from `@/types/employee` once Backend
// ships them (P1.14). Frontend stand-ins until then.

export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern';
export type EmployeeStatus = 'active' | 'notice' | 'separated';
export type Department =
  | 'creative'
  | 'strategy'
  | 'growth'
  | 'operations'
  | 'finance'
  | 'engineering'
  | 'leadership';

export type Employee = {
  id: string;
  fullName: string;
  designation: string;
  department: Department;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  workEmail: string;
  phone: string;
  city: string;
  joinedAt: Date;
  exitedAt: Date | null;
  reportsTo: string | null;
  panMasked: string | null; // e.g. XXXXX1234X
  aadhaarMasked: string | null; // last 4 only
  documentsCount: number;
  notes: string | null;
};
