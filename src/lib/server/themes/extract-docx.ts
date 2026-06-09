import JSZip from 'jszip';

/**
 * DOCX → invoice-theme token extraction.
 *
 * A `.docx` is a ZIP of XML. We do NOT reproduce the Word layout — the
 * invoice PDF is rendered by `@react-pdf/renderer`. Instead we pull a few
 * brand tokens out of the uploaded file and overlay them onto the existing
 * invoice template:
 *
 *   - theme colours from `word/theme/theme1.xml` (`<a:clrScheme>`): the
 *     first accent becomes `primaryColor`, etc.
 *   - the major font (`<a:fontScheme>` → `<a:majorFont>` → `<a:latin>`),
 *     mapped to a react-pdf built-in family (arbitrary fonts can't render
 *     without bundling a `.ttf`).
 *   - the first embedded raster image under `word/media/` as a logo.
 *
 * Pure and best-effort: it NEVER throws. On any parse failure it returns an
 * empty-but-valid result so a bad upload can't break theme creation or PDF
 * rendering.
 */

export type ExtractedLogo = {
  bytes: Uint8Array;
  /** MIME type, e.g. `image/png`. Only react-pdf-renderable rasters. */
  contentType: string;
  /** File extension without the dot, e.g. `png`. */
  ext: string;
};

export type ExtractedDocxTheme = {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  /** A react-pdf built-in family: Helvetica | Times-Roman | Courier. */
  fontFamily?: string;
  /** The original typeface name from the docx, before mapping. */
  rawFontName?: string;
  logo?: ExtractedLogo;
  /** Forward-compatible bag of everything we pulled (for persistence). */
  tokens: Record<string, unknown>;
};

/** react-pdf raster `<Image>` only handles PNG and JPEG. */
const RENDERABLE_IMAGE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const SERIF_HINTS = [
  'times',
  'georgia',
  'garamond',
  'cambria',
  'book antiqua',
  'palatino',
  'minion',
  'merriweather',
  'serif',
];
const MONO_HINTS = ['courier', 'consolas', 'menlo', 'monaco', 'mono'];

/** Map an arbitrary typeface name onto a react-pdf built-in family. */
export function mapToBuiltinFont(name: string | undefined): string {
  if (!name) return 'Helvetica';
  const n = name.toLowerCase();
  if (MONO_HINTS.some((h) => n.includes(h))) return 'Courier';
  if (SERIF_HINTS.some((h) => n.includes(h))) return 'Times-Roman';
  return 'Helvetica';
}

/** Pull a hex colour (`#rrggbb`) for one named clrScheme slot. */
function colorFromScheme(xml: string, slot: string): string | undefined {
  const block = new RegExp(`<a:${slot}\\b[^>]*>([\\s\\S]*?)</a:${slot}>`).exec(xml)?.[1];
  if (!block) return undefined;
  const srgb = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
  if (srgb) return `#${srgb.toLowerCase()}`;
  const sys = /<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
  if (sys) return `#${sys.toLowerCase()}`;
  return undefined;
}

export async function extractDocxTheme(
  input: Uint8Array | ArrayBuffer | Buffer,
): Promise<ExtractedDocxTheme> {
  const result: ExtractedDocxTheme = { tokens: {} };
  try {
    const zip = await JSZip.loadAsync(input as ArrayBuffer);

    // --- colours + font from the theme part -------------------------------
    const themeXml = await zip.file('word/theme/theme1.xml')?.async('string');
    if (themeXml) {
      const scheme: Record<string, string> = {};
      for (const slot of [
        'dk1',
        'lt1',
        'dk2',
        'lt2',
        'accent1',
        'accent2',
        'accent3',
        'accent4',
        'accent5',
        'accent6',
        'hlink',
      ]) {
        const c = colorFromScheme(themeXml, slot);
        if (c) scheme[slot] = c;
      }
      // accent1 is the conventional brand colour; fall back through text-2.
      result.primaryColor = scheme.accent1 ?? scheme.dk2 ?? scheme.dk1;
      result.secondaryColor = scheme.accent2 ?? scheme.dk2;
      result.accentColor = scheme.accent3 ?? scheme.accent2 ?? scheme.accent1;
      if (Object.keys(scheme).length > 0) result.tokens.clrScheme = scheme;

      const major = /<a:majorFont>[\s\S]*?<a:latin\s+typeface="([^"]*)"/.exec(themeXml)?.[1];
      if (major) {
        result.rawFontName = major;
        result.fontFamily = mapToBuiltinFont(major);
        result.tokens.rawFontName = major;
      }
    }

    // --- first renderable embedded image as the logo ----------------------
    const mediaNames = Object.keys(zip.files)
      .filter((n) => /^word\/media\//i.test(n) && !zip.files[n]?.dir)
      .sort();
    for (const name of mediaNames) {
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const contentType = RENDERABLE_IMAGE[ext];
      if (!contentType) continue; // skip emf/wmf/svg etc. react-pdf can't raster them
      const file = zip.file(name);
      if (!file) continue;
      const bytes = await file.async('uint8array');
      if (bytes.byteLength === 0) continue;
      result.logo = { bytes, contentType, ext: ext === 'jpeg' ? 'jpg' : ext };
      result.tokens.logoSource = name;
      break;
    }
  } catch {
    // Best-effort: a corrupt / non-docx upload yields an empty theme rather
    // than an error. The caller still stores the file; the look just falls
    // back to template defaults.
    return { tokens: {} };
  }
  return result;
}
