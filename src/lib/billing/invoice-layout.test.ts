import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INVOICE_LAYOUT,
  INVOICE_BLOCK_IDS,
  sanitizeInvoiceLayout,
  type InvoiceBlockId,
} from './invoice-layout';

/** Flatten every container into one list, to assert completeness/uniqueness. */
function allBlocks(l: ReturnType<typeof sanitizeInvoiceLayout>): InvoiceBlockId[] {
  return [...l.header.left, ...l.header.right, ...l.aboveTable, ...l.belowTable, ...l.hidden];
}

describe('sanitizeInvoiceLayout', () => {
  it('returns the classic default for empty/garbage input', () => {
    expect(sanitizeInvoiceLayout(undefined)).toEqual(DEFAULT_INVOICE_LAYOUT);
    expect(sanitizeInvoiceLayout(null)).toEqual(DEFAULT_INVOICE_LAYOUT);
    expect(sanitizeInvoiceLayout('nonsense')).toEqual(DEFAULT_INVOICE_LAYOUT);
    expect(sanitizeInvoiceLayout({ header: 'oops' })).toEqual(DEFAULT_INVOICE_LAYOUT);
  });

  it('always places every known block exactly once', () => {
    const out = sanitizeInvoiceLayout({ belowTable: ['signatory'] });
    const blocks = allBlocks(out);
    expect(blocks.length).toBe(INVOICE_BLOCK_IDS.length);
    expect(new Set(blocks).size).toBe(INVOICE_BLOCK_IDS.length);
    for (const id of INVOICE_BLOCK_IDS) expect(blocks).toContain(id);
  });

  it('drops unknown ids and dedupes', () => {
    const out = sanitizeInvoiceLayout({
      header: { left: ['supplier', 'supplier', 'bogus'], right: [] },
    });
    expect(out.header.left.filter((b) => b === 'supplier')).toHaveLength(1);
    expect(allBlocks(out)).not.toContain('bogus' as InvoiceBlockId);
  });

  it('moves a block out of a container it is not allowed in', () => {
    // signatory may only live below/above the table or hidden — never the header.
    const out = sanitizeInvoiceLayout({ header: { left: ['signatory'], right: [] } });
    expect(out.header.left).not.toContain('signatory');
    expect(out.belowTable).toContain('signatory'); // its default container
  });

  it('lets billTo move into the header (the one cross-region block)', () => {
    const out = sanitizeInvoiceLayout({ header: { left: ['billTo'], right: [] } });
    expect(out.header.left).toContain('billTo');
    expect(out.aboveTable).not.toContain('billTo');
  });

  it('keeps a valid logoAlign and drops an invalid one', () => {
    expect(sanitizeInvoiceLayout({ logoAlign: 'center' }).logoAlign).toBe('center');
    expect(sanitizeInvoiceLayout({ logoAlign: 'sideways' }).logoAlign).toBeUndefined();
  });
});
