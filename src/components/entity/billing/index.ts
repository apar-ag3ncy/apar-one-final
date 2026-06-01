/**
 * Barrel export for shared billing components.
 *
 * Both Dashboard route pages (`app/(app)/billing/*`) and OS billing windows
 * (BILL-B) import from here. Keep this index stable — adding components is
 * cheap, renaming/removing breaks BILL-B at build time.
 */

export { InvoiceList } from './invoice-list';
export type { InvoiceListProps } from './invoice-list';
export { InvoiceDetail } from './invoice-detail';
export type { InvoiceDetailProps } from './invoice-detail';
export { InvoiceForm } from './invoice-form';
export type { InvoiceFormProps } from './invoice-form';

export { EstimateList } from './estimate-list';
export type { EstimateListProps } from './estimate-list';
export { EstimateDetail } from './estimate-detail';
export type { EstimateConvertPayload, EstimateDetailProps } from './estimate-detail';
export { EstimateForm } from './estimate-form';
export type { EstimateFormProps } from './estimate-form';

export { CreditNoteList } from './credit-note-list';
export type { CreditNoteListProps } from './credit-note-list';
export { CreditNoteDetail } from './credit-note-detail';
export type { CreditNoteDetailProps } from './credit-note-detail';
export { CreditNoteForm } from './credit-note-form';
export type { CreditNoteFormProps } from './credit-note-form';

export { BillList } from './bill-list';
export type { BillListProps } from './bill-list';
export { BillDetail } from './bill-detail';
export type { BillDetailProps } from './bill-detail';
export { BillForm } from './bill-form';
export type { BillFormProps, ClientOption, ExpenseAccountOption, ProjectOption } from './bill-form';

export { ReceiptList } from './receipt-list';
export type { ReceiptListProps } from './receipt-list';
export { ReceiptDetail } from './receipt-detail';
export type { ReceiptDetailProps } from './receipt-detail';
export { ReceiptForm } from './receipt-form';
export type { BankAccountOption, OpenInvoiceForAllocation, ReceiptFormProps } from './receipt-form';

export { ArAgingTable } from './ar-aging-table';
export type { ArAgingTableProps } from './ar-aging-table';

export { KpiCards } from './kpi-cards';
export type { KpiCardsProps } from './kpi-cards';

export { ServiceItemsTable } from './service-items-table';
export type { ServiceItemsTableProps } from './service-items-table';

export { BillingActivityFeed } from './billing-activity-feed';
export type { BillingActivityFeedProps, BillingActivityItem } from './billing-activity-feed';

export { ReferenceRatePill } from './reference-rate-pill';
export type { ReferenceRatePillProps } from './reference-rate-pill';

export type {
  AgingBucketMode,
  ArAgingRow,
  BaseListProps,
  Bill,
  BillAttribution,
  BillBulkAction,
  BillFilters,
  BillLine,
  BillState,
  BillingActivityKind,
  BillingKpi,
  BillingKpiId,
  CapturedTaxSplit,
  CreditNote,
  CreditNoteBulkAction,
  CreditNoteFilters,
  CreditNoteLine,
  CreditNoteReason,
  CreditNoteState,
  EntityRefData,
  Estimate,
  EstimateBulkAction,
  EstimateFilters,
  EstimateLine,
  EstimateState,
  Invoice,
  InvoiceBulkAction,
  InvoiceFilters,
  InvoiceLine,
  InvoiceState,
  IsoDate,
  IsoTimestamp,
  PaginationState,
  Paise,
  PlaceOfSupplyKind,
  Receipt,
  ReceiptAllocation,
  ReceiptBulkAction,
  ReceiptFilters,
  ReceiptMethod,
  ReceiptState,
  ReferenceRate,
  ServiceItem,
  SortingState,
  StateCode,
  TdsSection,
  ValidationFlag,
} from './types';

export type { NavigationTarget } from '@/components/entity/types';
