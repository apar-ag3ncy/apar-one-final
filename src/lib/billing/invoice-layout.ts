/**
 * Invoice layout model — where each invoice "block" sits on the page.
 *
 * A custom invoice format stores this under `invoice_themes.tokens.layout`; the
 * PDF renderer (`pdf/invoice.tsx`) reads it back to place blocks. Plain TS (no
 * `server-only` / `use server`) so both the client-side layout editor and the
 * server renderer can import it — mirrors `@/lib/billing/invoice-fonts`.
 *
 * The GST line-items + tax-summary table is deliberately NOT a block: it is
 * always rendered, fixed, between `aboveTable` and `belowTable`, so the invoice
 * stays Rule-46 compliant and multi-page-safe whatever the layout says.
 */

export type InvoiceBlockId =
  | 'logo'
  | 'supplier'
  | 'meta'
  | 'billTo'
  | 'amountWords'
  | 'terms'
  | 'notes'
  | 'payment'
  | 'paymentLink'
  | 'signatory';

export type InvoiceLayoutContainer =
  | 'headerLeft'
  | 'headerRight'
  | 'aboveTable'
  | 'belowTable'
  | 'hidden';

export type InvoiceLayout = {
  version: 1;
  header: { left: InvoiceBlockId[]; right: InvoiceBlockId[] };
  /** Blocks between the header rule and the line-items table. */
  aboveTable: InvoiceBlockId[];
  /** Blocks after the line-items table. */
  belowTable: InvoiceBlockId[];
  /** Blocks placed nowhere → not rendered. */
  hidden: InvoiceBlockId[];
  /** Logo alignment within its block; defaults to its column when unset. */
  logoAlign?: 'left' | 'center' | 'right';
};

export const INVOICE_BLOCK_IDS: readonly InvoiceBlockId[] = [
  'logo',
  'supplier',
  'meta',
  'billTo',
  'amountWords',
  'terms',
  'notes',
  'payment',
  'paymentLink',
  'signatory',
];

export const INVOICE_LAYOUT_CONTAINERS: readonly InvoiceLayoutContainer[] = [
  'headerLeft',
  'headerRight',
  'aboveTable',
  'belowTable',
  'hidden',
];

/** Human labels for the editor chips + the live preview. */
export const BLOCK_LABELS: Record<InvoiceBlockId, string> = {
  logo: 'Logo',
  supplier: 'Company details',
  meta: 'Invoice details',
  billTo: 'Bill-To (client)',
  amountWords: 'Amount in words',
  terms: 'Terms',
  notes: 'Notes',
  payment: 'Bank / payment details',
  paymentLink: 'Pay-online link',
  signatory: 'Signature',
};

/**
 * Which containers each block may live in (the Hidden tray accepts everything).
 * Header-only blocks (logo/supplier/meta) can't drop into the body; body blocks
 * can't drop into the header; `billTo` is the single cross-region block, so the
 * client address can sit in the header or above/below the table.
 */
export const ALLOWED_CONTAINERS: Record<InvoiceBlockId, InvoiceLayoutContainer[]> = {
  logo: ['headerLeft', 'headerRight', 'hidden'],
  supplier: ['headerLeft', 'headerRight', 'hidden'],
  meta: ['headerLeft', 'headerRight', 'hidden'],
  billTo: ['headerLeft', 'headerRight', 'aboveTable', 'belowTable', 'hidden'],
  amountWords: ['aboveTable', 'belowTable', 'hidden'],
  terms: ['aboveTable', 'belowTable', 'hidden'],
  notes: ['aboveTable', 'belowTable', 'hidden'],
  payment: ['aboveTable', 'belowTable', 'hidden'],
  paymentLink: ['aboveTable', 'belowTable', 'hidden'],
  signatory: ['aboveTable', 'belowTable', 'hidden'],
};

/** Where a block lands when it's absent from (or illegal in) a saved layout. */
export const DEFAULT_CONTAINER: Record<InvoiceBlockId, InvoiceLayoutContainer> = {
  logo: 'headerRight',
  supplier: 'headerLeft',
  meta: 'headerRight',
  billTo: 'aboveTable',
  amountWords: 'belowTable',
  terms: 'belowTable',
  notes: 'belowTable',
  payment: 'belowTable',
  paymentLink: 'belowTable',
  signatory: 'belowTable',
};

/** Reproduces the historical (pre-layout) invoice exactly. */
export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = {
  version: 1,
  header: { left: ['supplier'], right: ['logo', 'meta'] },
  aboveTable: ['billTo'],
  belowTable: ['amountWords', 'terms', 'notes', 'payment', 'paymentLink', 'signatory'],
  hidden: [],
};

export function canPlaceBlock(id: InvoiceBlockId, container: InvoiceLayoutContainer): boolean {
  return ALLOWED_CONTAINERS[id].includes(container);
}

function isBlockId(v: unknown): v is InvoiceBlockId {
  return typeof v === 'string' && (INVOICE_BLOCK_IDS as readonly string[]).includes(v);
}

/**
 * Coerce any persisted/JSON value into a valid, complete `InvoiceLayout`.
 *
 * The robustness keystone — run on BOTH save and load. It drops unknown ids,
 * dedupes, forces every block into an allowed container, and appends any block
 * missing from the saved layout to its default spot. The renderer therefore
 * always receives every known block exactly once, and a block added to the code
 * later inherits a sensible default position on previously-saved layouts.
 */
export function sanitizeInvoiceLayout(raw: unknown): InvoiceLayout {
  const out: Record<InvoiceLayoutContainer, InvoiceBlockId[]> = {
    headerLeft: [],
    headerRight: [],
    aboveTable: [],
    belowTable: [],
    hidden: [],
  };
  const placed = new Set<InvoiceBlockId>();

  const ingest = (container: InvoiceLayoutContainer, list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const v of list) {
      if (!isBlockId(v) || placed.has(v)) continue;
      const target = canPlaceBlock(v, container) ? container : DEFAULT_CONTAINER[v];
      out[target].push(v);
      placed.add(v);
    }
  };

  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const header = (r.header && typeof r.header === 'object' ? r.header : {}) as Record<
    string,
    unknown
  >;
  ingest('headerLeft', header.left);
  ingest('headerRight', header.right);
  ingest('aboveTable', r.aboveTable);
  ingest('belowTable', r.belowTable);
  ingest('hidden', r.hidden);

  // Anything not present in the saved layout falls back to its default container.
  for (const id of INVOICE_BLOCK_IDS) {
    if (!placed.has(id)) {
      out[DEFAULT_CONTAINER[id]].push(id);
      placed.add(id);
    }
  }

  const align = r.logoAlign;
  const logoAlign = align === 'left' || align === 'center' || align === 'right' ? align : undefined;

  return {
    version: 1,
    header: { left: out.headerLeft, right: out.headerRight },
    aboveTable: out.aboveTable,
    belowTable: out.belowTable,
    hidden: out.hidden,
    ...(logoAlign ? { logoAlign } : {}),
  };
}
