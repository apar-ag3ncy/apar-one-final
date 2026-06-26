/**
 * Invoice STYLE tokens — the visual "power" knobs a custom format exposes on
 * top of the block layout: font size, density, logo size/alignment, and a few
 * polish toggles (accent title band, emphasised grand total, coloured section
 * headings). Stored alongside the layout in `invoice_themes.tokens.style` and
 * read back by the PDF renderer. Plain TS (client + server safe), like
 * `@/lib/billing/invoice-layout`.
 */

export type InvoiceDensity = 'compact' | 'normal' | 'relaxed';
export type InvoiceLogoSize = 'sm' | 'md' | 'lg';
export type InvoiceLogoAlign = 'left' | 'center' | 'right';

/** Which optional line-item table columns are shown (Description + Amount are
 *  always shown). */
export type InvoiceColumns = {
  srNo: boolean;
  hsn: boolean;
  /** Separate Quantity + Rate-per-unit columns. */
  qtyRate: boolean;
  /** Per-line GST rate column (e.g. "18%"). */
  taxPct: boolean;
};

/** Per-element colour overrides. `null` → derive from primary/accent. Hex. */
export type InvoiceColors = {
  tableHeaderBg: string | null;
  tableHeaderText: string | null;
  totalBg: string | null;
  totalText: string | null;
  heading: string | null;
  title: string | null;
};

/** Page margins, in millimetres. */
export type InvoiceMargins = { top: number; right: number; bottom: number; left: number };

export type InvoiceStyle = {
  /** Base font multiplier (0.85–1.25). 1 = the classic 9pt body. */
  fontScale: number;
  /** Page + block spacing. */
  density: InvoiceDensity;
  /** Logo footprint. */
  logoSize: InvoiceLogoSize;
  /** Logo alignment within its column/block. */
  logoAlign: InvoiceLogoAlign;
  /** Draw a brand-accent band behind the document title. */
  accentHeaderBand: boolean;
  /** Fill the grand-total row with the accent colour + larger type. */
  emphasizeTotal: boolean;
  /** Tint section headings (Terms, Notes, Payment details…) with the brand colour. */
  colorHeadings: boolean;
  /** Configurable line-item columns. */
  columns: InvoiceColumns;
  /** Per-element colour overrides. */
  colors: InvoiceColors;
  /** Page margins in millimetres. */
  margins: InvoiceMargins;
};

export const DEFAULT_INVOICE_COLUMNS: InvoiceColumns = {
  srNo: true,
  hsn: true,
  qtyRate: false,
  taxPct: false,
};

export const DEFAULT_INVOICE_COLORS: InvoiceColors = {
  tableHeaderBg: null,
  tableHeaderText: null,
  totalBg: null,
  totalText: null,
  heading: null,
  title: null,
};

/** ≈ the classic 38/40/60/40-pt page padding, in millimetres. */
export const DEFAULT_INVOICE_MARGINS: InvoiceMargins = { top: 14, right: 14, bottom: 18, left: 14 };

export const MARGIN_MIN_MM = 5;
export const MARGIN_MAX_MM = 40;
/** Millimetres → PDF points (1mm = 72/25.4 pt). */
export const MM_TO_PT = 72 / 25.4;

export const DEFAULT_INVOICE_STYLE: InvoiceStyle = {
  fontScale: 1,
  density: 'normal',
  logoSize: 'md',
  logoAlign: 'right',
  accentHeaderBand: false,
  emphasizeTotal: true,
  colorHeadings: true,
  columns: DEFAULT_INVOICE_COLUMNS,
  colors: DEFAULT_INVOICE_COLORS,
  margins: DEFAULT_INVOICE_MARGINS,
};

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.25;

const DENSITIES: readonly InvoiceDensity[] = ['compact', 'normal', 'relaxed'];
const LOGO_SIZES: readonly InvoiceLogoSize[] = ['sm', 'md', 'lg'];
const LOGO_ALIGNS: readonly InvoiceLogoAlign[] = ['left', 'center', 'right'];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** A 6-digit hex colour, or null. */
function hexOrNull(v: unknown): string | null {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim().toUpperCase() : null;
}

/** Coerce any persisted/JSON value into a complete, valid `InvoiceStyle`. */
export function sanitizeInvoiceStyle(raw: unknown): InvoiceStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cols = (r.columns && typeof r.columns === 'object' ? r.columns : {}) as Record<
    string,
    unknown
  >;
  const cl = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>;
  const mg = (r.margins && typeof r.margins === 'object' ? r.margins : {}) as Record<
    string,
    unknown
  >;
  const mm = (v: unknown, fallback: number): number =>
    Math.round(clampNum(v, MARGIN_MIN_MM, MARGIN_MAX_MM, fallback));
  return {
    fontScale: Math.round(clampNum(r.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, 1) * 100) / 100,
    density: oneOf(r.density, DENSITIES, 'normal'),
    logoSize: oneOf(r.logoSize, LOGO_SIZES, 'md'),
    logoAlign: oneOf(r.logoAlign, LOGO_ALIGNS, 'right'),
    accentHeaderBand: bool(r.accentHeaderBand, false),
    emphasizeTotal: bool(r.emphasizeTotal, true),
    colorHeadings: bool(r.colorHeadings, true),
    columns: {
      srNo: bool(cols.srNo, true),
      hsn: bool(cols.hsn, true),
      qtyRate: bool(cols.qtyRate, false),
      taxPct: bool(cols.taxPct, false),
    },
    colors: {
      tableHeaderBg: hexOrNull(cl.tableHeaderBg),
      tableHeaderText: hexOrNull(cl.tableHeaderText),
      totalBg: hexOrNull(cl.totalBg),
      totalText: hexOrNull(cl.totalText),
      heading: hexOrNull(cl.heading),
      title: hexOrNull(cl.title),
    },
    margins: {
      top: mm(mg.top, DEFAULT_INVOICE_MARGINS.top),
      right: mm(mg.right, DEFAULT_INVOICE_MARGINS.right),
      bottom: mm(mg.bottom, DEFAULT_INVOICE_MARGINS.bottom),
      left: mm(mg.left, DEFAULT_INVOICE_MARGINS.left),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Line-item table columns                                                    */
/* -------------------------------------------------------------------------- */

export type TableColKey = 'srNo' | 'description' | 'hsn' | 'qty' | 'rate' | 'taxPct' | 'amount';

export type TableCol = { key: TableColKey; label: string; width: number; align: 'left' | 'right' };

// Fixed widths (in %) for every non-description column; Description flexes to
// fill whatever's left so the row always sums to 100%.
const COL_FIXED_WIDTH: Record<Exclude<TableColKey, 'description'>, number> = {
  srNo: 7,
  hsn: 13,
  qty: 8,
  rate: 15,
  taxPct: 10,
  amount: 20,
};

/** Ordered, sized columns for the line-items table given the style config. */
export function invoiceTableColumns(style: InvoiceStyle): TableCol[] {
  const c = style.columns;
  const out: TableCol[] = [];
  if (c.srNo)
    out.push({ key: 'srNo', label: 'Sr. No.', width: COL_FIXED_WIDTH.srNo, align: 'left' });
  out.push({ key: 'description', label: 'Description', width: 0, align: 'left' });
  if (c.hsn) out.push({ key: 'hsn', label: 'HSN/SAC', width: COL_FIXED_WIDTH.hsn, align: 'left' });
  if (c.qtyRate) {
    out.push({ key: 'qty', label: 'Qty', width: COL_FIXED_WIDTH.qty, align: 'right' });
    out.push({ key: 'rate', label: 'Rate', width: COL_FIXED_WIDTH.rate, align: 'right' });
  }
  if (c.taxPct)
    out.push({ key: 'taxPct', label: 'Tax %', width: COL_FIXED_WIDTH.taxPct, align: 'right' });
  out.push({ key: 'amount', label: 'Amount (INR)', width: COL_FIXED_WIDTH.amount, align: 'right' });

  const fixed = out.reduce((s, col) => s + col.width, 0);
  const desc = out.find((col) => col.key === 'description');
  if (desc) desc.width = Math.max(20, 100 - fixed);
  return out;
}

/** The width (%) of the Amount column — summary rows align their value to it. */
export const AMOUNT_COL_WIDTH = COL_FIXED_WIDTH.amount;

/** Black or white text, whichever reads better on the given hex background. */
export function readableTextOn(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#111111';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111111' : '#FFFFFF';
}

/**
 * Resolve the style tokens into concrete PDF metrics (point sizes + spacing)
 * the renderer applies inline. Centralised so the renderer and the live HTML
 * preview can stay in visual sync.
 */
export type InvoiceMetrics = {
  fontSize: number;
  titleSize: number;
  supplierNameSize: number;
  recipientNameSize: number;
  totalSize: number;
  /** Page padding (= margins) in points. */
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
  blockGap: number;
  logoHeight: number;
  logoMaxWidth: number;
};

export function metricsFor(style: InvoiceStyle): InvoiceMetrics {
  const s = style.fontScale;
  // Density now only governs inter-block spacing; the page margins are explicit.
  const gap = style.density === 'compact' ? 8 : style.density === 'relaxed' ? 18 : 12;
  const logo =
    style.logoSize === 'sm'
      ? { h: 24, w: 120 }
      : style.logoSize === 'lg'
        ? { h: 52, w: 220 }
        : { h: 36, w: 165 };
  const m = style.margins;
  return {
    fontSize: Math.round(9 * s * 10) / 10,
    titleSize: Math.round(13 * s * 10) / 10,
    supplierNameSize: Math.round(12 * s * 10) / 10,
    recipientNameSize: Math.round(11 * s * 10) / 10,
    totalSize: Math.round(11 * s * 10) / 10,
    padTop: Math.round(m.top * MM_TO_PT),
    padRight: Math.round(m.right * MM_TO_PT),
    padBottom: Math.round(m.bottom * MM_TO_PT),
    padLeft: Math.round(m.left * MM_TO_PT),
    blockGap: gap,
    logoHeight: logo.h,
    logoMaxWidth: logo.w,
  };
}
