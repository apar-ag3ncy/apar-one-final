import 'server-only';

import { Font } from '@react-pdf/renderer';

import { RUBIK_400_ITALIC, RUBIK_400_NORMAL, RUBIK_700_NORMAL } from './rubik-data';
import { INTER_400_NORMAL, INTER_700_NORMAL } from './inter-data';
import { LATO_400_NORMAL, LATO_700_NORMAL } from './lato-data';

/**
 * react-pdf ships only the 14 PDF-standard fonts (Helvetica, Times, Courier).
 * Any other face has to be registered from a real font file. We register from
 * base64 data-URIs (held in the *-data.ts siblings) so the fonts are part of
 * the JS bundle and need no filesystem/network access at render time.
 *
 *   - Rubik      — the brand typeface; default for invoices.
 *   - Inter      — the app-wide UI face (the open, embeddable stand-in for
 *                  Apple's San Francisco); used by every NON-invoice PDF.
 *   - Lato       — an extra selectable invoice font.
 *
 * (Open Sans was evaluated but omitted — it has no ₹ / rupee glyph.)
 *
 * Registration is idempotent and runs once on first import; every PDF module
 * imports a family constant from here, which pulls this side effect in before
 * `renderToBuffer` runs. Each family carries subset 400 + 700 weights (Rubik
 * also 400-italic).
 */
export const PDF_FONT_FAMILY = 'Rubik';
export const INTER_FONT_FAMILY = 'Inter';

/**
 * Embedded families offered to the invoice theme picker, on top of the
 * react-pdf built-ins (Helvetica / Times-Roman / Courier).
 */
export const EMBEDDED_INVOICE_FONTS = ['Rubik', 'Inter', 'Lato'] as const;

const dataUri = (b64: string) => `data:font/truetype;base64,${b64}`;

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: 'Rubik',
    fonts: [
      { src: dataUri(RUBIK_400_NORMAL), fontWeight: 400 },
      { src: dataUri(RUBIK_700_NORMAL), fontWeight: 700 },
      { src: dataUri(RUBIK_400_ITALIC), fontWeight: 400, fontStyle: 'italic' },
    ],
  });
  Font.register({
    family: 'Inter',
    fonts: [
      { src: dataUri(INTER_400_NORMAL), fontWeight: 400 },
      { src: dataUri(INTER_700_NORMAL), fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'Lato',
    fonts: [
      { src: dataUri(LATO_400_NORMAL), fontWeight: 400 },
      { src: dataUri(LATO_700_NORMAL), fontWeight: 700 },
    ],
  });
}

// Register eagerly so importing any family constant is enough to make the
// faces available — callers don't have to remember to call registerPdfFonts().
registerPdfFonts();
