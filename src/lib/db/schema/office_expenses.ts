import { bigint, date, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { employees } from './employees';
import { officeExpenseCategories } from './office_expense_categories';
import { projects } from './projects';
import { transactions } from './transactions';
import { vendors } from './vendors';

/**
 * Office expense category. Captures the everyday outflows the OS Office
 * app surfaces — stationary, tea/coffee, cleaning, leisure, utilities,
 * rent, and reimbursements to employees. New categories are added by
 * extending this enum.
 */
export const officeExpenseCategoryEnum = pgEnum('office_expense_category', [
  'stationary',
  'toiletries',
  'tea_coffee',
  'cleaning',
  'leisure',
  'utilities',
  'rent',
  'travel',
  'repairs',
  'reimbursement',
  'other',
]);

export const officeExpensePaymentMethodEnum = pgEnum('office_expense_payment_method', [
  'cash',
  'bank',
  'card',
  'upi',
  'employee_paid',
]);

export const officeExpenseStatusEnum = pgEnum('office_expense_status', [
  'pending',
  'approved',
  'reimbursed',
  'rejected',
]);

/**
 * Lightweight system-of-record for everyday office outflows. Not the
 * ledger — values come from the source bill / receipt and are captured,
 * never computed (CLAUDE rule #1, #2). Posting to the GL happens later
 * via the `office_expense` / `employee_reimbursement` posting templates
 * once a document is attached.
 */
export const officeExpenses = pgTable(
  'office_expenses',
  {
    ...timestamps(),
    ...auditColumns(),
    /** ISO date — when the expense was incurred (per the receipt). */
    expenseDate: date().notNull(),
    category: officeExpenseCategoryEnum().notNull(),
    /** Short description shown in the list. */
    description: text().notNull(),
    /**
     * FK to the live vendors directory. Set when the supplier already
     * exists in the system (Adobe India, Worli Couriers, …). Leave
     * null for one-off sellers and use `vendorName` instead.
     */
    vendorId: uuid().references(() => vendors.id, { onDelete: 'set null' }),
    /** Free-text fallback when the seller isn't in the vendors directory. */
    vendorName: text(),
    /** Set for category='reimbursement' — who paid out of pocket. */
    employeeId: uuid().references(() => employees.id, { onDelete: 'set null' }),
    /**
     * Optional project attribution — set when the expense was incurred for a
     * specific project (props, location costs, travel for a shoot, …). Nullable
     * because general office overhead (rent, utilities, stationary) has no
     * single project. `set null` on project delete so historical expenses
     * survive a project hard-delete.
     */
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    /** Pre-tax amount captured from the bill. bigint paise (CLAUDE rule #1). */
    amountPaise: bigint({ mode: 'bigint' }).notNull(),
    /** GST captured from the bill — 0 if the seller didn't levy any. */
    gstPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
    paymentMethod: officeExpensePaymentMethodEnum().notNull().default('bank'),
    status: officeExpenseStatusEnum().notNull().default('approved'),
    /** Optional reference number from the bill / receipt. */
    referenceNumber: text(),
    /**
     * Optional pin to a user-defined custom category. Only meaningful when
     * `category='other'` — lets the OS Office app group "other" outflows
     * into named buckets without extending the fixed enum. Nullable.
     */
    customCategoryId: uuid().references(() => officeExpenseCategories.id),
    /** Free-text note paired with `customCategoryId`. Nullable. */
    categoryNote: text(),
    /**
     * The posted GL journal this expense created (auto-post on save). Null
     * for reimbursement-category rows and legacy capture-only rows. A delete
     * reverses this transaction; an edit reverses + reposts.
     */
    transactionId: uuid().references(() => transactions.id),
    notes: text(),
  },
  (t) => [
    index().on(t.expenseDate),
    index().on(t.category),
    index().on(t.employeeId),
    index().on(t.vendorId),
    index().on(t.projectId),
    index().on(t.status),
    index().on(t.transactionId),
  ],
);

export type OfficeExpense = typeof officeExpenses.$inferSelect;
export type NewOfficeExpense = typeof officeExpenses.$inferInsert;
