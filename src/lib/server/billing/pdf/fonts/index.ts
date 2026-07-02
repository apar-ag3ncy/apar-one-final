import 'server-only';

import { Font } from '@react-pdf/renderer';

import { RUBIK_400_ITALIC, RUBIK_400_NORMAL, RUBIK_700_NORMAL } from './rubik-data';

/**
 * Rubik is the brand typeface for every generated billing document (invoice,
 * payment receipt, credit note, and the payment/receipt/refund vouchers).
 *
 * react-pdf ships only the 14 PDF-standard fonts (Helvetica, Times, Courier).
 * A custom face has to be registered from a real font file. We register from
 * base64 data-URIs held in `./rubik-data` so the font is part of the JS bundle
 * and needs no filesystem access at render time — the same self-contained
 * approach the company logo uses. Registration is idempotent and runs once on
 * first import; every PDF module imports `PDF_FONT_FAMILY` from here, which
 * pulls this side effect in before `renderToBuffer` runs.
 */
export const PDF_FONT_FAMILY = 'Rubik';

const dataUri = (b64: string) => `data:font/truetype;base64,${b64}`;

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: dataUri(RUBIK_400_NORMAL), fontWeight: 400 },
      { src: dataUri(RUBIK_700_NORMAL), fontWeight: 700 },
      { src: dataUri(RUBIK_400_ITALIC), fontWeight: 400, fontStyle: 'italic' },
    ],
  });
}

// Register eagerly so importing `PDF_FONT_FAMILY` is enough to make the face
// available — callers don't have to remember to invoke `registerPdfFonts()`.
registerPdfFonts();
