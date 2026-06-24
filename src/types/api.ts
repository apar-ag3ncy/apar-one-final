/**
 * Canonical type surface the UI imports from. Backend (A) will replace the
 * contents of this module with generated Zod schemas + inferred types once
 * the Drizzle schema lands. Until then this re-exports the frontend-local
 * fixture types so every component imports from one path.
 *
 * Rule of thumb for the UI: anywhere you would `import type { Client } from
 * '@/components/clients/types'`, import from here instead. Form Zod schemas
 * that need to round-trip with the server should also live in this file
 * (or be re-exported from it) so the schema is the single source of truth.
 */

export type { Client, ClientPoc, ClientStatus, ClientPriority } from '@/components/clients/types';
export type { Vendor, VendorCategory } from '@/components/vendors/types';
export type {
  Employee,
  Department,
  EmploymentType,
  EmployeeStatus,
} from '@/components/employees/types';
export type { Project, BillingModel, ProjectStatus } from '@/components/projects/types';

// Shared sub-shapes used by entity components.
export type { Contact } from '@/components/entity/contact-list';
export type { Address } from '@/components/entity/address-list';
export type { BankAccount } from '@/components/entity/bank-account-list';
export type { TaxIdentifier, TaxIdentifierKind } from '@/components/entity/tax-identifier-list';
export type {
  EntityDocument,
  DocumentKind,
  DocumentSignStatus,
} from '@/components/entity/document-list';
export type {
  Transaction,
  TransactionKind,
  TransactionStatus,
  TransactionCounterparty,
} from '@/components/entity/transaction-list';
export type {
  TransactionPosting,
  TransactionDetailData,
  TransactionFlag,
} from '@/components/entity/transaction-detail';
export type { ActivityEvent, ActivityKind } from '@/components/entity/activity-feed';
export type {
  EntityType,
  NavigationTarget,
  BackTarget,
  EntityStatus,
  FieldConfidence,
} from '@/components/entity/types';
export type { Role, Capability } from '@/lib/capabilities';
export type {
  FormField,
  FormFieldType,
  FormFieldOptions,
  FormTemplate,
  FormValues,
} from '@/components/entity/form-template-types';

// Ledger / accounting.
export type {
  ChartAccount,
  LedgerDomain,
  DraftResult,
  PerClientPnLRow,
  PerVendorSpendRow,
  TrialBalanceRow,
  StatementRow,
  AgingBucket,
  AgingRow,
  Period,
  ReconciliationRow,
  TaxReferenceRate,
  ValidationRule,
  AgencyBankAccount,
} from '@/lib/server-stub/ledger-types';

// User session.
export type { CurrentUser } from '@/lib/server-stub/entity-actions';
