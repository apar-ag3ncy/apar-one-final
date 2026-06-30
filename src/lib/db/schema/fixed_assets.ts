import { bigint, date, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { transactions } from './transactions';

export const fixedAssetStatusEnum = pgEnum('fixed_asset_status', [
  'active',
  'fully_depreciated',
  'disposed',
]);

/**
 * Fixed-asset register. Straight-line depreciation: monthly charge =
 * (cost − salvage) / useful_life_months. A depreciation run posts
 * Dr 6500 Depreciation / Cr 1590 Accumulated Depreciation for the period and
 * rolls `accumulated_depreciation_paise` + `depreciation_through` forward.
 * See drizzle/0051_fixed_assets.sql.
 */
export const fixedAssets = pgTable('fixed_assets', {
  ...timestamps(),
  ...auditColumns(),
  name: text().notNull(),
  category: text(),
  acquisitionDate: date().notNull(),
  costPaise: bigint({ mode: 'bigint' }).notNull(),
  salvageValuePaise: bigint({ mode: 'bigint' }).notNull().default(0n),
  usefulLifeMonths: integer().notNull(),
  accumulatedDepreciationPaise: bigint({ mode: 'bigint' }).notNull().default(0n),
  depreciationThrough: date(),
  status: fixedAssetStatusEnum().notNull().default('active'),
  sourceBillTxnId: uuid().references(() => transactions.id, { onDelete: 'set null' }),
  notes: text(),
});

export type FixedAsset = typeof fixedAssets.$inferSelect;
export type NewFixedAsset = typeof fixedAssets.$inferInsert;
