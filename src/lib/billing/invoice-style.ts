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
};

export const DEFAULT_INVOICE_STYLE: InvoiceStyle = {
  fontScale: 1,
  density: 'normal',
  logoSize: 'md',
  logoAlign: 'right',
  accentHeaderBand: false,
  emphasizeTotal: true,
  colorHeadings: true,
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

/** Coerce any persisted/JSON value into a complete, valid `InvoiceStyle`. */
export function sanitizeInvoiceStyle(raw: unknown): InvoiceStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    fontScale: Math.round(clampNum(r.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, 1) * 100) / 100,
    density: oneOf(r.density, DENSITIES, 'normal'),
    logoSize: oneOf(r.logoSize, LOGO_SIZES, 'md'),
    logoAlign: oneOf(r.logoAlign, LOGO_ALIGNS, 'right'),
    accentHeaderBand: bool(r.accentHeaderBand, false),
    emphasizeTotal: bool(r.emphasizeTotal, true),
    colorHeadings: bool(r.colorHeadings, true),
  };
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
  pagePadTop: number;
  pagePadX: number;
  pagePadBottom: number;
  blockGap: number;
  logoHeight: number;
  logoMaxWidth: number;
};

export function metricsFor(style: InvoiceStyle): InvoiceMetrics {
  const s = style.fontScale;
  const dens =
    style.density === 'compact'
      ? { padTop: 30, padX: 34, padBottom: 50, gap: 8 }
      : style.density === 'relaxed'
        ? { padTop: 46, padX: 50, padBottom: 70, gap: 18 }
        : { padTop: 38, padX: 40, padBottom: 60, gap: 12 };
  const logo =
    style.logoSize === 'sm'
      ? { h: 24, w: 120 }
      : style.logoSize === 'lg'
        ? { h: 52, w: 220 }
        : { h: 36, w: 165 };
  return {
    fontSize: Math.round(9 * s * 10) / 10,
    titleSize: Math.round(13 * s * 10) / 10,
    supplierNameSize: Math.round(12 * s * 10) / 10,
    recipientNameSize: Math.round(11 * s * 10) / 10,
    totalSize: Math.round(11 * s * 10) / 10,
    pagePadTop: dens.padTop,
    pagePadX: dens.padX,
    pagePadBottom: dens.padBottom,
    blockGap: dens.gap,
    logoHeight: logo.h,
    logoMaxWidth: logo.w,
  };
}
