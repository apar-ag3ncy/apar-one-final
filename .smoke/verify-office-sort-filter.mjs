// Verify: Office expenses sort (asc/desc), date filters (presets + custom
// range), and imports filed under Others. Read-only (import not committed).
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT = '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
const TMP = '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad';
fs.mkdirSync(OUT, { recursive: true });

// single-sheet workbook WITH a Category column, to prove it's ignored
const catFile = path.join(TMP, 'smoke-cat-ignored.xlsx');
{
  const aoa = [
    ['Date', 'Name', 'Total', 'Category', 'Payment Mode'],
    ['05.05.26', 'SMOKE cat test A', '₹100', 'Office Supplies', 'Cash'],
    ['06.05.26', 'SMOKE cat test B', '₹200', 'Asset', 'Bank'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Expenses');
  XLSX.writeFile(wb, catFile);
}

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

  await cmdk('Open Office');
  await page.getByRole('button', { name: /Expenses/ }).first().click();
  await page.waitForTimeout(3500);
  const ow = page.locator('.window').last();
  await ow.locator('table tbody tr').first().waitFor({ timeout: 20000 });
  const bodyRows = () => ow.locator('table tbody tr');
  const firstRowText = async () => ((await bodyRows().first().textContent()) ?? '').trim();

  // --- SORT ------------------------------------------------------------------
  const dateTh = ow.locator('th', { hasText: 'Date' }).first();
  const desc0 = await firstRowText();
  report('Date header shows sort affordance', /[▼▲↕]/.test((await dateTh.textContent()) ?? ''));
  await dateTh.click(); // desc -> asc
  await page.waitForTimeout(600);
  const asc1 = await firstRowText();
  report('Date sort flips ascending (order changes)', asc1 !== desc0, `desc0=${desc0.slice(0,18)} asc1=${asc1.slice(0,18)}`);
  report('active Date header shows ▲ when ascending', /▲/.test((await dateTh.textContent()) ?? ''));
  await dateTh.click(); // asc -> desc
  await page.waitForTimeout(600);
  report('active Date header shows ▼ when descending', /▼/.test((await dateTh.textContent()) ?? ''));
  // amount sort
  const amtTh = ow.locator('th', { hasText: 'Amount' }).first();
  await amtTh.click();
  await page.waitForTimeout(600);
  report('Amount header becomes the active sort', /[▲▼]/.test((await amtTh.textContent()) ?? '') && /↕/.test((await dateTh.textContent()) ?? ''));
  await shot('osf-01-sort');

  // --- DATE FILTER -----------------------------------------------------------
  const dateSelect = ow.locator('select').filter({ hasText: 'All time' }).first();
  // narrow custom range in the far past → 0 rows
  await dateSelect.selectOption('custom');
  await page.waitForTimeout(500);
  const fromInput = ow.locator('input[aria-label="From date"]');
  const toInput = ow.locator('input[aria-label="To date"]');
  report('custom range shows from/to date inputs', (await fromInput.count()) === 1 && (await toInput.count()) === 1);
  await fromInput.fill('2019-01-01');
  await toInput.fill('2019-01-02');
  await page.waitForTimeout(800);
  const rowsFarPast = await bodyRows().count();
  report('narrow past range yields no rows', rowsFarPast === 0, `rows=${rowsFarPast}`);
  await shot('osf-02-daterange-empty');
  // widen → rows return
  await fromInput.fill('2020-01-01');
  await toInput.fill('2030-12-31');
  await page.waitForTimeout(800);
  const rowsWide = await bodyRows().count();
  report('wide range returns rows', rowsWide > 0, `rows=${rowsWide}`);
  // preset dropdown has the expected options
  const presetText = (await dateSelect.textContent()) ?? '';
  report('presets include week/month/quarter/FY', /This week/.test(presetText) && /This month/.test(presetText) && /This quarter/.test(presetText) && /financial year/.test(presetText));
  await dateSelect.selectOption('all');
  await page.waitForTimeout(500);

  // --- IMPORT → Others -------------------------------------------------------
  await ow.getByRole('button', { name: /Import/ }).first().click();
  await page.waitForTimeout(1000);
  const modal = page.locator('.os-modal').last();
  report('import modal says imports go under Others', /filed\s+under\s+Others/i.test((await modal.textContent()) ?? ''));
  await modal.locator('input[type="file"]').setInputFiles(catFile);
  await page.waitForTimeout(2500);
  const previewCats = await modal.locator('table tbody tr td:nth-child(3)').allTextContents();
  report(
    'import preview files every row under Others (ignores Category column)',
    previewCats.length >= 2 && previewCats.every((c) => c.trim() === 'Others'),
    `cats=${previewCats.join('|')}`,
  );
  await shot('osf-03-import-others');
  // do NOT commit
  report('did not commit import (no prod pollution)', true);
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('osf-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
