import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { extractDocxTheme, mapToBuiltinFont } from './extract-docx';

// 1×1 transparent PNG.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const THEME1_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Brand">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="C00000"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
    </a:clrScheme>
    <a:fontScheme name="Brand">
      <a:majorFont><a:latin typeface="Cambria"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

async function buildDocx(opts: { theme?: boolean; image?: boolean } = {}): Promise<Uint8Array> {
  const { theme = true, image = true } = opts;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`,
  );
  if (theme) zip.file('word/theme/theme1.xml', THEME1_XML);
  if (image) zip.file('word/media/image1.png', PNG_1x1);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('extractDocxTheme', () => {
  it('pulls colours, the mapped font, and the first logo from a themed docx', async () => {
    const bytes = await buildDocx();
    const theme = await extractDocxTheme(bytes);

    expect(theme.primaryColor).toBe('#c00000'); // accent1
    expect(theme.secondaryColor).toBe('#ed7d31'); // accent2
    expect(theme.accentColor).toBe('#a5a5a5'); // accent3
    expect(theme.rawFontName).toBe('Cambria');
    expect(theme.fontFamily).toBe('Times-Roman'); // Cambria → serif builtin
    expect(theme.logo?.contentType).toBe('image/png');
    expect(theme.logo?.ext).toBe('png');
    expect(theme.logo?.bytes.byteLength ?? 0).toBeGreaterThan(0);
    expect(theme.tokens.clrScheme).toBeTruthy();
  });

  it('returns a valid empty-ish theme when there is no theme part or media', async () => {
    const bytes = await buildDocx({ theme: false, image: false });
    const theme = await extractDocxTheme(bytes);
    expect(theme.primaryColor).toBeUndefined();
    expect(theme.fontFamily).toBeUndefined();
    expect(theme.logo).toBeUndefined();
    expect(theme.tokens).toEqual({});
  });

  it('never throws on garbage bytes', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const theme = await extractDocxTheme(garbage);
    expect(theme).toEqual({ tokens: {} });
  });
});

describe('mapToBuiltinFont', () => {
  it('maps serif/mono/sans onto react-pdf built-in families', () => {
    expect(mapToBuiltinFont(undefined)).toBe('Helvetica');
    expect(mapToBuiltinFont('Calibri Light')).toBe('Helvetica');
    expect(mapToBuiltinFont('Times New Roman')).toBe('Times-Roman');
    expect(mapToBuiltinFont('Cambria')).toBe('Times-Roman');
    expect(mapToBuiltinFont('Courier New')).toBe('Courier');
    expect(mapToBuiltinFont('Consolas')).toBe('Courier');
  });
});
