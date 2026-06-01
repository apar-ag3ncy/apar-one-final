// TODO(backend): replace with Zod-schema-derived types from `@/types/vendor` once Backend
// ships them (P1.13). Frontend stand-ins until then.

export type VendorStatus = 'active' | 'inactive';
export type VendorCategory =
  | 'photographer'
  | 'videographer'
  | 'printer'
  | 'software'
  | 'agency'
  | 'logistics'
  | 'other';

export type TdsSection = '194C' | '194J' | '194H' | '194I' | '194Q' | '194O' | 'none';

export type Vendor = {
  id: string;
  name: string;
  category: VendorCategory;
  status: VendorStatus;
  gstin: string | null;
  pan: string | null;
  tdsSection: TdsSection;
  contactName: string | null;
  contactPhone: string | null;
  city: string;
  outstandingPaise: bigint;
  lastTxnAt: Date | null;
  documentsCount: number;
  contractsCount: number;
  notes: string | null;
};
