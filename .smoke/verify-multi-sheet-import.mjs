// Verify PR: Office Excel import asks which sheets to import and combines the
// selected ones. Generates a real 3-sheet workbook (2 importable, 1 invalid),
// uploads it, and exercises the picker + combined preview WITHOUT committing
// (no prod rows created).
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT =
  '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
const TMP =
  '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad';
fs.mkdirSync(OUT, { recursive: true });

// --- build a 3-sheet workbook -------------------------------------------------
const header = ['Date', 'Name', 'Total', 'Category', 'Payment Mode'];
const jan = [
  header,
  ['05.01.26', 'SMOKE Jan pens', '₹100', 'Stationery', 'Cash'],
  ['06.01.26', 'SMOKE Jan chair', '₹5000', 'Asset', 'Bank'],
];
const feb = [header, ['10.02.26', 'SMOKE Feb coffee', '₹250', 'Pantry', 'Cash']];
const summary = [['Summary'], ['nothing to import here']]; // no Name/Total → skipped
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jan), 'January');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(feb), 'February');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
const filePath = path.join(TMP, 'smoke-multi-sheet.xlsx');
XLSX.writeFile(wb, filePath);

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1560, height: 940 } })).newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const results = [];
const report = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

async function cmdk(text) {
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
}

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Office → Expenses → Import
  await cmdk('Open Office');
  await page
    .getByRole('button', { name: /Expenses/ })
    .first()
    .click();
  await page.waitForTimeout(3500);
  const ow = page.locator('.window').last();
  await ow
    .getByRole('button', { name: /Import/ })
    .first()
    .click();
  await page.waitForTimeout(1000);
  const modal = page.locator('.os-modal').last();

  // upload the workbook
  await modal.locator('input[type="file"]').setInputFiles(filePath);
  await page.waitForTimeout(2500);
  const mText = () => modal.textContent().then((t) => t ?? '');

  // 1) picker appears with both data sheets + the invalid one
  const t1 = await mText();
  report('sheet picker shown', /Which sheets should be imported/.test(t1));
  report(
    'lists January / February / Summary',
    /January/.test(t1) && /February/.test(t1) && /Summary/.test(t1),
    t1.slice(0, 160),
  );
  report('per-sheet row counts (2 rows / 1 row)', /2 rows/.test(t1) && /1 row(?![a-z])/.test(t1));
  report("invalid sheet flagged can't import", /can’t import|no “Name”/.test(t1));
  await shot('ms-01-picker');

  // 2) combined preview = 3 rows from 2 sheets by default
  report(
    'combined preview = 3 rows from 2 sheets',
    /3\s*<?\/?strong>?\s*rows ready to import/.test(t1.replace(/\s+/g, ' ')) ||
      /from 2 sheets/.test(t1),
    t1.replace(/\s+/g, ' ').match(/\d+ rows ready to import[^·]*·?[^·]*/)?.[0] ?? '',
  );
  // more robust: count preview table body rows
  const previewRows = () => modal.locator('table tbody tr').count();
  const initialRows = await previewRows();
  report('preview table shows 3 rows', initialRows === 3, `rows=${initialRows}`);

  // 3) deselect February → preview drops to 2
  await modal.locator('label', { hasText: 'February' }).locator('input[type="checkbox"]').uncheck();
  await page.waitForTimeout(800);
  const afterUncheck = await previewRows();
  report('deselecting February drops preview to 2', afterUncheck === 2, `rows=${afterUncheck}`);
  await shot('ms-02-february-off');

  // 4) None → 0 (import disabled); All → back to 3
  await modal.getByRole('button', { name: 'None', exact: true }).click();
  await page.waitForTimeout(600);
  const importBtn = modal.getByRole('button', { name: /Import \d* ?expense/ });
  const disabledNone = await importBtn.isDisabled().catch(() => false);
  report('None disables import', disabledNone);
  await modal.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForTimeout(800);
  const afterAll = await previewRows();
  report('All restores 3 rows', afterAll === 3, `rows=${afterAll}`);
  await shot('ms-03-all-back');

  // Do NOT commit — this is a UI-only verification (no prod rows created).
  report('did not commit (no prod pollution)', true);
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('ms-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
